/// <reference lib="deno.ns" />
/**
 * Catalog task `data-room` (headless): (i) room membership — A sees B; and
 * (v) the current-room pointer follows enter/switch/leave (the area historically
 * blamed on throttle — here it's deterministic).
 */
import { restore, snapshot, type TaskContext } from "../taskContext.ts";
import {
  createRoom,
  deleteRoom,
  enterRoom,
  exitRoom,
  getCurrentRoom,
  getMembers,
  getMembersByRole,
  setMyRole,
} from "../../../src/services/interop/dataRoom.ts";
import { podResources } from "../../../src/services/pod/solidUtils.ts";

export const name = "data-room";

export async function run(ctx: TaskContext): Promise<void> {
  const { a, b, check } = ctx;
  const bPrefs = podResources(b.webId).prefs;
  const bBookmarks = podResources(b.webId).bookmarks;
  const aPrefs = podResources(a.webId).prefs;
  const aBookmarks = podResources(a.webId).bookmarks;
  const snaps = await Promise.all([
    snapshot(b.raw, bPrefs),
    snapshot(b.raw, bBookmarks),
    snapshot(a.raw, aPrefs),
    snapshot(a.raw, aBookmarks),
  ]);

  // ── (i) membership — A sees B ──────────────────────────────────────────────
  let room = "";
  try {
    room = await createRoom(a.session); // container + ACL + auto-join
    check("A created a room", Boolean(room), room);
    await enterRoom(room, b.session); // B POSTs as:Join into A's container
    await setMyRole(room, ["investor"], b.session);

    const members = await getMembers(room, a.session); // A: fresh fold
    const ids = members.map((m) => m.webId);
    check("A sees itself as a member", ids.includes(a.webId));
    check(
      "A SEES B as a member (the regression)",
      ids.includes(b.webId),
      `members=[${ids.join(", ")}]`,
    );
    const byRole = await getMembersByRole(room, "investor", a.session);
    check(
      "share-by-role resolves Investor to B",
      byRole.includes(b.webId),
      `byRole=[${byRole.join(", ")}]`,
    );
  } finally {
    if (room) await deleteRoom(room, a.session).catch(() => {});
  }

  // ── (v) current-room pointer follows enter / switch / leave ────────────────
  let r1 = "";
  let r2 = "";
  try {
    r1 = await createRoom(a.session); // createRoom auto-enters → current = r1
    check("current room is r1 after hosting", await getCurrentRoom(a.session) === r1);
    r2 = await createRoom(a.session); // → current = r2
    check("current room switches to r2", await getCurrentRoom(a.session) === r2);
    await enterRoom(r1, a.session); // switch back
    check("current room switches back to r1", await getCurrentRoom(a.session) === r1);
    await exitRoom(r1, a.session);
    check("current room is null after leaving", await getCurrentRoom(a.session) === null);
  } finally {
    if (r1) await deleteRoom(r1, a.session).catch(() => {});
    if (r2) await deleteRoom(r2, a.session).catch(() => {});
  }

  // Restore both Pods' room registries (enter/exit mutated prefs + bookmarks).
  await restore(b.raw, bPrefs, snaps[0]);
  await restore(b.raw, bBookmarks, snaps[1]);
  await restore(a.raw, aPrefs, snaps[2]);
  await restore(a.raw, aBookmarks, snaps[3]);
}
