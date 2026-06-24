/// <reference lib="deno.ns" />
/**
 * Tier-2 headless runner (`deno task headless:local`). Boots ONE throwaway local CSS with two
 * seeded accounts, sets up the A/B actors (concurrently — the same actor model the
 * browser tier uses), then runs each per-slug task module in `tasks/`. A failure
 * here is an app-LOGIC bug ("in principle"); the same task failing in the browser
 * tier ("in practice") points at server interop. Self-cleaning: each task tidies
 * its own resources, and the whole CSS + temp dir is torn down at the end.
 *
 *   deno task headless:local      (no credentials needed — local CSS, fixed creds)
 */
import type { LiveSessionLike } from "./localPod.ts";
import { type SessionSource, sessionSource } from "./sessionSource.ts";
import { podGateway } from "../../src/services/pod/podGateway.ts";
import { resolveStorageRoot } from "../../src/services/pod/solidUtils.ts";
import { ensureOwnInbox } from "../../src/services/interop/inbox.ts";
import {
  type Actor,
  makeHarness,
  type TaskContext,
  type TaskModule,
} from "./taskContext.ts";
import * as dataRoom from "./tasks/data-room.ts";
import * as shareBuilding from "./tasks/share-building.ts";
import * as shareAggregation from "./tasks/share-aggregation.ts";
import * as addBuilding from "./tasks/add-building.ts";
import * as excelRoundtrip from "./tasks/excel-roundtrip.ts";
import * as attachmentShare from "./tasks/attachment-share.ts";
import * as archiveRestore from "./tasks/archive-restore.ts";
import * as deleteSharedBuilding from "./tasks/delete-shared-building.ts";
import * as benchmark from "./tasks/benchmark.ts";
import * as grantProjection from "./tasks/grant-projection.ts";
import * as roomsIntent from "./tasks/rooms-intent.ts";
import * as sharingIntent from "./tasks/sharing-intent.ts";
import * as contacts from "./tasks/contacts.ts";
import * as seedDemos from "./tasks/seed-demos.ts";

const TASKS: TaskModule[] = [
  dataRoom,
  shareBuilding,
  shareAggregation,
  addBuilding,
  excelRoundtrip,
  attachmentShare,
  archiveRestore,
  deleteSharedBuilding,
  benchmark,
  grantProjection,
  roomsIntent,
  sharingIntent,
  contacts,
  seedDemos,
];

const harness = makeHarness();
console.log("starting session source…");
const source: SessionSource = await sessionSource().catch((e): never => {
  console.error(`\x1b[31mFAIL\x1b[0m — could not start session source:\n${e}`);
  return Deno.exit(1);
});
console.log(`session source up: ${source.label}`);

let sA: LiveSessionLike | undefined;
let sB: LiveSessionLike | undefined;
let sC: LiveSessionLike | undefined;
try {
  [sA, sB, sC] = await Promise.all([
    source.liveSession("A"),
    source.liveSession("B"),
    source.liveSession("C"),
  ]);
  // Adapt each live session into the flat data-layer port (`{fetch, webId}`); the
  // raw `LiveSessionLike` is kept on the Actor for direct fetches (snapshot/restore).
  // The hand-rolled `fetch` only accepts `string | URL` (all the data layer ever
  // passes), narrower than `typeof globalThis.fetch` — cast at this one boundary.
  const asFetch = (f: LiveSessionLike["fetch"]) => f as typeof globalThis.fetch;
  const sessionA = podGateway(asFetch(sA.fetch), sA.info.webId);
  const sessionB = podGateway(asFetch(sB.fetch), sB.info.webId);
  const sessionC = podGateway(asFetch(sC.fetch), sC.info.webId);
  // Native storage discovery (pim:Storage-typed root) — no card edit needed.
  await resolveStorageRoot(sessionA);
  await resolveStorageRoot(sessionB);
  await resolveStorageRoot(sessionC);
  // Provision each account's granergize inbox exactly as the app does at login
  // (container + append ACL + discovery pointer). On a bare CSS Pod the app must
  // do this itself; the runner just calls the same app function.
  await ensureOwnInbox(sessionA);
  await ensureOwnInbox(sessionB);
  await ensureOwnInbox(sessionC);

  const a: Actor = { slot: "A", webId: sessionA.webId, session: sessionA, raw: sA };
  const b: Actor = { slot: "B", webId: sessionB.webId, session: sessionB, raw: sB };
  const c: Actor = { slot: "C", webId: sessionC.webId, session: sessionC, raw: sC };
  console.log(`A = ${a.webId}\nB = ${b.webId}\nC = ${c.webId}`);
  const ctx: TaskContext = { a, b, c, check: harness.check };

  // Optional slug filter: `deno task headless:local <slug> [<slug>…]` runs only those task
  // modules (handy for hunting one task in isolation); no args runs all.
  const only = new Set(Deno.args);
  const selected = only.size ? TASKS.filter((t) => only.has(t.name)) : TASKS;
  for (const task of selected) {
    console.log(`\ntask: ${task.name}`);
    try {
      await task.run(ctx);
    } catch (e) {
      harness.check(`${task.name} threw`, false, String(e).split("\n")[0]);
      if (Deno.env.get("IT_STACK") && e instanceof Error) console.error(e.stack);
    }
  }
} finally {
  console.log("\ncleanup");
  await sA?.dispose().catch(() => {});
  await sB?.dispose().catch(() => {});
  await sC?.dispose().catch(() => {});
  await source.teardown();
  console.log("  done");
}

console.log(
  `\n${harness.failed === 0 ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m"} — ${harness.passed} passed, ${harness.failed} failed`,
);
Deno.exit(harness.failed === 0 ? 0 : 1);
