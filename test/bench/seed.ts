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
import { drainInbox } from "../../src/services/interop/inbox.ts";
import { appRoot, podResources } from "../../src/services/utils/solidUtils.ts";
import { deleteContainerRecursive } from "../../src/services/utils/podDelete.ts";
import { ensureContainer } from "../../src/services/utils/podWrite.ts";
import { mapPooled } from "../../src/services/utils/pool.ts";
import {
  AS_NS,
  GRAN_NS,
  SIOC_NS,
  XSD_DATETIME,
} from "../../src/services/utils/vocabularies.ts";
import { normalizeRoomUrl } from "../../src/services/interop/dataRoom.ts";

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
  // drainInbox folds the grants concurrently, each ensuring shared-in/ — pre-create
  // it once so those folds don't race to create the container (409).
  await ensureContainer(podResources(a.webId).sharedIn, a.session);
  await drainInbox(a.session); // archive the grants into A's shared-in/
  return seeded;
}

/** Delete the owner's whole `buildings/` container (best-effort) — reset between sizes. */
export async function wipeBuildings(session: Session, webId: string): Promise<void> {
  await deleteContainerRecursive(`${appRoot(webId)}buildings/`, session).catch(() => {});
}

/**
 * Seed `n` synthetic members into a data-room log by POSTing `n` immutable
 * `as:Join` events — one per distinct (synthetic) WebID — straight into the room
 * container, matching the event shape `dataRoom.ts`'s `postEvent` writes. The
 * room's own mutations always act as the SESSION owner (one WebID), so they can't
 * grow a multi-member room; this seeds the membership axis that the read fold
 * (`getMembers`) and `deleteRoom` scale against. Appends are pure POSTs, so —
 * unlike a read-modify-write log — concurrent writers don't contend; pooled.
 */
export async function seedRoomMembers(
  session: Session,
  roomUrl: string,
  n: number,
): Promise<void> {
  const container = normalizeRoomUrl(roomUrl);
  if (n > 0) await ensureContainer(container, session);
  const webIds = Array.from(
    { length: n },
    (_, i) => `https://bench.example/member-${i}/profile/card#me`,
  );
  await mapPooled(webIds, POOL, async (webId) => {
    const body = `@prefix as: <${AS_NS}> .\n` +
      `@prefix xsd: <${XSD_DATETIME.replace(/dateTime$/, "")}> .\n` +
      `[] a as:Join ;\n` +
      `   as:actor <${webId}> ;\n` +
      `   as:object <${container}> ;\n` +
      `   as:published "2024-01-01T00:00:00.000Z"^^xsd:dateTime .\n`;
    const res = await session.fetch(container, {
      method: "POST",
      headers: { "Content-Type": "text/turtle" },
      body,
    });
    if (!res.ok) throw new Error(`seed room member (HTTP ${res.status})`);
  });
}

// Valid role IRIs (must match dataRoom.ts's ROLE_TO_IRI, or the fold filters them
// out as unknown) — cycled across the seeded role events.
const CHURN_ROLE_IRIS = [`${GRAN_NS}InvestorRole`, `${GRAN_NS}UserRoleInstance`];

/**
 * Seed `roleEvents` role-assignment (`as:Update`) events into a room log,
 * round-robined across the first `members` synthetic member WebIDs with strictly
 * increasing timestamps (so the fold's latest-per-agent is deterministic). Matches
 * the `as:Update` + `sioc:has_function` shape `setMyRole` writes. This grows the
 * log's HISTORY without adding members — the axis that exposes that the
 * append-only log is folded by reading EVERY event, even though only the latest
 * event per agent survives. Pair with {@link seedRoomMembers} (membership) so the
 * fold still returns those members. `members`/`roleEvents` ≤ 0 are no-ops.
 */
export async function seedRoomRoleChurn(
  session: Session,
  roomUrl: string,
  members: number,
  roleEvents: number,
): Promise<void> {
  if (members <= 0 || roleEvents <= 0) return;
  const container = normalizeRoomUrl(roomUrl);
  await ensureContainer(container, session);
  const base = new Date("2025-01-01T00:00:00Z").getTime();
  const events = Array.from({ length: roleEvents }, (_, i) => ({
    webId: `https://bench.example/member-${i % members}/profile/card#me`,
    role: CHURN_ROLE_IRIS[i % CHURN_ROLE_IRIS.length],
    at: new Date(base + i * 1000).toISOString(),
  }));
  await mapPooled(events, POOL, async (e) => {
    const body = `@prefix as: <${AS_NS}> .\n` +
      `@prefix sioc: <${SIOC_NS}> .\n` +
      `@prefix xsd: <${XSD_DATETIME.replace(/dateTime$/, "")}> .\n` +
      `[] a as:Update ;\n` +
      `   as:actor <${e.webId}> ;\n` +
      `   as:object <${container}> ;\n` +
      `   as:published "${e.at}"^^xsd:dateTime ;\n` +
      `   sioc:has_function <${e.role}> .\n`;
    const res = await session.fetch(container, {
      method: "POST",
      headers: { "Content-Type": "text/turtle" },
      body,
    });
    if (!res.ok) throw new Error(`seed role churn (HTTP ${res.status})`);
  });
}

/** Delete the owner's whole `rooms/` container (best-effort) — reset between sizes. */
export async function wipeRooms(session: Session, webId: string): Promise<void> {
  await deleteContainerRecursive(`${appRoot(webId)}rooms/`, session).catch(() => {});
}
