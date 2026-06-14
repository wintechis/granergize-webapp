import { Session } from "@inrupt/solid-client-authn-browser";
import { parseBuildings } from "./rdf/building/buildingParser.ts";
import { buildingFileUri } from "./rdf/building/buildingId.ts";
import type {
  BuildingType,
  EnergyDatasetRef,
  EnergyType,
} from "../types.ts";
import { DataFactory, Parser, Store } from "n3";
import type { Quad } from "@rdfjs/types";
import { getStorageRoot, podResources } from "./pod/solidUtils.ts";
import { fetchFresh } from "./pod/podFetch.ts";
import { listDirectChildren } from "./pod/podDelete.ts";
import { mapPooled } from "../lib/pool.ts";
import { parseEnergyDataset } from "./rdf/energyDataset.ts";
import { readPrefs } from "./prefs.ts";
import {
  type ActiveGrant,
  appendSharingEvent,
  foldSharingLog,
  sharedInUri,
} from "./interop/sharingLog.ts";
import { isSeriesGranularity } from "./rdf/durationUtils.ts";
import { CONSUMPTION_METRIC_KEYS } from "../constants/annualMetrics.ts";

/**
 * Attempts to load Turtle data from multiple sources, continuing if some fail
 */
/**
 * Thrown when Pod reads fail with HTTP 401 — the auth token has (almost
 * certainly) expired. Callers should keep any previously loaded data and prompt
 * the user to log in again, rather than treat it as "no data".
 */
export class SessionExpiredError extends Error {
  constructor(message = "Session expired — please log in again.") {
    super(message);
    this.name = "SessionExpiredError";
  }
}

