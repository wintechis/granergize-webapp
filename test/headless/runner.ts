/// <reference lib="deno.ns" />
/**
 * Tier-2 headless runner (`deno task it`). Boots ONE throwaway local CSS with two
 * seeded accounts, sets up the A/B actors (concurrently — the same actor model the
 * browser tier uses), then runs each per-slug task module in `tasks/`. A failure
 * here is an app-LOGIC bug ("in principle"); the same task failing in the browser
 * tier ("in practice") points at server interop. Self-cleaning: each task tidies
 * its own resources, and the whole CSS + temp dir is torn down at the end.
 *
 *   deno task it      (no credentials needed — local CSS, fixed creds)
 */
import { getLiveSession, type LiveSessionLike } from "./liveSession.ts";
import { type LocalCss, startLocalCss } from "./localCss.ts";
import type { Session } from "@inrupt/solid-client-authn-browser";
import { resolveStorageRoot } from "../../src/services/utils/solidUtils.ts";
import { ensureOwnInbox } from "../../src/services/interop/inbox.ts";
import {
  type Actor,
  makeHarness,
  type TaskContext,
  type TaskModule,
} from "./taskContext.ts";
import * as dataRoom from "./tasks/data-room.ts";
import * as shareBuilding from "./tasks/share-building.ts";
import * as shareView from "./tasks/share-view.ts";
import * as addBuilding from "./tasks/add-building.ts";
import * as attachmentShare from "./tasks/attachment-share.ts";
import * as archiveRestore from "./tasks/archive-restore.ts";
import * as deleteSharedBuilding from "./tasks/delete-shared-building.ts";

const TASKS: TaskModule[] = [
  dataRoom,
  shareBuilding,
  shareView,
  addBuilding,
  attachmentShare,
  archiveRestore,
  deleteSharedBuilding,
];

const harness = makeHarness();
console.log("starting local CSS…");
const css: LocalCss = await startLocalCss().catch((e): never => {
  console.error(`\x1b[31mFAIL\x1b[0m — could not start local CSS:\n${e}`);
  return Deno.exit(1);
});
console.log(`local CSS up at ${css.baseUrl}`);

let sA: LiveSessionLike | undefined;
let sB: LiveSessionLike | undefined;
try {
  const issuer = css.baseUrl.replace(/\/$/, "");
  [sA, sB] = await Promise.all([
    getLiveSession(issuer, css.A.email, css.A.password, css.A.webId),
    getLiveSession(issuer, css.B.email, css.B.password, css.B.webId),
  ]);
  const sessionA = sA as unknown as Session;
  const sessionB = sB as unknown as Session;
  // Native storage discovery (pim:Storage-typed root) — no card edit needed.
  await resolveStorageRoot(sessionA);
  await resolveStorageRoot(sessionB);
  // Provision each account's granergize inbox exactly as the app does at login
  // (container + append ACL + discovery pointer). On a bare CSS Pod the app must
  // do this itself; the runner just calls the same app function.
  await ensureOwnInbox(sessionA);
  await ensureOwnInbox(sessionB);

  const a: Actor = { slot: "A", webId: sessionA.info.webId!, session: sessionA, raw: sA };
  const b: Actor = { slot: "B", webId: sessionB.info.webId!, session: sessionB, raw: sB };
  console.log(`A = ${a.webId}\nB = ${b.webId}`);
  const ctx: TaskContext = { a, b, check: harness.check };

  for (const task of TASKS) {
    console.log(`\ntask: ${task.name}`);
    try {
      await task.run(ctx);
    } catch (e) {
      harness.check(`${task.name} threw`, false, String(e).split("\n")[0]);
    }
  }
} finally {
  console.log("\ncleanup");
  await sA?.dispose().catch(() => {});
  await sB?.dispose().catch(() => {});
  await css.stop();
  console.log("  done");
}

console.log(
  `\n${harness.failed === 0 ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m"} — ${harness.passed} passed, ${harness.failed} failed`,
);
Deno.exit(harness.failed === 0 ? 0 : 1);
