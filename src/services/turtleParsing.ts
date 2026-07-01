import type { PodGateway } from "./pod/podGateway.ts";
import {
  BuildingSourceError,
  loadBuildingSource,
} from "./building/buildingSource.ts";
import { buildingFileUri } from "./rdf/building/buildingId.ts";
import type {
  Building,
  Energy,
} from "../types.ts";
import { Parser, Store } from "n3";
import { getStorageRoot, podResources } from "./pod/solidUtils.ts";
import { fetchFresh } from "./pod/podFetch.ts";
import { listDirectChildren } from "./pod/podDelete.ts";
import { mapPooled } from "../lib/pool.ts";
import {
  type BuildinglessObservation,
  parseEnergyDataset,
} from "./energy/energyDataset.ts";
import {
  computeEnergyAverages,
  resolveBuildingEnergy,
} from "./energy/buildingEnergy.ts";
import { readPrefs } from "./prefs.ts";
import {
  type ActiveGrant,
  appendSharingEvent,
  foldSharingLog,
  sharedInUri,
} from "./interop/sharingLog.ts";

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


/**
 * Prune shared building sources that 403/404'd — append a self-revocation to the
 * `shared-in/` log so the fold drops them next load. A grant revoked on the
 * owner's side thus self-heals (and converges: once revoked, the source isn't
 * folded back in, so it isn't re-fetched). System-initiated (reconciliation),
 * but the event still honours the schema: `owner` is the SHARER, looked up from
 * the folded grant being pruned (recording the pruning recipient there would
 * falsify the history for any owner-keyed derivation), and the kind is recorded
 * like every other event.
 */
