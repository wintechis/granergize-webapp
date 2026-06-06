/// <reference lib="deno.ns" />
/**
 * Fast seeding/cleanup helpers for the benchmark suite (shared by the Tier-2
 * headless runner and the Tier-3 browser bench). Everything goes through the app's
 * OWN data-layer functions — so the benchmark times the real code paths, not a
 * shortcut — but takes the FAST routes: buildings are PUT with coordinates inline
 * (no Nominatim geocoding), and writes are pooled, so 500 buildings seed in seconds.
 */
import type { Session } from "@inrupt/solid-client-authn-browser";
import {
  newBuildingUri,
  serializeBuildingToTurtle,
  uploadBuilding,
  writeBuildingEnergy,
} from "../../src/services/utils/buildingSerializer.ts";
import { synthDayReadings } from "../../src/services/utils/energySeriesXlsx.ts";
import { seriesContainerUrl } from "../../src/services/utils/energyDataset.ts";
import { shareBuildingData } from "../../src/services/interop/share.ts";
import { readInbox } from "../../src/services/interop/inbox.ts";
import { appRoot, podResources } from "../../src/services/utils/solidUtils.ts";
import { deleteContainerRecursive } from "../../src/services/utils/podDelete.ts";
import { ensureContainer } from "../../src/services/utils/podWrite.ts";
import { mapPooled } from "../../src/services/utils/pool.ts";

/** Bounded write concurrency — same small pool the app uses for daily files. */
const POOL = 8;

/** A seeded building: its file URI + the `<file>#id` subject URI. */
export interface SeededBuilding {
  uri: string;
  subjectUri: string;
  id: string;
}

/** Field map for the i-th throwaway building (coords nudged so map markers spread). */
function buildingFields(i: number): Record<string, string> {
  return {
    streetAddress: `Benchstraße ${i + 1}`,
    postalCode: "90411",
    locality: "Nürnberg",
    region: "Bayern",
    lat: (49.45 + i * 0.001).toFixed(6),
    long: (11.08 + i * 0.001).toFixed(6),
  };
}

/**
 * Seed `n` throwaway buildings into the session owner's Pod via the real
 * serialize→PUT path (coords inline, so no geocoding). Returns their URIs for
 * later cleanup. `n === 0` is a no-op (the empty-Pod baseline).
 */
export async function seedBuildings(
  session: Session,
  webId: string,
  n: number,
  idPrefix = "bench",
): Promise<SeededBuilding[]> {
  const specs = Array.from({ length: n }, (_, i) => {
    const id = `${idPrefix}-${i}`;
    const uri = newBuildingUri(webId, id);
    return { id, uri, subjectUri: `${uri}#${id}`, fields: buildingFields(i) };
  });
  // Provision buildings/ ONCE up front: uploadBuilding ensures it per call, and a
  // pool of concurrent first-writers would otherwise race to create it (all see
  // 404, all PUT, the losers get a 409). After this the per-call ensure no-ops.
  if (n > 0) await ensureContainer(`${appRoot(webId)}buildings/`, session);
  return mapPooled(specs, POOL, async (s) => {
    const ttl = serializeBuildingToTurtle(s.fields, s.uri, undefined, {
      agent: webId,
      category: "investor",
    });
    await uploadBuilding(session, s.uri, ttl, webId);
    return { uri: s.uri, subjectUri: s.subjectUri, id: s.id };
  });
}

/** ISO dates `year-01-01 … ` for `days` consecutive days. */
function consecutiveDates(year: number, days: number): string[] {
  const out: string[] = [];
  const start = new Date(`${year}-01-01T00:00:00Z`).getTime();
  for (let d = 0; d < days; d++) {
    out.push(new Date(start + d * 86_400_000).toISOString().slice(0, 10));
  }
  return out;
}

/**
 * Seed one building carrying a PT15M series of `days` daily files (96 synthetic
 * readings each), written via the app's `writeBuildingEnergy` series branch and
 * linked from the building file. Returns the building plus its series-container URL
 * (what the series-load path lists + parses). `days === 0` writes a bare building.
 */
export async function seedSeriesBuilding(
  session: Session,
  webId: string,
  days: number,
  year = 2024,
  id = `bench-series-${days}`,
): Promise<{ building: SeededBuilding; seriesContainer: string }> {
  const uri = newBuildingUri(webId, id);
  const subjectUri = `${uri}#${id}`;
  const series = days > 0
    ? {
      year,
      label: "bench series",
      days: consecutiveDates(year, days).map((date) => ({
        date,
        readings: synthDayReadings(date),
      })),
    }
    : undefined;
  const links = await writeBuildingEnergy(session, uri, subjectUri, {}, series);
  const ttl = serializeBuildingToTurtle(buildingFields(0), uri, links, {
    agent: webId,
    category: "user",
  });
  await uploadBuilding(session, uri, ttl, webId);
  return {
    building: { uri, subjectUri, id },
    seriesContainer: seriesContainerUrl(uri, year),
  };
}

/** A headless actor (subset of the Tier-2 `Actor` — session + webId is all we need). */
export interface BenchActor {
  webId: string;
  session: Session;
}

/**
 * Seed `n` buildings into B's Pod and share each with A (no energy payload), then
 * have A fold its inbox into `shared-in/`. Returns B's seeded buildings so the
 * caller can delete them. Mirrors the `share-building` task flow but without a
 * data-room (shareBuildingData takes A's WebID directly).
 */
export async function seedSharedBuildings(
  a: BenchActor,
  b: BenchActor,
  n: number,
): Promise<SeededBuilding[]> {
  const seeded = await seedBuildings(b.session, b.webId, n, "bench-shared");
  // Share SERIALLY: each share appends to B's single shared-out log (a
  // read-modify-write) and posts to A's inbox — concurrent shares would contend on
  // that one log and race to create the shared-out/ container. Sequential is also
  // how the real flow runs (one share at a time from the UI).
  for (const s of seeded) {
    await shareBuildingData(s.uri, a.webId, b.session, { includeEnergyData: false });
  }
  // readInbox folds the grants concurrently, each ensuring shared-in/ — pre-create
  // it once so those folds don't race to create the container (409).
  await ensureContainer(podResources(a.webId).sharedIn, a.session);
  await readInbox(a.session); // archive the grants into A's shared-in/
  return seeded;
}

/** Delete the owner's whole `buildings/` container (best-effort) — reset between sizes. */
export async function wipeBuildings(session: Session, webId: string): Promise<void> {
  await deleteContainerRecursive(`${appRoot(webId)}buildings/`, session).catch(() => {});
}
