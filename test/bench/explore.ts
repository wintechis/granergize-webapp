/// <reference lib="deno.ns" />
/**
 * Interactive look at the bench's shared-buildings scenario: boots the local
 * Pod server (JSS by default via the task), seeds B with N buildings and
 * shares them all with A via a data room — then STAYS UP so you can log into
 * the real app and browse the data as either actor. Ctrl-C stops the server.
 *
 *   deno task explore              # N=20
 *   EXPLORE_N=100 deno task explore
 *   EXPLORE_CONTACTS=21 EXPLORE_ROOMS=21 deno task explore   # Connect tab at scale
 *   LOCAL_POD_SERVER=css deno run -A --node-modules-dir=auto test/bench/explore.ts
 *
 * EXPLORE_CONTACTS seeds A's address book with that many contacts (each backed
 * by a real fixture profile on A's Pod so AgentLabel resolves a display name);
 * EXPLORE_ROOMS makes A create that many data rooms (bookmarked, the last one
 * current) before joining B's share room. Both default to 0.
 *
 * In another terminal: `deno task dev`, open http://localhost:5173 and log in
 * with the Pod URL printed below as the identity provider — as B (the sharer)
 * the Manage tab lists the seeded buildings with their "Shared with" badges;
 * as A (the recipient) the Share tab lists them under "Buildings shared with
 * you" and they paint the map. Enable Developer mode (footer toggle) for the
 * raw RDF source links (buildings/, shared-out/, shared-in/, the room log).
 */
import type { Session } from "@inrupt/solid-client-authn-browser";
import { type LocalPod, startLocalPod } from "../headless/localPod.ts";
import {
  podResources,
  resolveStorageRoot,
} from "../../src/services/pod/solidUtils.ts";
import { drainInbox, ensureOwnInbox } from "../../src/services/interop/inbox.ts";
import { ensureContainer } from "../../src/services/pod/podWrite.ts";
import { addContact } from "../../src/services/contacts.ts";
import { createRoom } from "../../src/services/interop/dataRoom.ts";
import {
  type BenchActor,
  seedBuildings,
  setupShareRoom,
  shareBuildingsViaRoom,
} from "./seed.ts";

const N = Number(Deno.env.get("EXPLORE_N") ?? "20");
const CONTACTS = Number(Deno.env.get("EXPLORE_CONTACTS") ?? "0");
const ROOMS = Number(Deno.env.get("EXPLORE_ROOMS") ?? "0");

console.log("starting local Pod server…");
const pod: LocalPod = await startLocalPod();
console.log(`local Pod up at ${pod.baseUrl}`);

const [sA, sB] = await Promise.all([
  pod.liveSession("A"),
  pod.liveSession("B"),
]);
const sessionA = sA as unknown as Session;
const sessionB = sB as unknown as Session;
const rootA = await resolveStorageRoot(sessionA);
await resolveStorageRoot(sessionB);
await ensureOwnInbox(sessionA);
await ensureOwnInbox(sessionB);
const a: BenchActor = { webId: sessionA.info.webId!, session: sessionA };
const b: BenchActor = { webId: sessionB.info.webId!, session: sessionB };

if (CONTACTS > 0) {
  console.log(`seeding ${CONTACTS} contacts on A…`);
  // Each contact's WebID points at a real fixture profile on A's Pod, so the
  // app's live name resolution (AgentLabel → resolveAgent) finds a foaf:name.
  const fixtures = `${rootA}contact-fixtures/`;
  await ensureContainer(fixtures, sessionA);
  for (let i = 1; i <= CONTACTS; i++) {
    const nn = String(i).padStart(2, "0");
    const doc = `${fixtures}c${nn}.ttl`;
    const res = await sessionA.fetch(doc, {
      method: "PUT",
      headers: { "Content-Type": "text/turtle" },
      body: `<#me> a <http://xmlns.com/foaf/0.1/Person> ;\n` +
        `  <http://xmlns.com/foaf/0.1/name> "Contact ${nn}" .\n`,
    });
    if (!res.ok) throw new Error(`PUT ${doc}: HTTP ${res.status}`);
    await addContact(sessionA, { webId: `${doc}#me`, name: `Contact ${nn}` });
  }
}

if (ROOMS > 0) {
  // Before B's share room, so A's join of that room is the last membership move.
  console.log(`seeding ${ROOMS} data rooms on A…`);
  for (let i = 0; i < ROOMS; i++) await createRoom(sessionA);
}

console.log(`seeding ${N} buildings on B, sharing each with A via a data room…`);
const room = await setupShareRoom(a, b);
const seeded = await seedBuildings(b.session, b.webId, N, "bench-shared");
await shareBuildingsViaRoom(b, room, seeded);
// Pre-create shared-in/ so the drain's concurrent folds don't race to create it.
await ensureContainer(podResources(a.webId).sharedIn, sessionA);
await drainInbox(a.session);

const resA = podResources(a.webId);
const resB = podResources(b.webId);
console.log(`
ready — ${N} buildings on B, all shared with A (room: ${room})${
  CONTACTS || ROOMS
    ? `\nplus on A: ${CONTACTS} contacts, ${ROOMS} data rooms`
    : ""
}

log in to the app (other terminal: \`deno task dev\` → http://localhost:5173),
identity provider: ${pod.baseUrl}

  A (recipient)  ${pod.A.email}  /  ${pod.A.password}
                 ${a.webId}
  B (sharer)     ${pod.B.email}  /  ${pod.B.password}
                 ${b.webId}

raw resources (authenticated; visible in-app via Developer mode source links):

  B buildings    ${resB.buildings}
  B shared-out   ${resB.sharedOut}
  A shared-in    ${resA.sharedIn}
  data room      ${room}

server stays up until Ctrl-C.
`);

await pod.status; // hold the process open until the server exits / Ctrl-C
