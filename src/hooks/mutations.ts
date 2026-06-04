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
  openRoom,
  removeKnownRoom,
  roomExists,
  setMyRole,
} from "../services/interop/dataRoom.ts";
import type { BuildingType, UserRole } from "../../types/types.ts";

/**
 * Write hooks. Each wraps the existing service function as the `mutationFn` — so
 * `readModifyWrite`'s ETag/If-Match optimistic *locking* is preserved — and
 * invalidates the affected queries on settle. Error handling
 * (ConflictError/SessionExpired notifications) is centralised in `QueryProvider`.
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
// Each wraps a dataRoom service fn and invalidates the single `roomState` query
// on settle (one batched re-read), replacing the old loadRoom()-after-every-
// action. Components pass `onSuccess` for success toasts; errors are centralised.

export function useCreateRoom() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => createRoom(getSession()).then(() => {}),
    onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.roomState }),
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
    },
    onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.roomState }),
  });
}

export function useExitRoom() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (roomUrl: string) => exitRoom(roomUrl, getSession()),
    onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.roomState }),
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
    },
    onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.roomState }),
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
    },
    onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.roomState }),
  });
}

/** Remove a room from your bookmark list (does not delete the room itself). */
export function useRemoveBookmark() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (roomUrl: string) => removeKnownRoom(roomUrl, getSession()),
    onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.roomState }),
  });
}

export function useSaveRoles() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ room, roles }: { room: string; roles: UserRole[] }) =>
      setMyRole(room, roles, getSession()),
    onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.roomState }),
  });
}
