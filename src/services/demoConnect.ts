import type { PodGateway } from "./pod/podGateway.ts";
import { appRoot } from "./pod/solidUtils.ts";
import { ensureContainer } from "./pod/podWrite.ts";
import { saveAgents } from "./savedAgents.ts";
import { createRoom } from "./interop/dataRoom.ts";
import { FOAF_AGENT, FOAF_NAME } from "./rdf/vocabularies.ts";
import { logError } from "../lib/logError.ts";

/**
 * Dev-mode demo seeding for the Connect tab (agents + data rooms), the
 * sibling of `seedDemoBuildings`: fills the lists with enough entries to
 * exercise layout and paging on a real Pod. 21 of each — one more than a list
 * page (see `DEFAULT_PAGE_SIZE`), so the pager and its spillover page show.
 */

/**
 * The demo address book. Each contact's WebID points at a fixture profile
 * written to the user's own Pod (`<appRoot>demo-agents/`), so the app's live
 * name resolution (`AgentLabel` → `resolveAgent`) finds a `foaf:name` — a
 * non-resolving WebID would render as its bare `#fragment`. Living under the
 * app collection, the fixtures are covered by "Remove all app data…".
 */
export const DEMO_AGENT_NAMES: readonly string[] = [
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
 * `saveAgent` updates in place rather than duplicating. Best-effort per
 * contact like `seedDemoBuildings`: failures are logged and tallied, and only
 * a total failure throws.
 * @operation mutation
 */
export async function seedDemoAgents(
  gateway: PodGateway,
): Promise<{ seeded: number; total: number }> {
  const webId = gateway.webId;
  if (!webId) throw new Error("Not logged in");
  const container = `${appRoot(webId)}demo-agents/`;
  await ensureContainer(container, gateway);
  // Write each fixture profile to its OWN resource (distinct URIs never contend),
  // collecting the ones that landed. Then add all of them to the address book in a
  // SINGLE read-modify-write (saveAgents) — a per-agent write would race the
  // concurrent building import's rememberAgent writes to agents.ttl and drop entries.
  const written: { webId: string; name: string }[] = [];
  for (const name of DEMO_AGENT_NAMES) {
    try {
      const doc = `${container}${name.toLowerCase().replace(/\s+/g, "-")}.ttl`;
      const res = await gateway.fetch(doc, {
        method: "PUT",
        headers: { "Content-Type": "text/turtle" },
        body: `<#me> a <${FOAF_AGENT}> ;\n  <${FOAF_NAME}> "${name}" .\n`,
      });
      if (!res.ok) {
        throw new Error(`Failed to write ${doc} (HTTP ${res.status})`);
      }
      written.push({ webId: `${doc}#me`, name });
    } catch (err) {
      logError("seed demo agent", err);
    }
  }
  if (written.length === 0) throw new Error("no demo agent could be written");
  await saveAgents(gateway, written);
  return { seeded: written.length, total: DEMO_AGENT_NAMES.length };
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
  gateway: PodGateway,
  count: number = DEMO_ROOM_COUNT,
): Promise<{ rooms: string[]; total: number }> {
  const rooms: string[] = [];
  for (let i = 0; i < count; i++) {
    try {
      rooms.push(await createRoom(gateway));
    } catch (err) {
      logError("seed demo data room", err);
    }
  }
  if (rooms.length === 0) throw new Error("no data room could be created");
  return { rooms, total: count };
}
