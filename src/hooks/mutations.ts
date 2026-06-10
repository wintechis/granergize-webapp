import { useMutation, useQueryClient } from "@tanstack/react-query";
import { getSession } from "./session.ts";
import { queryKeys } from "./queries.ts";
import { deleteBuildingResource } from "../services/buildingActions.ts";
import {
  revokeAccess,
  revokeAllViewRecipients,
  revokeViewAccess,
  toggleBuildingVisibility,
} from "../services/interop/sharingManager.ts";
import { drainInbox } from "../services/interop/inbox.ts";
import {
  deleteView,
  getSnapshotUrl,
} from "../services/aggregation/viewManager.ts";
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
import {
  addContact,
  type Contact,
  removeContact,
} from "../services/contacts.ts";
import type { BuildingType, UserRole } from "../types.ts";

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
    qc.invalidateQueries({ queryKey: queryKeys.buildings });
    qc.invalidateQueries({ queryKey: queryKeys.energy });
    // The per-building detail reads. The annualEnergy key's link fingerprint
    // covers a year add/delete by itself, but editing an EXISTING year's
    // figures changes no links — only this invalidation refetches that case.
    // The series listings/readings likewise pick up freshly imported day files.
    qc.invalidateQueries({ queryKey: queryKeys.annualEnergy });
    qc.invalidateQueries({ queryKey: queryKeys.seriesDays });
    qc.invalidateQueries({ queryKey: queryKeys.dayReadings });
    qc.invalidateQueries({ queryKey: queryKeys.monthReadings });
  };
}

/**
 * Permanently delete an owned building. The caller confirms first (see
 * `buildBuildingDeletionPreview` + the component's `confirm`); this only performs
 * the delete and refreshes the affected queries.
 */
export function useDeleteBuilding() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (building: BuildingType) =>
      deleteBuildingResource(getSession(), building),
    // Drop the building from the list cache authoritatively on success, so the
    // Manage/Explore lists converge the instant the delete is confirmed instead of
    // waiting on the onSettled invalidation to schedule a refetch. A burst of rapid
    // deletes (the excel round-trip clears every building back-to-back) was leaving
    // the list showing a phantom row: the coalesced invalidation didn't refetch
    // within the poll window, so the just-emptied container was never re-read.
    // `deleteBuildingResource` does a read-after-write (server-confirmed gone) before
    // this runs, so removing it from the cache here is authoritative, not optimistic.
    // Keyed by WebID to match `useBuildings` (`[...buildings, webId]`); matched on the
    // stable `uri` (the building file IRI). onSettled still invalidates as a backstop
    // and refreshes the dependent energy / shared-buildings queries.
    onSuccess: (_data, building) => {
      const webId = getSession().info.webId;
      // Prefix-match (setQueriesData): the buildings key carries the shared-
      // source fingerprint as a third element, so the exact key isn't knowable
      // here — patch every cached buildings query for this WebID.
      qc.setQueriesData<{ buildings: BuildingType[] }>(
        { queryKey: [...queryKeys.buildings, webId] },
        (old) =>
          old
            ? { ...old, buildings: old.buildings.filter((b) => b.uri !== building.uri) }
            : old,
      );
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: queryKeys.buildings });
      qc.invalidateQueries({ queryKey: queryKeys.energy });
      qc.invalidateQueries({ queryKey: queryKeys.sharedOutLog });
    },
  });
}

/**
 * Manually drain the Pod inbox now (dev-mode "Check for new shares"). Inbox
 * processing otherwise runs only at login/session-restore (main.tsx), so a share
 * that arrives while the app stays open isn't visible until reload. Mirrors the
 * post-login refresh: archive grants/revocations into shared-in/, then invalidate
 * the folds so the new state appears.
 */
export function useCheckInbox() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => drainInbox(getSession()),
    onSettled: () => {
      // One log query feeds every "shared with me" reader (the lists derive
      // in memory), so the drain refolds shared-in/ once. receivedBenchmarks
      // stays separately invalidated: a snapshot's CONTENTS can change while
      // the grant set (its key fingerprint) stays the same.
      qc.invalidateQueries({ queryKey: queryKeys.sharedInLog });
      qc.invalidateQueries({ queryKey: queryKeys.receivedBenchmarks });
      qc.invalidateQueries({ queryKey: queryKeys.buildings });
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
      // The toggle writes prefs.ttl; every reader follows from that one
      // invalidation. The Share-tab "shared with you" list derives from the
      // prefs query in memory, and the buildings query keys on the hidden set
      // (its load filters hidden buildings out), so the prefs refetch re-keys
      // buildings — no separate buildings invalidation, which would double-load.
      qc.invalidateQueries({ queryKey: queryKeys.prefs });
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
      qc.invalidateQueries({ queryKey: queryKeys.sharedOutLog });
    },
  });
}

export function useDeleteView() {
  const qc = useQueryClient();
  return useMutation({
    // Revoke every recipient first (notifying them, so the view drops off their
    // "Views shared with you"), THEN delete the definition/snapshot — deleting the
    // snapshot alone would leave a stale row on each recipient's list.
    mutationFn: async (viewId: string) => {
      const session = getSession();
      const webId = session.info.webId;
      if (webId) {
        await revokeAllViewRecipients(getSnapshotUrl(webId, viewId), session);
      }
      await deleteView(session, viewId);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: queryKeys.viewDefinitions });
      qc.invalidateQueries({ queryKey: queryKeys.sharedOutLog });
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
      qc.invalidateQueries({ queryKey: queryKeys.sharedOutLog });
    },
  });
}

// ── Contacts (address book) ──────────────────────────────────────────────────

/** Save (or update) a contact in the address book. */
export function useSaveContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (contact: Contact) => addContact(getSession(), contact),
    onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.contacts }),
  });
}

/** Remove a contact from the address book. */
export function useRemoveContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (webId: string) => removeContact(getSession(), webId),
    onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.contacts }),
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
