/// <reference lib="deno.ns" />
/**
 * Headless CROSS-POD interop integration test against a throwaway LOCAL Community
 * Solid Server with two seeded accounts (A and B).
 *
 * Runs the *actual* app data-room / sharing functions over two headless DPoP
 * sessions — no browser, no ~50 s OIDC login, no network — to verify the cross-Pod
 * behaviour that fake-Pod unit tests can't reach (real WAC ACL enforcement,
 * read-after-write, B's events visible to A). This is the fast logic tier that
 * complements the Playwright browser specs (`sharing.spec.ts` / `view-sharing.spec.ts`):
 * if a scenario fails here it's an app-logic bug; if it passes here but fails in the
 * browser against the real Pods, the bug is specific to those servers (NSS / CSS v5).
 *
 *   deno task it      (no credentials needed — local CSS, fixed creds)
 *
 * Self-cleaning: the whole CSS instance + its temp dir are torn down in `finally`.
 *
 * Scenario (i) is the regression check for THE bug: after A hosts a room and B
 * joins + takes a role, A's getMembers(room) must include B. (ii) share-by-role
 * and (iii) view share+revoke are added in Phase 3.
 */
import { type LocalCss, startLocalCss } from "./localCss.ts";
import { getLiveSession, type LiveSessionLike } from "./liveSession.ts";
import type { Session } from "@inrupt/solid-client-authn-browser";

type Fetcher = Pick<LiveSessionLike, "fetch">;
import {
  createRoom,
  deleteRoom,
  enterRoom,
  getMembers,
  getMembersByRole,
  setMyRole,
} from "../../src/services/interop/dataRoom.ts";
import { podResources, resolveStorageRoot } from "../../src/services/utils/solidUtils.ts";

let pass = 0;
let fail = 0;
function check(label: string, cond: boolean, detail = "") {
  if (cond) {
    console.log(`  \x1b[32m✓\x1b[0m ${label}`);
    pass++;
  } else {
    console.log(`  \x1b[31m✗\x1b[0m ${label}${detail ? ` — ${detail}` : ""}`);
    fail++;
  }
}

async function snapshot(s: Fetcher, url: string): Promise<string | null> {
  const r = await s.fetch(`${url}?t=${Date.now()}`).catch(() => null);
  return r && r.status === 200 ? await r.text() : null;
}
async function restore(s: Fetcher, url: string, body: string | null) {
  if (body === null) {
    await s.fetch(url, { method: "DELETE" }).catch(() => {});
  } else {
    await s.fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "text/turtle" },
      body,
    }).catch(() => {});
  }
}

// ── Boot a local CSS with two seeded accounts, then two headless sessions ─────
console.log("starting local CSS…");
const css: LocalCss = await startLocalCss().catch((e): never => {
  console.error(`\x1b[31mFAIL\x1b[0m — could not start local CSS:\n${e}`);
  return Deno.exit(1);
});
console.log(`local CSS up at ${css.baseUrl}`);

const issuer = css.baseUrl.replace(/\/$/, "");

/**
 * Freshly-seeded CSS WebID cards omit `pim:storage` (the pod root is typed
 * `pim:Storage` instead — a newer discovery convention). The real Pods the app
 * targets DO carry `pim:storage` on the card, which is what `resolveStorageRoot`
 * reads. Write it (as the card's owner) so the local substrate matches real Pods;
 * also advertise `ldp:inbox` for the share scenarios.
 */
