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
} from "../../src/services/rdf/building/buildingSerializer.ts";
import { synthDayReadings } from "../../src/services/rdf/energySeriesXlsx.ts";
import { seriesContainerUrl } from "../../src/services/rdf/energyDataset.ts";
import { shareBuildingData, type ShareOptions } from "../../src/services/interop/share.ts";
import { appRoot, getPodBaseUrl } from "../../src/services/pod/solidUtils.ts";
import { deleteContainerRecursive } from "../../src/services/pod/podDelete.ts";
import { ensureContainer, readModifyWrite } from "../../src/services/pod/podWrite.ts";
import { DataFactory } from "n3";
import { mapPooled } from "../../src/lib/pool.ts";
import {
  AS_NS,
  FOAF_IMG,
  FOAF_NAME,
  GRAN_NS,
  SIOC_NS,
  XSD_DATETIME,
} from "../../src/services/rdf/vocabularies.ts";
import {
  createRoom,
  getMembersByRole,
  joinRoom,
  normalizeRoomUrl,
  setMyRole,
} from "../../src/services/interop/dataRoom.ts";
import type { UserRole } from "../../src/types.ts";

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
 * Annual-data years every seeded building carries BY DEFAULT — the example-data
 * baseline: one annual `cons:EnergyDataset` per year, 2020–2025, with
 * per-building, per-year distinct values (so charts and benchmark averages show
 * real, different numbers). Override per call: `lastAnnualYears(K)` for a depth
 * knob, `[]` for a bare building.
 */
export const SEED_ANNUAL_YEARS = [2020, 2021, 2022, 2023, 2024, 2025];

/** The most recent `k` of the seeded annual years (`k=3` → 2023–2025). */
export function lastAnnualYears(k: number): number[] {
  return SEED_ANNUAL_YEARS.slice(Math.max(0, SEED_ANNUAL_YEARS.length - k));
}

/**
 * Seed `n` throwaway buildings into the session owner's Pod via the real
 * serialize→PUT path (coords inline, so no geocoding). Returns their URIs for
 * later cleanup. `n === 0` is a no-op (the empty-Pod baseline).
 *
 * Each building carries one annual `cons:EnergyDataset` per `annualYears` entry
 * (the `_inv_*` field convention → `writeBuildingEnergy`). `seriesDaysOnFirst`
 * makes the FIRST building (`<idPrefix>-0`) a SERIES-ONLY building instead: a
 * PT15M series of that many daily files (96 readings each), no annual data —
 * one designated lazy click target (the `/energy/:id` series chart renders only
 * for buildings without annual data; the bulk load never touches series, so
 * seeding them everywhere would be cost without measurement value).
 */