export async function removeInaccessibleBuildingSources(
  failedSources: Array<{ uri: string; status: number }>,
  gateway: PodGateway,
): Promise<void> {
  const webId = gateway.webId;
  if (!webId) return;
  const sharedIn = sharedInUri(webId);
  // The grants being pruned — the source of each event's true owner (the
  // per-event parses are gateway-cached, so this re-fold is mostly free).
  const grants = await foldSharingLog(sharedIn, gateway).catch(() => []);
  const at = new Date().toISOString();
  for (const failed of failedSources) {
    const grant = grants.find((g) => g.resource === failed.uri);
    try {
      await appendSharingEvent(sharedIn, gateway, {
        type: "revocation",
        owner: grant?.owner || webId,
        grantee: webId,
        resource: failed.uri,
        kind: "Building",
        at,
      });
      console.log(`Pruned inaccessible shared building source: ${failed.uri}`);
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
export async function listOwnBuildings(
  gateway: PodGateway,
  webId: string,
): Promise<string[]> {
  const container = podResources(webId).buildings;
  const children = await listDirectChildren(container, gateway);
  return (children ?? []).filter((uri) => uri.endsWith(".ttl"));
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
 * folded ONCE per load by the `sharedInContainer` query (hooks) or by
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
  gateway: PodGateway,
  sharedSources: string[],
  hiddenBuildingUris: Set<string>,
): Promise<{
  buildings: Building[];
  prunedSources: string[];
  /** Building files that failed transiently (slow/throttled Pod) — kept for a
   * later refresh, but reported so the missing buildings aren't a silent gap. */
  transientFailures: string[];
}> {
  const webId = gateway.webId;
  if (!webId) {
    throw new Error("No WebID found.");
  }

  const ownBuildings = await listOwnBuildings(gateway, webId);
  const buildingSources = [...new Set([...ownBuildings, ...sharedSources])];
  const storageRoot = getStorageRoot(webId);

  // Each source is read + parsed independently (the same per-source path the
  // `useBuildings` query fans out over — `building/buildingSource.ts`), with bounded
  // concurrency. A failure is classified by HTTP status: 403/404 = access revoked
  // (prunable), 401 = expired token, anything else transient.
  const failedSources: Array<{ uri: string; status: number }> = [];
  const transientFailures: string[] = [];
  let had401 = false;
  let okCount = 0;

  const perSource = await mapPooled(buildingSources, 6, async (uri) => {
    try {
      const buildings = await loadBuildingSource(uri, gateway, storageRoot);
      okCount++;
      return buildings;
    } catch (error) {
      const status = error instanceof BuildingSourceError
        ? error.status
        : undefined;
      if (status === 403 || status === 404) {
        failedSources.push({ uri, status });
      } else if (status === 401) {
        had401 = true;
      } else {
        transientFailures.push(uri);
      }
      return [] as Building[];
    }
  });

  // No source was readable: a 401 means the token expired (keep prior data + prompt
  // re-login); otherwise it's a permissions/connectivity wall.
  if (okCount === 0 && buildingSources.length > 0) {
    if (had401) {
      throw new SessionExpiredError("Authentication failed loading buildings (HTTP 401).");
    }
    throw new Error(
      "Could not access any of the buildings sources. Check permissions or connectivity.",
    );
  }

  // A shared source that 403/404s (e.g. access revoked since the grant) is pruned
  // from the registry; own buildings always load, so this self-heals missed
  // revocations on the next load.
  if (failedSources.length > 0) {
    await removeInaccessibleBuildingSources(failedSources, gateway);
  }

  // Filter out hidden buildings (isShared is set per source in parseBuildingSource).
  const visibleBuildings: Building[] = [];
  for (const building of perSource.flat()) {
    if (hiddenBuildingUris.has(buildingFileUri(building.uri))) continue;
    visibleBuildings.push(building);
  }

  return {
    buildings: visibleBuildings,
    prunedSources: failedSources.map((f) => f.uri),
    transientFailures,
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
export async function loadEnergy(
  gateway: PodGateway,
  buildings: Building[],
): Promise<{
  energyNeed: Energy[];
  portfolioAverages: Record<string, number>;
  operatorAverages: Record<string, Record<string, number>>;
}> {
  // Each building's latest accessible actual-annual energy, resolved through the shared
  // per-dataset cache with bounded concurrency (one Pod round-trip per building in series
  // made the map slow). The per-building resolution and the averages math are shared with
  // the `useEnergy` useQueries selector (`buildingEnergy.ts`), so the headless fold and the
  // app can't drift; sub-hourly *series* are skipped (lazy-loaded on click).
  const resolved = await mapPooled(buildings, 6, async (building) => {
    const energy = await resolveBuildingEnergy(building, gateway);
    return energy ? { building, energy } : null;
  });
  const entries = resolved.filter(
    (e): e is { building: Building; energy: Energy } => e !== null,
  );

  return {
    energyNeed: entries.map((e) => e.energy),
    ...computeEnergyAverages(entries),
  };
}

/**
 * Discover the user's **building-less** observations — annual datasets in their own
 * `observations/` container that NO building links (no `cons:ofBuilding`), surfaced as
 * loose rows in the Observations finder. Lists the year-nested container, skips the
 * dataset files already reached via a building's links (`boundDatasetFiles`), and
 * parses the remainder, keeping only the unbound ones. Own-Pod only; best-effort (a
 * missing container or an unreadable file just yields fewer rows, never throws).
 * @operation query
 */
export async function loadBuildinglessObservations(
  gateway: PodGateway,
  webId: string,
  boundDatasetFiles: ReadonlySet<string>,
): Promise<BuildinglessObservation[]> {
  const files = (await listObservationFiles(gateway, webId))
    .filter((u) => !boundDatasetFiles.has(u));
  const parsed = await mapPooled(files, 6, async (file) => {
    try {
      const res = await fetchFresh(file, gateway);
      if (!res.ok) return null;
      const store = new Store(
        new Parser({ baseIRI: file }).parse(await res.text()),
      );
      const ds = parseEnergyDataset(store, `${file}#ds`);
      // Unbound only: a dataset WITH a building is already reached via its links.
      return ds && !ds.building ? { uri: `${file}#ds`, ...ds } : null;
    } catch (error) {
      console.error(`Failed to parse observation ${file}:`, error);
      return null;
    }
  });
  return parsed.filter((x): x is BuildinglessObservation => x != null);
}

/** List every observation file under the own `observations/` container (year-nested).
 *  Shared by the loose-observation scan and the dev-mode link audit. */
async function listObservationFiles(
  gateway: PodGateway,
  webId: string,
): Promise<string[]> {
  const root = podResources(webId).observations;
  const years = (await listDirectChildren(root, gateway)) ?? [];
  const files: string[] = [];
  for (const year of years) {
    if (!year.endsWith("/")) continue; // year sub-containers (observations/{year}/)
    const children = (await listDirectChildren(year, gateway)) ?? [];
    files.push(...children.filter((u) => u.endsWith(".ttl")));
  }
  return files;
}

/** One drift between an observation's `cons:ofBuilding` and a building's
 *  `cons:hasEnergyDataset` link — the two halves of the same relationship. */
export interface ObservationLinkDrift {
  /** `orphanAttribution`: a dataset attributes itself to an own building that does NOT
   *  link it back → invisible to the building's link-following load. `danglingLink`: a
   *  building links a dataset that no longer exists. `backrefMismatch`: a building links
   *  a dataset whose `ofBuilding` points elsewhere/nowhere. */
  kind: "orphanAttribution" | "danglingLink" | "backrefMismatch";
  dataset: string;
  building: string;
}

export interface ObservationLinkAuditResult {
  /** Observation datasets scanned. */
  checked: number;
  drift: ObservationLinkDrift[];
}

/** Pure diff of the two link halves — `buildings` (with their `cons:hasEnergyDataset`
 *  targets) against `observations` (each with its `cons:ofBuilding`). The I/O-free core
 *  of {@link auditObservationLinks}, unit-tested directly. */
export function diffObservationLinks(
  buildings: ReadonlyArray<
    { uri: string; energyDatasets?: ReadonlyArray<{ uri: string }> }
  >,
  observations: ReadonlyArray<{ uri: string; building: string }>,
): ObservationLinkDrift[] {
  const ownBuildingUris = new Set(buildings.map((b) => b.uri));
  const linksByBuilding = new Map(
    buildings.map(
      (b) => [b.uri, new Set((b.energyDatasets ?? []).map((r) => r.uri))],
    ),
  );
  const obsByUri = new Map(observations.map((o) => [o.uri, o.building]));
  const drift: ObservationLinkDrift[] = [];
  // `ofBuilding` set on an own building, but no matching forward link → invisible.
  for (const o of observations) {
    if (
      o.building && ownBuildingUris.has(o.building) &&
      !linksByBuilding.get(o.building)?.has(o.uri)
    ) {
      drift.push({ kind: "orphanAttribution", dataset: o.uri, building: o.building });
    }
  }
  // Forward link with no (matching) back-reference.
  for (const b of buildings) {
    for (const r of b.energyDatasets ?? []) {
      if (!obsByUri.has(r.uri)) {
        drift.push({ kind: "danglingLink", dataset: r.uri, building: b.uri });
      } else if (obsByUri.get(r.uri) !== b.uri) {
        drift.push({ kind: "backrefMismatch", dataset: r.uri, building: b.uri });
      }
    }
  }
  return drift;
}

/**
 * Dev-mode consistency check of own-Pod observation links: every observation's
 * `cons:ofBuilding` should be mirrored by that building's `cons:hasEnergyDataset` link,
 * and vice-versa. Read-only — reports drift, repairs nothing (the diffing twin of a
 * future reconciliation, mirroring `auditGrants` for sharing). Own-Pod only: a foreign
 * (shared) container isn't listable, so the audit scopes to the user's own buildings +
 * observations.
 */
export async function auditObservationLinks(
  gateway: PodGateway,
): Promise<ObservationLinkAuditResult> {
  const webId = gateway.webId;
  if (!webId) throw new Error("No WebID found.");

  // Own buildings + their forward-link targets (no shared sources, none hidden).
  const { buildings } = await loadBuildings(gateway, [], new Set());

  // Every observation dataset + the building it attributes itself to (`ofBuilding`).
  const files = await listObservationFiles(gateway, webId);
  const obs = (await mapPooled(files, 6, async (file) => {
    try {
      const res = await fetchFresh(file, gateway);
      if (!res.ok) return null;
      const store = new Store(
        new Parser({ baseIRI: file }).parse(await res.text()),
      );
      const ds = parseEnergyDataset(store, `${file}#ds`);
      return ds ? { uri: `${file}#ds`, building: ds.building } : null;
    } catch (error) {
      console.error(`Failed to parse observation ${file}:`, error);
      return null;
    }
  })).filter((x): x is { uri: string; building: string } => x != null);

  return { checked: obs.length, drift: diffObservationLinks(buildings, obs) };
}

/**
 * Building IRIs shared *with* the user, by folding the `shared-in/` log once.
 * An empty/missing log (no shares received) yields `[]`; other failures are
 * logged and tolerated (own buildings must still load).
 * @operation query
 */
export async function listSharedBuildingSources(
  gateway: PodGateway,
  webId: string,
): Promise<string[]> {
  try {
    const grants = await foldSharingLog(sharedInUri(webId), gateway);
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
 * separate React Query queries instead (the `sharedInContainer` query owning the one
 * fold, the `prefs` query the one prefs read).
 * @operation query
 */
export async function fetchAndParseData(
  gateway: PodGateway,
  onBuildings?: (partial: { buildings: Building[] }) => void,
) {
  const webId = gateway.webId;
  if (!webId) throw new Error("No WebID found.");
  const [sharedSources, prefs] = await Promise.all([
    listSharedBuildingSources(gateway, webId),
    readPrefs(gateway),
  ]);
  const { buildings } = await loadBuildings(
    gateway,
    sharedSources,
    prefs.hiddenBuildings,
  );
  onBuildings?.({ buildings });
  const energy = await loadEnergy(gateway, buildings);
  return { buildings, ...energy };
}