async function ensureProfileStorage(
  s: Fetcher,
  webId: string,
  podRoot: string,
) {
  const card = webId.split("#")[0];
  const body =
    `@prefix foaf: <http://xmlns.com/foaf/0.1/>.
@prefix solid: <http://www.w3.org/ns/solid/terms#>.
@prefix pim: <http://www.w3.org/ns/pim/space#>.
@prefix ldp: <http://www.w3.org/ns/ldp#>.
<> a foaf:PersonalProfileDocument; foaf:primaryTopic <${webId}>.
<${webId}> a foaf:Person;
  solid:oidcIssuer <${css.baseUrl}>;
  pim:storage <${podRoot}>;
  ldp:inbox <${podRoot}inbox/>.
`;
  const r = await s.fetch(card, {
    method: "PUT",
    headers: { "Content-Type": "text/turtle" },
    body,
  });
  if (!r.ok) throw new Error(`could not write ${card} profile (HTTP ${r.status})`);
}

let sessionA!: Session;
let sessionB!: Session;
let sA!: Awaited<ReturnType<typeof getLiveSession>>;
let sB!: Awaited<ReturnType<typeof getLiveSession>>;
let webIdA = "";
let webIdB = "";

try {
  sA = await getLiveSession(issuer, css.A.email, css.A.password, css.A.webId);
  sB = await getLiveSession(issuer, css.B.email, css.B.password, css.B.webId);
  sessionA = sA as unknown as Session;
  sessionB = sB as unknown as Session;

  await ensureProfileStorage(sA, css.A.webId, `${css.baseUrl}${css.A.pod}/`);
  await ensureProfileStorage(sB, css.B.webId, `${css.baseUrl}${css.B.pod}/`);

  // REQUIRED before any path helper: populates the getStorageRoot cache from
  // pim:storage. Without it createRoom / podResources / prefs throw.
  const rootA = await resolveStorageRoot(sessionA);
  const rootB = await resolveStorageRoot(sessionB);
  webIdA = sessionA.info.webId!;
  webIdB = sessionB.info.webId!;
  console.log(`A = ${webIdA}  (${rootA})`);
  console.log(`B = ${webIdB}  (${rootB})`);

  // ── Scenario (i): room membership — A sees B (THE bug) ─────────────────────
  console.log("\nscenario (i): room membership — A sees B");
  // enterRoom/setMyRole mutate B's prefs.ttl (currentRoom) + bookmarks.ttl.
  const bPrefs = podResources(webIdB).prefs;
  const bBookmarks = podResources(webIdB).bookmarks;
  const bPrefsSnap = await snapshot(sB, bPrefs);
  const bBookmarksSnap = await snapshot(sB, bBookmarks);

  let room = "";
  try {
    room = await createRoom(sessionA); // A: container + ACL (AuthenticatedAgent R+Append) + auto-join
    check("A created a room", Boolean(room), room);

    await enterRoom(room, sessionB); // B: POST as:Join into A's container
    await setMyRole(room, ["investor"], sessionB); // B: POST as:Update role event

    const members = await getMembers(room, sessionA); // A: fresh fold (readLog → fetchFresh)
    const memberIds = members.map((m) => m.webId);
    console.log(`    A's getMembers → [${memberIds.join(", ") || "(empty)"}]`);

    check("A sees itself as a member", memberIds.includes(webIdA));
    check(
      "A SEES B as a member (the regression)",
      memberIds.includes(webIdB),
      `members=[${memberIds.join(", ")}]`,
    );

    const byRole = await getMembersByRole(room, "investor", sessionA);
    check(
      "share-by-role resolves the Investor role to B",
      byRole.includes(webIdB),
      `byRole=[${byRole.join(", ")}]`,
    );
  } finally {
    if (room) await deleteRoom(room, sessionA).catch(() => {});
    // B joined → its prefs/bookmarks point at the now-deleted room; restore them.
    await restore(sB, bPrefs, bPrefsSnap);
    await restore(sB, bBookmarks, bBookmarksSnap);
  }
} finally {
  console.log("\ncleanup");
  await sA?.dispose().catch(() => {});
  await sB?.dispose().catch(() => {});
  await css.stop();
  console.log("  done");
}

console.log(
  `\n${fail === 0 ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m"} — ${pass} passed, ${fail} failed`,
);
Deno.exit(fail === 0 ? 0 : 1);
