/// <reference lib="deno.ns" />
// The palette-vs-registry invariant, testable without a DOM: the rooms
// registry is owned by setQueryData folds and NEVER invalidated (a stale
// conditional read-back can revert a room switch), yet the palette's
// settlement must still make a palette-fired room verb visible — by applying
// the same fold its hook adapter would, not by refetching.
import { strict as assert } from "node:assert";
import { QueryClient } from "@tanstack/react-query";
import type { Session } from "@inrupt/solid-client-authn-browser";
import {
  ROOM_REGISTRY_FOLDS,
  type RoomRegistry,
  settlePaletteInvoke,
} from "./roomRegistry.ts";
import { queryKeys } from "../lib/queryKeys.ts";
import { _setSessionForTesting } from "./session.ts";

const WEBID = "https://pod.example/profile/card#me";
const ROOM_A = "https://pod.example/granergize/rooms/a/";
const ROOM_B = "https://pod.example/granergize/rooms/b/";

_setSessionForTesting(
  { info: { isLoggedIn: true, webId: WEBID }, fetch: () => Promise.reject(new Error("no I/O in this suite")) } as unknown as Session,
);

const ROOMS_KEY = [...queryKeys.rooms, WEBID];

function seededClient(): QueryClient {
  const qc = new QueryClient();
  qc.setQueryData<RoomRegistry>(ROOMS_KEY, { known: [ROOM_A], current: ROOM_A });
  qc.setQueryData(["buildingsContainer", WEBID], ["b1"]);
  return qc;
}

Deno.test("settlePaletteInvoke: a palette room switch patches the registry and does NOT invalidate it", async () => {
  const qc = seededClient();
  await settlePaletteInvoke(qc, "EnterRoom", { room: ROOM_B });

  // The verb is visible authoritatively — same fold the hook adapter applies.
  assert.deepEqual(
    qc.getQueryData<RoomRegistry>(ROOMS_KEY),
    { known: [ROOM_A, ROOM_B], current: ROOM_B },
    "registry patched to the entered room",
  );
  // The never-invalidate invariant: a refetch could serve a stale read-back
  // and revert the switch, so the registry key must stay un-invalidated…
  assert.equal(
    qc.getQueryState(ROOMS_KEY)?.isInvalidated,
    false,
    "the rooms registry is never invalidated",
  );
  // …while the blanket invalidation still reaches everything else.
  assert.equal(
    qc.getQueryState(["buildingsContainer", WEBID])?.isInvalidated,
    true,
    "other caches are blanket-invalidated as before",
  );
});

Deno.test("settlePaletteInvoke: a non-room verb patches nothing and spares only the registry", async () => {
  const qc = seededClient();
  await settlePaletteInvoke(qc, "CreateBuilding", { building: "b2" });

  assert.deepEqual(
    qc.getQueryData<RoomRegistry>(ROOMS_KEY),
    { known: [ROOM_A], current: ROOM_A },
    "registry untouched",
  );
  assert.equal(qc.getQueryState(ROOMS_KEY)?.isInvalidated, false);
  assert.equal(
    qc.getQueryState(["buildingsContainer", WEBID])?.isInvalidated,
    true,
  );
});

Deno.test("settlePaletteInvoke: no-op patch until the registry has loaded (race guard)", async () => {
  const qc = new QueryClient();
  await settlePaletteInvoke(qc, "EnterRoom", { room: ROOM_B });
  assert.equal(
    qc.getQueryData(ROOMS_KEY),
    undefined,
    "an unloaded registry is not conjured from a patch",
  );
});

Deno.test("ROOM_REGISTRY_FOLDS: the per-verb registry semantics", () => {
  const reg: RoomRegistry = { known: [ROOM_A, ROOM_B], current: ROOM_A };

  assert.deepEqual(
    ROOM_REGISTRY_FOLDS.CreateRoom({ room: "new/" })(reg),
    { known: [ROOM_A, ROOM_B, "new/"], current: "new/" },
    "create: bookmark + becomes current",
  );
  assert.deepEqual(
    ROOM_REGISTRY_FOLDS.ExitRoom({ room: ROOM_A })(reg),
    { known: [ROOM_A, ROOM_B], current: null },
    "exit the current room: pointer cleared, bookmark kept",
  );
  assert.deepEqual(
    ROOM_REGISTRY_FOLDS.ExitRoom({ room: ROOM_B })(reg),
    reg,
    "exit a non-current room: pointer survives",
  );
  assert.deepEqual(
    ROOM_REGISTRY_FOLDS.DeleteRoom({ room: ROOM_A })(reg),
    { known: [ROOM_B], current: null },
    "delete: bookmark dropped + pointer cleared",
  );
  assert.deepEqual(
    ROOM_REGISTRY_FOLDS.AddBookmark({ room: "new/" })(reg),
    { known: [ROOM_A, ROOM_B, "new/"], current: ROOM_A },
    "bookmark: added without entering",
  );
  assert.deepEqual(
    ROOM_REGISTRY_FOLDS.RemoveBookmark({ room: ROOM_B })(reg),
    { known: [ROOM_A], current: ROOM_A },
    "unbookmark a non-current room: pointer survives",
  );
  assert.deepEqual(
    ROOM_REGISTRY_FOLDS.SeedDemoRooms({ rooms: ["r1/", "r2/"] })(reg),
    { known: [ROOM_A, ROOM_B, "r1/", "r2/"], current: "r2/" },
    "bulk seed: all bookmarked, last becomes current",
  );
  assert.deepEqual(
    ROOM_REGISTRY_FOLDS.EnterRoom({ room: ROOM_B })(reg),
    { known: [ROOM_A, ROOM_B], current: ROOM_B },
    "enter an already-bookmarked room: no duplicate bookmark",
  );
});