async function loadTtlFromMultipleSources(
  urls: string[],
  session: Session,
  description: string,
): Promise<{
  quads: Quad[];
  /** Sources that 403/404'd — access revoked since the grant; prunable. */
  failedSources: Array<{ url: string; status: number }>;
  /** Sources that failed transiently (timeout / network / 5xx, NOT 403/404).
   * These are NOT pruned — they may load on the next refresh — but the caller
   * surfaces them so a slow Pod silently shedding files is never invisible. */
  transientFailures: string[];
}> {
  const allQuads: Quad[] = [];
  const successfulSources: string[] = [];
  const failedSources: { url: string; error: string; status?: number }[] = [];

  // Try each source independently. fetchFresh revalidates (cache: "no-cache"),
  // so an unchanged document comes back as a cheap 304 instead of a full body.
  await Promise.all(
    urls.map(async (url) => {
      try {
        const response = await fetchFresh(url, session);
        if (!response.ok) {
          failedSources.push({
            url,
            error: `HTTP ${response.status}: ${response.statusText}`,
            status: response.status,
          });
          return;
        }

        const text = await response.text();
        const parser = new Parser({
          baseIRI: url,
        });

        // Parse with default graph set to the URL
        const quads = parser.parse(text);

        // Unique prefix for blank nodes from this source, to avoid ID collisions
        // when multiple files use the same generic blank node names (_:obs0_0, etc.)
        const bnPrefix = encodeURIComponent(url) + "__";
        const scopedNode = (term: Quad["subject"]): Quad["subject"] => {
          if (term.termType === "BlankNode") {
            return DataFactory.blankNode(bnPrefix + term.value);
          }
          return term;
        };

        // Add source information to each quad
        const quadsWithGraph = quads.map((quad: Quad) => {
          // Create a new quad with the source URL as the graph and scoped blank nodes
          return DataFactory.quad(
            scopedNode(quad.subject) as Quad["subject"],
            quad.predicate,
            scopedNode(quad.object as Quad["subject"]) as Quad["object"],
            DataFactory.namedNode(url),
          );
        });

        // Add these quads to our collection
        allQuads.push(...quadsWithGraph);
        successfulSources.push(url);
      } catch (error) {
        failedSources.push({
          url,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }),
  );

  // Log results
  if (successfulSources.length > 0) {
    console.log(
      `Successfully loaded ${description} from ${successfulSources.length} sources:`,
      successfulSources,
    );
  }

  if (failedSources.length > 0) {
    console.warn(
      `Failed to load ${description} from ${failedSources.length} sources:`,
      failedSources,
    );
  }

  if (allQuads.length === 0 && urls.length > 0) {
    // All sources unreadable. A 401 means the token expired — distinguish it so
    // the caller can keep prior data and prompt re-login instead of blanking out.
    if (failedSources.some((f) => f.status === 401)) {
      throw new SessionExpiredError(
        `Authentication failed loading ${description} (HTTP 401).`,
      );
    }
    throw new Error(
      `Could not access any of the ${description} sources. Check permissions or connectivity.`,
    );
  }

  return {
    quads: allQuads,
    failedSources: failedSources
      .filter((f) => f.status === 403 || f.status === 404)
      .map((f) => ({ url: f.url, status: f.status! })),
    // Everything else that failed without a 401 (which already threw above):
    // timeouts, network errors, 5xx. Reported, not pruned.
    transientFailures: failedSources
      .filter((f) => f.status !== 403 && f.status !== 404)
      .map((f) => f.url),
  };
}

/**
 * Prune shared building sources that 403/404'd — append a self-revocation to the
 * `shared-in/` log so the fold drops them next load. A grant revoked on the
 * owner's side thus self-heals (and converges: once revoked, the source isn't
 * folded back in, so it isn't re-fetched).
 */
async function removeInaccessibleBuildingSources(
  failedSources: Array<{ url: string; status: number }>,
  session: Session,
): Promise<void> {
  const webId = session.info.webId;
  if (!webId) return;
  const sharedIn = sharedInUri(webId);
  const at = new Date().toISOString();
  for (const failed of failedSources) {
    try {
      await appendSharingEvent(sharedIn, session, {
        type: "revocation",
        owner: webId,
        grantee: webId,
        resource: failed.url,
        at,
      });
      console.log(`Pruned inaccessible shared building source: ${failed.url}`);
    } catch (error) {
      console.error("Error pruning inaccessible building source:", error);
    }
  }
}

/**
 * Discover the user's OWN buildings by LISTING the `buildings/` container — the
 * top-level `*.ttl` files (skip the `buildings/<id>/` energy subcontainers). No
 * registry: adding a building is a single PUT, so the listing can't desync. A
 * *missing* container (404, `null` from listDirectChildren) means a fresh Pod —
 * the demo buildings are no longer seeded here (silently); instead the UI offers
 * them via a banner (see `useDemoSeedPrompt` / `seedDemoBuildings`). So a fresh
 * Pod simply loads empty until the user chooses.
 */
async function discoverOwnBuildings(
  session: Session,
  webId: string,
): Promise<string[]> {
  const container = podResources(webId).buildings;
  const children = await listDirectChildren(container, session);
  return (children ?? []).filter((url) => url.endsWith(".ttl"));
}

/**
 * Building IRIs shared *with* the user, derived from the already-folded
 * `shared-in/` grants (`gran:kind rec:Building`).
 */
export function sharedBuildingSourcesFromGrants(grants: ActiveGrant[]): string[] {
  return grants.filter((g) => g.kind === "Building").map((g) => g.resource);
}

/**
 * Phase 1: discover, fetch and parse the visible buildings (no energy). Own
 * buildings come from listing the `buildings/` container; buildings shared with
 * the user are passed in as `sharedSources` — derived from the `shared-in/` log
 * folded ONCE per load by the `sharedInLog` query (hooks) or by
 * {@link fetchAndParseData} (headless). `hiddenBuildings` (the prefs
 * `gran:hiddenBuilding` set) is likewise passed in — read ONCE per load by the
 * `prefs` query (hooks) or by {@link fetchAndParseData}, not re-fetched here.
 * Fast enough to paint the map immediately; energy streams in via
 * {@link loadEnergy}.
 *
 * Pure on the happy path, but carries one *reconciliation* write: a shared source
 * that 403/404s (access revoked since the grant) is pruned via
 * {@link removeInaccessibleBuildingSources}, which appends a self-revocation to
 * `shared-in/` so the next fold drops it. Best-effort (failures logged, never
 * thrown) and only when a source actually fails — so the call performs no write
 * when every source is accessible. The pruned sources are reported back so the
 * caller can invalidate the folded-log query (the fold itself happens upstream
 * now). See `notes/operations.md` (§Seams) for why this reconciliation write
 * lives in the read path.
 * @operation query
 */
export async function loadBuildings(
  session: Session,
  sharedSources: string[],
  hiddenBuildingUris: Set<string>,
): Promise<{
  buildings: BuildingType[];
  prunedSources: string[];
  /** Building files that failed transiently (slow/throttled Pod) — kept for a
   * later refresh, but reported so the missing buildings aren't a silent gap. */
  transientFailures: string[];
}> {
  const webId = session.info.webId;
  if (!webId) {
    throw new Error("No WebID found in session.");
  }

  const ownBuildings = await discoverOwnBuildings(session, webId);
  const buildingSources = [...new Set([...ownBuildings, ...sharedSources])];

  const buildingsResult = await loadTtlFromMultipleSources(
    buildingSources,
    session,
    "buildings",
  );

  // A shared source that 403/404s (e.g. access revoked since the grant) is
  // pruned from the registry; own buildings always load, so this self-heals
  // missed revocations on the next load.
  if (buildingsResult.failedSources.length > 0) {
    await removeInaccessibleBuildingSources(
      buildingsResult.failedSources,
      session,
    );
  }

  const storageRoot = getStorageRoot(webId);
  const buildings = parseBuildings(buildingsResult.quads, storageRoot);

  // Filter out hidden buildings and mark shared buildings.
  const visibleBuildings = new Map<string, BuildingType>();
  for (const [buildingId, building] of buildings) {
    if (!hiddenBuildingUris.has(buildingFileUri(building.uri))) {
      // Ownership = whether the source file lives under the user's storage root.
      const sourceForOwnershipCheck = building.sourceUri || building.uri;
      building.isShared = !sourceForOwnershipCheck.startsWith(storageRoot);
      visibleBuildings.set(buildingId, building);
    }
  }

  return {
    buildings: Array.from(visibleBuildings.values()),
    prunedSources: buildingsResult.failedSources.map((f) => f.url),
    transientFailures: buildingsResult.transientFailures,
  };
}

/**
 * Phase 2: load + parse energy for already-parsed buildings, returning the energy
 * series, category averages, and per-operator averages. Reads each building's unified
 * `energyDatasets` refs (from the `cons:hasEnergyDataset` link slugs): sub-hourly
 * *series* are skipped (lazy-loaded on click); the latest actual annual aggregate
 * is fetched and parsed into the building's energyNeed + the cross-building
 * averages. A pure function of the buildings it's given — no registry re-read.
 * @operation query
 */
/** Arithmetic mean of a non-empty list. */
function meanOf(values: number[]): number {
  return values.reduce((acc, v) => acc + v, 0) / values.length;
}

/**
 * Mean each metric bucket of a `metric → samples` map, dropping any bucket with
 * fewer than `minCount` samples (the operator averages need ≥2 so a lone
 * building isn't published as its own benchmark — see the call site).
 */
function meanByMetric(
  buckets: Record<string, number[]>,
  minCount = 1,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const metric in buckets) {
    if (buckets[metric].length < minCount) continue;
    out[metric] = meanOf(buckets[metric]);
  }
  return out;
}

export async function loadEnergy(
  session: Session,
  buildings: BuildingType[],
): Promise<{
  energyNeed: EnergyType[];
  portfolioAverages: Record<string, number>;
  operatorAverages: Record<string, Record<string, number>>;
}> {
  const energyData = new Map<string, EnergyType>();
  const operatorAggregatedValues: Record<string, Record<string, number[]>> = {};
  // The user's OWN buildings only (excludes shared-in) — feeds the honest
  // "portfolio average" the energy view shows.
  const portfolioAggregatedValues: Record<string, number[]> = {};

  // For each building, the latest ACCESSIBLE actual annual (non-series) dataset
  // paints the map and feeds the averages. Sub-hourly *series* datasets are
  // skipped here and loaded lazily on click — dispatch is purely on the declared
  // granularity. The annual datasets are separate resources, fetched with bounded
  // concurrency (one Pod round-trip per building in series made the map slow).
  const annualTasks: Array<{ building: BuildingType; refs: EnergyDatasetRef[] }> =
    [];
  for (const building of buildings) {
    const annual = (building.energyDatasets ?? [])
      .filter(
        (r) => r.scenario === "actual" && !isSeriesGranularity(r.granularity),
      )
      .sort((a, b) => b.year - a.year); // newest first
    if (annual.length === 0) continue;
    annualTasks.push({ building, refs: annual });
  }

  const parsedAnnual = await mapPooled(
    annualTasks,
    6,
    async ({ building, refs }) => {
      // Newest-first with fallback: a per-year share grants only some years, so
      // the recipient's fetch of the newest LINKED year can 403 while an older
      // granted year is readable — fall through to the next-newest instead of
      // showing "no energy data" (and dropping out of the map's peer terciles).
      for (const ref of refs) {
        try {
          const fileUri = buildingFileUri(ref.url);
          const res = await fetchFresh(fileUri, session);
          if (!res.ok) continue;
          const store = new Store(
            new Parser({ baseIRI: fileUri }).parse(await res.text()),
          );
          const ds = parseEnergyDataset(store, ref.url);
          if (ds?.metrics) return { building, metrics: ds.metrics, year: ref.year };
        } catch (error) {
          console.error(
            `Failed to load energy ${ref.year} for building ${building.id}:`,
            error,
          );
        }
      }
      return null;
    },
  );

  for (const entry of parsedAnnual) {
    if (!entry) continue;
    const { building, metrics, year } = entry;
    // Canonical, vocab-keyed energy: `energyNeed` mirrors the AnnualMetrics keys
    // (`electricityConsumption`, …) 1:1 with the `cons:*` observed-property IRIs —
    // the same shape the view compute and benchmark snapshots use. Display labels
    // ("Electricity", …) are derived at render via `metricLabel`/`ANNUAL_METRICS`,
    // so the cache stays close to the Turtle and reusable, not display-shaped.
    const energyNeed: Record<string, number> = {};
    for (const key of CONSUMPTION_METRIC_KEYS) {
      const v = metrics[key];
      if (v !== undefined) energyNeed[key] = v;
    }
    if (Object.keys(energyNeed).length === 0) continue;

    energyData.set(building.id, {
      id: building.id,
      uri: building.uri as string,
      year,
      energyNeed,
      energyGeneration: {},
      energyStorage: {},
      energyDistribution: {},
      energyTransfer: {},
      energyUsage: {},
      environmentalFactor: {},
    });

    for (const [prop, val] of Object.entries(energyNeed)) {
      if (!building.isShared) {
        if (!portfolioAggregatedValues[prop]) portfolioAggregatedValues[prop] = [];
        portfolioAggregatedValues[prop].push(val);
      }
      const operator = building.operatedBy;
      if (!operator || typeof operator !== "string") continue;
      if (!operatorAggregatedValues[operator]) {
        operatorAggregatedValues[operator] = {};
      }
      if (!operatorAggregatedValues[operator][prop]) {
        operatorAggregatedValues[operator][prop] = [];
      }
      operatorAggregatedValues[operator][prop].push(val);
    }
  }

  // The portfolio average (the user's OWN buildings only).
  const portfolioAverages = meanByMetric(portfolioAggregatedValues);

  // Operator (Betreiber) averages — published per metric only when ≥2 buildings
  // contribute: a single-building "mean" IS that building's own value, which
  // would (a) render the own figure dressed up as a benchmark and (b) win the
  // comparison-reference precedence over the portfolio mean, silently disabling
  // the deviation tint (own vs itself is always neutral).
  const operatorAverages: Record<string, Record<string, number>> = {};
  for (const operator in operatorAggregatedValues) {
    const perMetric = meanByMetric(operatorAggregatedValues[operator], 2);
    if (Object.keys(perMetric).length > 0) operatorAverages[operator] = perMetric;
  }

  return {
    energyNeed: Array.from(energyData.values()),
    portfolioAverages,
    operatorAverages,
  };
}

/**
 * Building IRIs shared *with* the user, by folding the `shared-in/` log once.
 * An empty/missing log (no shares received) yields `[]`; other failures are
 * logged and tolerated (own buildings must still load).
 * @operation query
 */
export async function listSharedBuildingSources(
  session: Session,
  webId: string,
): Promise<string[]> {
  try {
    const grants = await foldSharingLog(sharedInUri(webId), session);
    return sharedBuildingSourcesFromGrants(grants);
  } catch (error) {
    console.error("Error loading shared building sources:", error);
    return [];
  }
}

/**
 * Two-phase orchestrator: phase 0+1 (fold shared-in once + read prefs once,
 * then buildings) and phase 2 (energy), with a callback fired after phase 1.
 * Used by the live harness and the offline tests; the app drives the phases as
 * separate React Query queries instead (the `sharedInLog` query owning the one
 * fold, the `prefs` query the one prefs read).
 * @operation query
 */
export async function fetchAndParseData(
  session: Session,
  onBuildings?: (partial: { buildings: BuildingType[] }) => void,
) {
  const webId = session.info.webId;
  if (!webId) throw new Error("No WebID found in session.");
  const [sharedSources, prefs] = await Promise.all([
    listSharedBuildingSources(session, webId),
    readPrefs(session),
  ]);
  const { buildings } = await loadBuildings(
    session,
    sharedSources,
    prefs.hiddenBuildings,
  );
  onBuildings?.({ buildings });
  const energy = await loadEnergy(session, buildings);
  return { buildings, ...energy };
}
