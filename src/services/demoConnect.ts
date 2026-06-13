import type { Session } from "@inrupt/solid-client-authn-browser";
import { appRoot } from "./pod/solidUtils.ts";
import { ensureContainer } from "./pod/podWrite.ts";
import { addContact } from "./contacts.ts";
import { createRoom } from "./interop/dataRoom.ts";
import { FOAF_AGENT, FOAF_NAME } from "./rdf/vocabularies.ts";
import { logError } from "../lib/logError.ts";

/**
 * Dev-mode demo seeding for the Connect tab (contacts + data rooms), the
 * sibling of `seedDemoBuildings`: fills the lists with enough entries to
 * exercise layout and paging on a real Pod. 21 of each — one more than a list
 * page (see `DEFAULT_PAGE_SIZE`), so the pager and its spillover page show.
 */

/**
 * The demo address book. Each contact's WebID points at a fixture profile
 * written to the user's own Pod (`<appRoot>demo-contacts/`), so the app's live
 * name resolution (`AgentLabel` → `resolveAgent`) finds a `foaf:name` — a
 * non-resolving WebID would render as its bare `#fragment`. Living under the
 * app collection, the fixtures are covered by "Remove all app data…".
 */
export const DEMO_CONTACT_NAMES: readonly string[] = [
  "Anna Albers",
  "Bruno Becker",
  "Clara Conrad",
  "David Dreyer",
  "Emma Engel",
  "Felix Fischer",
  "Greta Gruber",
  "Henrik Hofmann",
  "Ida Iversen",
  "Jonas Jung",
  "Katja Krause",
  "Lukas Lehmann",
  "Mara Meier",
  "Nils Neumann",
  "Olivia Otte",
  "Paul Petersen",
  "Quirin Quast",
  "Rosa Richter",
  "Stefan Sommer",
  "Tina Thiel",
  "Ulrich Unger",
];

/** How many demo data rooms {@link seedDemoRooms} creates. */
export const DEMO_ROOM_COUNT = 21;

/**
 * Seed the demo contacts: write each fixture profile, then add it to the
 * address book. Idempotent — re-running re-PUTs the same profiles and
 * `addContact` updates in place rather than duplicating. Best-effort per
 * contact like `seedDemoBuildings`: failures are logged and tallied, and only
 * a total failure throws.
 * @operation mutation
 */
export async function seedDemoContacts(
  session: Session,
): Promise<{ seeded: number; total: number }> {
  const webId = session.info.webId;
  if (!webId) throw new Error("Not logged in");
  const container = `${appRoot(webId)}demo-contacts/`;
  await ensureContainer(container, session);
  let seeded = 0;
  for (const name of DEMO_CONTACT_NAMES) {
    try {
      const doc = `${container}${name.toLowerCase().replace(/\s+/g, "-")}.ttl`;
      const res = await session.fetch(doc, {
        method: "PUT",
        headers: { "Content-Type": "text/turtle" },
        body: `<#me> a <${FOAF_AGENT}> ;\n  <${FOAF_NAME}> "${name}" .\n`,
      });
      if (!res.ok) {
        throw new Error(`Failed to write ${doc} (HTTP ${res.status})`);
      }
      await addContact(session, { webId: `${doc}#me`, name });
      seeded++;
    } catch (err) {
      logError("seed demo contact", err);
    }
  }
  if (seeded === 0) throw new Error("no contact could be written");
  return { seeded, total: DEMO_CONTACT_NAMES.length };
}

/**
 * Seed {@link DEMO_ROOM_COUNT} demo data rooms on the user's own Pod. Each
 * `createRoom` enters the new room (so the last one created ends up current,
 * all of them bookmarked). NOT idempotent — rooms are identified by fresh
 * UUIDs, so re-running adds another batch. Best-effort per room; only a total
 * failure throws. Returns the created room IRIs so the caller can patch the
 * room-registry cache (which is owned by mutations, never invalidated).
 * @operation mutation
 */
export async function seedDemoRooms(
  session: Session,
  count: number = DEMO_ROOM_COUNT,
): Promise<{ rooms: string[]; total: number }> {
  const rooms: string[] = [];
  for (let i = 0; i < count; i++) {
    try {
      rooms.push(await createRoom(session));
    } catch (err) {
      logError("seed demo data room", err);
    }
  }
  if (rooms.length === 0) throw new Error("no data room could be created");
  return { rooms, total: count };
}
