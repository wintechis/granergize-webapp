import { Session } from "@inrupt/solid-client-authn-browser";
import { parseBuildings } from "./rdf/building/buildingParser.ts";
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
  appendSharingEvent,
  foldSharingLog,
  sharedInUrl,
} from "./interop/sharingLog.ts";
import { isSeriesGranularity } from "./rdf/durationUtils.ts";

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
): Promise<
  { quads: Quad[]; failedSources: Array<{ url: string; status: number }> }
> {
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
  const sharedIn = sharedInUrl(webId);
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
 * Building URLs shared *with* the user (on other Pods), by folding the
 * `shared-in/` event log for `gran:kind gran:Building` grants. An empty/missing
 * log (no shares received) yields `[]`.
 */
async function listSharedBuildingSources(
  session: Session,
  webId: string,
): Promise<string[]> {
  try {
    const grants = await foldSharingLog(sharedInUrl(webId), session);
    return grants.filter((g) => g.kind === "Building").map((g) => g.resource);
  } catch (error) {
    console.error("Error loading shared building sources:", error);
    return [];
  }
}

/**
 * Phase 1: discover, fetch and parse the visible buildings (no energy). Own
 * buildings come from listing the `buildings/` container; buildings shared with
 * the user come from folding the `shared-in/` log. Fast enough to paint the map
 * immediately; energy streams in via {@link loadEnergy}.
 *
 * Pure on the happy path, but carries one *reconciliation* write: a shared source
 * that 403/404s (access revoked since the grant) is pruned via
 * {@link removeInaccessibleBuildingSources}, which appends a self-revocation to
 * `shared-in/` so the next fold drops it. Best-effort (failures logged, never
 * thrown) and only when a source actually fails — so the call performs no write
 * when every source is accessible. See `notes/operations.md` (§Seams) for why this
 * reconciliation write lives in the read path.
 * @operation query
 */
export async function loadBuildings(
  session: Session,
): Promise<{ buildings: BuildingType[] }> {
  const webId = session.info.webId;
  if (!webId) {
    throw new Error("No WebID found in session.");
  }

  // Own buildings (container listing) and shared sources (registry) are
  // independent; discover them concurrently.
  const [ownBuildings, sharedBuildings] = await Promise.all([
    discoverOwnBuildings(session, webId),
    listSharedBuildingSources(session, webId),
  ]);
  const buildingSources = [...new Set([...ownBuildings, ...sharedBuildings])];

  const [hiddenBuildingUris, buildingsResult] = await Promise.all([
    readPrefs(session).then((p) => p.hiddenBuildings),
    loadTtlFromMultipleSources(buildingSources, session, "buildings"),
  ]);

  // A shared source that 403/404s (e.g. access revoked since the grant) is
  // pruned from the registry; own buildings always load, so this self-heals
  // missed revocations on the next load.
  if (buildingsResult.failedSources.length > 0) {
    await removeInaccessibleBuildingSources(
      buildingsResult.failedSources,
      session,
    );
  }

  const buildings = parseBuildings(buildingsResult.quads);
  const storageRoot = getStorageRoot(webId);

  // Filter out hidden buildings and mark shared buildings.
  const visibleBuildings = new Map<string, BuildingType>();
  for (const [buildingId, building] of buildings) {
    if (!hiddenBuildingUris.has(building.uri.split("#")[0])) {
      // Ownership = whether the source file lives under the user's storage root.
      const sourceForOwnershipCheck = building.sourceUri || building.uri;
      building.isShared = !sourceForOwnershipCheck.startsWith(storageRoot);
      visibleBuildings.set(buildingId, building);
    }
  }

  return {
    buildings: Array.from(visibleBuildings.values()),
  };
}

/**
 * Phase 2: load + parse energy for already-parsed buildings, returning the energy
 * series, category averages, and per-operator averages. Reads each building's unified
 * `energyDatasets` refs (from the `gran:hasEnergyDataset` link slugs): sub-hourly
 * *series* are skipped (lazy-loaded on click); the latest actual annual aggregate
 * is fetched and parsed into the building's energyNeed + the cross-building
 * averages. A pure function of the buildings it's given — no registry re-read.
 * @operation query
 */
export async function loadEnergy(
  session: Session,
  buildings: BuildingType[],
): Promise<{
  energyNeed: EnergyType[];
  averages: Record<string, number>;
  portfolioAverages: Record<string, number>;
  operatorAverages: Record<string, Record<string, number>>;
}> {
  const energyData = new Map<number, EnergyType>();
  // Object to store aggregated values for each measurement
  const aggregatedValues: Record<string, number[]> = {};
  const operatorAggregatedValues: Record<string, Record<string, number[]>> = {};
  // The user's OWN buildings only (excludes shared-in) — feeds the honest
  // "portfolio average" the energy view shows, distinct from the cross-all mean.
  const portfolioAggregatedValues: Record<string, number[]> = {};

  // For each building, the latest ACTUAL annual (non-series) dataset paints the
  // map and feeds the averages. Sub-hourly *series* datasets are skipped here and
  // loaded lazily on click — dispatch is purely on the declared granularity. The
  // annual datasets are now separate resources, so fetch them with bounded
  // concurrency (one Pod round-trip per building in series made the map slow).
  const annualTasks: Array<{ building: BuildingType; ref: EnergyDatasetRef }> = [];
  for (const building of buildings) {
    const annual = (building.energyDatasets ?? []).filter(
      (r) => r.scenario === "actual" && !isSeriesGranularity(r.granularity),
    );
    if (annual.length === 0) continue;
    const latest = annual.reduce((a, b) => (a.year >= b.year ? a : b));
    annualTasks.push({ building, ref: latest });
  }

  const parsedAnnual = await mapPooled(
    annualTasks,
    6,
    async ({ building, ref }) => {
      try {
        const fileUrl = ref.url.split("#")[0];
        const res = await fetchFresh(fileUrl, session);
        if (!res.ok) return null;
        const store = new Store(
          new Parser({ baseIRI: fileUrl }).parse(await res.text()),
        );
        const ds = parseEnergyDataset(store, ref.url);
        return ds?.metrics ? { building, metrics: ds.metrics } : null;
      } catch (error) {
        console.error(`Failed to load energy for building ${building.id}:`, error);
        return null;
      }
    },
  );

  for (const entry of parsedAnnual) {
    if (!entry) continue;
    const { building, metrics } = entry;
    const energyNeed: Record<string, number> = {};
    if (metrics.electricityConsumption !== undefined) {
      energyNeed["Electricity"] = metrics.electricityConsumption;
    }
    if (metrics.heatConsumption !== undefined) {
      energyNeed["Heat"] = metrics.heatConsumption;
    }
    if (metrics.waterConsumption !== undefined) {
      energyNeed["Water"] = metrics.waterConsumption;
    }
    if (metrics.wastewaterConsumption !== undefined) {
      energyNeed["Wastewater"] = metrics.wastewaterConsumption;
    }
    if (Object.keys(energyNeed).length === 0) continue;

    energyData.set(building.id, {
      id: building.id,
      uri: building.uri as string,
      energyNeed,
      energyGeneration: {},
      energyStorage: {},
      energyDistribution: {},
      energyTransfer: {},
      energyUsage: {},
      environmentalFactor: {},
    });

    for (const [prop, val] of Object.entries(energyNeed)) {
      if (!aggregatedValues[prop]) aggregatedValues[prop] = [];
      aggregatedValues[prop].push(val);
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

  // Calculate averages

  const averages: Record<string, number> = {};
  for (const property in aggregatedValues) {
    const values = aggregatedValues[property];
    const sum = values.reduce((acc, val) => acc + val, 0);
    averages[property] = sum / values.length;
  }

  // Portfolio average: the mean over the user's OWN buildings only.
  const portfolioAverages: Record<string, number> = {};
  for (const property in portfolioAggregatedValues) {
    const values = portfolioAggregatedValues[property];
    const sum = values.reduce((acc, val) => acc + val, 0);
    portfolioAverages[property] = sum / values.length;
  }

  // Calculate averages by operator
  const operatorAverages: Record<string, Record<string, number>> = {};
  for (const operator in operatorAggregatedValues) {
    operatorAverages[operator] = {};
    for (const property in operatorAggregatedValues[operator]) {
      const values = operatorAggregatedValues[operator][property];
      const sum = values.reduce((acc, val) => acc + val, 0);
      operatorAverages[operator][property] = sum / values.length;
    }
  }

  return {
    energyNeed: Array.from(energyData.values()),
    averages,
    portfolioAverages,
    operatorAverages,
  };
}

/**
 * Two-phase orchestrator: phase 1 (buildings) then phase 2 (energy), with a
 * callback fired after phase 1. Used by the live harness and the offline tests;
 * the app drives the two phases as separate React Query queries instead.
 * @operation query
 */
export async function fetchAndParseData(
  session: Session,
  onBuildings?: (partial: { buildings: BuildingType[] }) => void,
) {
  const { buildings } = await loadBuildings(session);
  onBuildings?.({ buildings });
  const energy = await loadEnergy(session, buildings);
  return { buildings, ...energy };
}
