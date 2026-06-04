import { useMutation, useQueryClient } from "@tanstack/react-query";
import { getSession } from "./session.ts";
import { queryKeys } from "./queries.ts";
import { confirmAndDeleteBuilding } from "../services/utils/buildingActions.ts";
import {
  revokeAccess,
  revokeViewAccess,
  toggleBuildingVisibility,
} from "../services/interop/sharingManager.ts";
import { deleteView } from "../services/aggregation/viewManager.ts";
import { refreshSnapshot } from "../services/aggregation/viewComputer.ts";
import {
  addKnownRoom,
  createRoom,
  deleteRoom,
  exitRoom,
  extractRoomUrl,
  normalizeRoomUrl,
  openRoom,
  removeKnownRoom,
  roomExists,
  setMyRole,
} from "../services/interop/dataRoom.ts";
import type { BuildingType, UserRole } from "../../types/types.ts";

/**
 * Write hooks. Each wraps the existing service function as the `mutationFn` — so
 * `readModifyWrite`'s ETag/If-Match optimistic *locking* is preserved — and then
 * either invalidates the affected queries or, for the room registry, updates the
 * cache authoritatively via `setQueryData` (see the data-room section). Error
 * handling (ConflictError/SessionExpired notifications) is centralised in
 * `QueryProvider`.
 */

/**
 * Refresh the building + energy queries after a building add/edit/upload that the
 * dialog performed itself (those dialogs own the write; this just invalidates).
 */
export function useInvalidateBuildingData() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: queryKeys.buildingsAndAgents });
    qc.invalidateQueries({ queryKey: queryKeys.energy });
  };
}

/** Permanently delete an owned building (resolves to false if the user cancels). */
export function useDeleteBuilding() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (building: BuildingType) =>
      confirmAndDeleteBuilding(getSession(), building),
    onSettled: (deleted) => {
      if (deleted === false) return; // cancelled — nothing changed
      qc.invalidateQueries({ queryKey: queryKeys.buildingsAndAgents });
      qc.invalidateQueries({ queryKey: queryKeys.energy });
      qc.invalidateQueries({ queryKey: queryKeys.sharedBuildings });
    },
  });
}

/** Toggle whether a shared-in building shows in the dashboard. */
export function useToggleVisibility() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (buildingUri: string) =>
      toggleBuildingVisibility(buildingUri, getSession()),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: queryKeys.sharedWithMe });
    },
  });
}

/** Revoke a recipient's access to one of your buildings. */
export function useRevokeBuildingAccess() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ buildingUri, webId }: { buildingUri: string; webId: string }) =>
      revokeAccess(buildingUri, webId, getSession()),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: queryKeys.sharedBuildings });
    },
  });
}

export function useDeleteView() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (viewId: string) => deleteView(getSession(), viewId),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: queryKeys.viewDefinitions });
      qc.invalidateQueries({ queryKey: queryKeys.sharedViews });
    },
  });
}

export function useRefreshView() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (viewId: string) => refreshSnapshot(getSession(), viewId),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: queryKeys.viewDefinitions });
    },
  });
}

export function useRevokeViewAccess() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ snapshotUrl, webId }: { snapshotUrl: string; webId: string }) =>
      revokeViewAccess(snapshotUrl, webId, getSession()),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: queryKeys.sharedViews });
    },
  });
}

// ── Data room mutations ──────────────────────────────────────────────────────
// The registry (current + known) is OWNED here: each mutation patches the
// ["rooms", webId] cache authoritatively via setQueryData and never invalidates
// it, so a slow or stale read-back can't revert the change (diagnosed on
// solidcommunity.net — see queries.ts useRooms + project memory). The members/
// roles log (["roomLog", …, current]) refetches on its own because its key
// includes the current room; role saves invalidate it explicitly. Each mutationFn
// returns the canonical room URL it acted on, which onSuccess folds into the cache.

type RoomRegistry = { known: string[]; current: string | null };

/** Patch the logged-in user's room-registry cache. */
function patchRooms(
  qc: ReturnType<typeof useQueryClient>,
  fn: (reg: RoomRegistry) => RoomRegistry,
): void {
  const webId = getSession().info.webId;
  qc.setQueryData<RoomRegistry>(
    [...queryKeys.rooms, webId],
    (old) => old ? fn(old) : old,
  );
}

const withRoom = (known: string[], room: string) =>
  known.includes(room) ? known : [...known, room];

export function useCreateRoom() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => createRoom(getSession()),
    onSuccess: (room) =>
      patchRooms(qc, (reg) => ({ known: withRoom(reg.known, room), current: room })),
  });
}

/** Enter (join) a room by URI/invite link — leaves whatever room you were in. */
export function useEnterRoom() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (roomUrl: string) => {
      if (!(await openRoom(roomUrl, getSession()))) {
        throw new Error("Data room is not reachable");
      }
      return normalizeRoomUrl(extractRoomUrl(roomUrl));
    },
    onSuccess: (room) =>
      patchRooms(qc, (reg) => ({ known: withRoom(reg.known, room), current: room })),
  });
}

export function useExitRoom() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (roomUrl: string) => {
      await exitRoom(roomUrl, getSession());
      return normalizeRoomUrl(roomUrl);
    },
    onSuccess: (room) =>
      patchRooms(qc, (reg) => ({
        ...reg,
        current: reg.current === room ? null : reg.current,
      })),
  });
}

/** Delete a room you own (for everyone), then drop the bookmark. */
export function useDeleteRoom() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (roomUrl: string) => {
      const session = getSession();
      await deleteRoom(roomUrl, session);
      await removeKnownRoom(roomUrl, session);
      return normalizeRoomUrl(roomUrl);
    },
    onSuccess: (room) =>
      patchRooms(qc, (reg) => ({
        known: reg.known.filter((r) => r !== room),
        current: reg.current === room ? null : reg.current,
      })),
  });
}

/** Add a room URI (raw or invite link) to your bookmarks — does not enter it. */
export function useAddRoom() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: string) => {
      const session = getSession();
      const room = extractRoomUrl(input);
      if (!(await roomExists(room, session))) {
        throw new Error("Data room is not reachable");
      }
      await addKnownRoom(room, session);
      return normalizeRoomUrl(room);
    },
    onSuccess: (room) =>
      patchRooms(qc, (reg) => ({ ...reg, known: withRoom(reg.known, room) })),
  });
}

/** Remove a room from your bookmark list (does not delete the room itself). */
export function useRemoveBookmark() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (roomUrl: string) => {
      await removeKnownRoom(roomUrl, getSession());
      return normalizeRoomUrl(roomUrl);
    },
    onSuccess: (room) =>
      patchRooms(qc, (reg) => ({
        known: reg.known.filter((r) => r !== room),
        current: reg.current === room ? null : reg.current,
      })),
  });
}

export function useSaveRoles() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ room, roles }: { room: string; roles: UserRole[] }) =>
      setMyRole(room, roles, getSession()),
    // Roles live in the room's log, not the registry — refresh just that.
    onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.roomLog }),
  });
}
