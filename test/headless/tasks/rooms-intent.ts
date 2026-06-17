/// <reference lib="deno.ns" />
/**
 * Catalog task `rooms-intent` (headless): drive the room lifecycle through the
 * React-free `invoke()` callable layer (`src/intents/registry.ts`), NOT the raw
 * dataRoom service, and assert the Pod-side outcome of each step by READING back
 * (the room registry / `roomExists` / the current-room pointer). This is the
 * Step-5 merge gate proving the room cores do the real Pod work headless.
 *
 * The adapters' React-Query cache patch (`patchRooms`) is browser-only and out of
 * scope here — `invoke` returns the `RoomOutcome` the adapter would have folded.
 */
import { restore, snapshot, type TaskContext } from "../taskContext.ts";
import { invoke } from "../../../src/intents/registry.ts";
import {
  getCurrentRoom,
  getKnownRooms,
  roomExists,
} from "../../../src/services/interop/dataRoom.ts";
import { podResources } from "../../../src/services/pod/solidUtils.ts";

export const name = "rooms-intent";

export async function run(ctx: TaskContext): Promise<void> {
  const { a, check } = ctx;
  const aPrefs = podResources(a.webId).prefs;
  const aBookmarks = podResources(a.webId).bookmarks;
  const snaps = await Promise.all([
    snapshot(a.raw, aPrefs),
    snapshot(a.raw, aBookmarks),
  ]);

  let room = "";
  try {
    // ── CreateRoom (paramless) → a room exists on the Pod ────────────────────
    const created = await invoke("CreateRoom", {}, a.session);
    room = created.room;
    check("invoke(CreateRoom) returned a room URI", Boolean(room), room);
    check(
      "the room container actually exists on the Pod",
      await roomExists(room, a.session),
      room,
    );
    check(
      "the room is in A's known-rooms registry",
      (await getKnownRooms(a.session)).includes(room),
    );
    // createRoom auto-enters, so it is the current room.
    check(
      "current room is the just-created room",
      await getCurrentRoom(a.session) === room,
    );

    // ── ExitRoom → current-room pointer clears ───────────────────────────────
    await invoke("ExitRoom", { roomUri: room }, a.session);
    check(
      "current room is null after invoke(ExitRoom)",
      await getCurrentRoom(a.session) === null,
    );

    // ── EnterRoom → current-room pointer follows again ───────────────────────
    const entered = await invoke("EnterRoom", { roomUri: room }, a.session);
    check("invoke(EnterRoom) normalized the room URI", entered.room === room);
    check(
      "current room is the entered room after invoke(EnterRoom)",
      await getCurrentRoom(a.session) === room,
    );

    // EnterRoom on an unreachable URI throws (reachability check is in the core).
    let threw = false;
    try {
      await invoke(
        "EnterRoom",
        { roomUri: `${a.webId.replace(/\/profile.*$/, "")}/granergize/rooms/does-not-exist-${Date.now()}/` },
        a.session,
      );
    } catch {
      threw = true;
    }
    check("invoke(EnterRoom) on an unreachable URI throws", threw);

    // ── DeleteRoom → the room is gone ────────────────────────────────────────
    await invoke("DeleteRoom", { roomUri: room }, a.session);
    check(
      "the room no longer exists after invoke(DeleteRoom)",
      !(await roomExists(room, a.session)),
    );
    check(
      "the room is dropped from A's known-rooms registry",
      !(await getKnownRooms(a.session)).includes(room),
    );
    room = ""; // already deleted — skip the finally cleanup
  } finally {
    if (room) await invoke("DeleteRoom", { roomUri: room }, a.session).catch(() => {});
    // Restore A's room registry (the lifecycle mutated prefs + bookmarks).
    await restore(a.raw, aPrefs, snaps[0]);
    await restore(a.raw, aBookmarks, snaps[1]);
  }
}