export async function seedBuildings(
  session: Session,
  webId: string,
  n: number,
  idPrefix = "bench",
  annualYears: number[] = SEED_ANNUAL_YEARS,
  seriesDaysOnFirst = 0,
): Promise<SeededBuilding[]> {
  const specs = Array.from({ length: n }, (_, i) => {
    const id = `${idPrefix}-${i}`;
    const uri = newBuildingUri(webId, id);
    return { i, id, uri, subjectUri: `${uri}#${id}`, fields: buildingFields(i) };
  });
  const seriesYear = annualYears[annualYears.length - 1] ?? 2025;
  // Provision buildings/ ONCE up front: uploadBuilding ensures it per call, and a
  // pool of concurrent first-writers would otherwise race to create it (all see
  // 404, all PUT, the losers get a 409). After this the per-call ensure no-ops.
  if (n > 0) await ensureContainer(`${appRoot(webId)}buildings/`, session);
  return mapPooled(specs, POOL, async (s) => {
    const series = s.i === 0 && seriesDaysOnFirst > 0
      ? {
        year: seriesYear,
        label: "bench series",
        days: consecutiveDates(seriesYear, seriesDaysOnFirst).map((date) => ({
          date,
          readings: synthDayReadings(date),
        })),
      }
      : undefined;
    // The series click target stays series-only; every other building carries
    // the annual baseline.
    const yearsFor = series ? [] : annualYears;
    const energyFields = Object.fromEntries(
      yearsFor.flatMap((year) => [
        [`_inv_elec_${year}`, String(10_000 + s.i * 137 + (year - 2020) * 250)],
        [`_inv_heat_${year}`, String(20_000 + s.i * 211 + (year - 2020) * 400)],
      ]),
    );
    const links = yearsFor.length > 0 || series
      ? await writeBuildingEnergy(session, s.uri, s.subjectUri, energyFields, series)
      : undefined;
    const ttl = serializeBuildingToTurtle(s.fields, s.uri, links, {
      agent: webId,
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
 * Give an actor's WebID profile a human identity: a `foaf:name` plus a publicly
 * readable avatar image (PUT beside the profile document, linked via `foaf:img`)
 * — so agent labels resolve to a name + face across pods instead of the WebID
 * fragment. The avatar gets its own public-read `.acl`: other agents' browsers
 * load it via a plain `<img src>`, i.e. unauthenticated. The profile write is the
 * app's model-2 in-place mutation (read–modify–write, never PATCH).
 */
export async function seedProfile(
  x: BenchActor,
  name: string,
  avatar?: { bytes: Uint8Array; mime: string },
): Promise<void> {
  const { namedNode, literal } = DataFactory;
  let avatarUrl: string | undefined;
  if (avatar) {
    avatarUrl = `${getPodBaseUrl(x.webId)}avatar.png`;
    const put = await x.session.fetch(avatarUrl, {
      method: "PUT",
      headers: { "Content-Type": avatar.mime },
      body: avatar.bytes as BodyInit,
    });
    if (!put.ok) {
      throw new Error(`seed avatar: PUT ${avatarUrl} → HTTP ${put.status}`);
    }
    const acl = [
      "@prefix acl: <http://www.w3.org/ns/auth/acl#>.",
      "@prefix foaf: <http://xmlns.com/foaf/0.1/>.",
      `<#public> a acl:Authorization; acl:accessTo <${avatarUrl}>;`,
      "  acl:agentClass foaf:Agent; acl:mode acl:Read.",
      `<#owner> a acl:Authorization; acl:accessTo <${avatarUrl}>;`,
      `  acl:agent <${x.webId}>; acl:mode acl:Read, acl:Write, acl:Control.`,
      "",
    ].join("\n");
    const aclPut = await x.session.fetch(`${avatarUrl}.acl`, {
      method: "PUT",
      headers: { "Content-Type": "text/turtle" },
      body: acl,
    });
    if (!aclPut.ok) {
      throw new Error(`seed avatar: PUT ${avatarUrl}.acl → HTTP ${aclPut.status}`);
    }
  }
  const docUrl = x.webId.split("#")[0];
  await readModifyWrite(docUrl, x.session, (store, { created }) => {
    if (created) {
      // A WebID profile is provisioned by the identity provider, never by us.
      throw new Error(`seed profile: no profile document at ${docUrl}`);
    }
    store.addQuad(namedNode(x.webId), namedNode(FOAF_NAME), literal(name));
    if (avatarUrl) {
      store.addQuad(namedNode(x.webId), namedNode(FOAF_IMG), namedNode(avatarUrl));
    }
  });
}

/**
 * One-time room setup for the via-room share flow: B (the sharer) creates the
 * room, A joins and assumes `role` — so B's per-share role resolution finds
 * exactly A, mirroring the share dialog's "By role" path.
 */
export async function setupShareRoom(
  a: BenchActor,
  b: BenchActor,
  role: UserRole = "investor",
): Promise<string> {
  const room = await createRoom(b.session);
  await joinRoom(room, a.session);
  await setMyRole(room, [role], a.session);
  return room;
}

/**
 * B shares each seeded building with the room members holding `role` — the
 * dialog's "By role" flow verbatim: every share action re-resolves the role to
 * member WebIDs (a fold of the room log), then shares to each. SERIAL on
 * purpose: each share appends to B's single shared-out log and posts to the
 * recipient's inbox — concurrent shares would contend on that one log and race
 * to create the shared-out/ container; sequential is also how the real flow
 * runs (one share at a time from the UI). The default share scope INCLUDES
 * energy — the dialog's default, and the only scope consistent with seeded
 * buildings that carry annual data (an energy-less grant would make the
 * recipient's timed load burn one 403 per dataset, a flow real shares never
 * produce).
 */
export async function shareBuildingsViaRoom(
  b: BenchActor,
  room: string,
  buildings: SeededBuilding[],
  role: UserRole = "investor",
  options: ShareOptions = { includeEnergyData: true },
): Promise<void> {
  for (const s of buildings) {
    const recipients = await getMembersByRole(room, role, b.session);
    for (const recipient of recipients) {
      await shareBuildingData(s.uri, recipient, b.session, options);
    }
  }
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
