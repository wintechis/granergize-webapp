import {
  type QueryClient,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { getSession } from "./session.ts";
import { queryKeys } from "./queries.ts";
import type { ShareBuildingParams } from "../intents/shareBuilding.ts";
import { invoke, query } from "../intents/registry.ts";
import type { EnergyDataset } from "../services/rdf/energyDataset.ts";
import type { LastgangReading } from "../services/rdf/energySeriesXlsx.ts";
import type { Organization } from "../services/organization/organizationManager.ts";
import type { Contact } from "../services/contacts.ts";
import type {
  AggregationDefinition,
  AttachmentRef,
  BuildingType,
  UserRole,
} from "../types.ts";

/**
 * Write hooks. Each wraps the existing service function as the `mutationFn` — so
 * `readModifyWrite`'s ETag/If-Match optimistic *locking* is preserved — and then
 * either invalidates the affected queries or, for the room registry, updates the
 * cache authoritatively via `setQueryData` (see the data-room section). Error
 * handling (ConflictError/SessionExpired notifications) is centralised in
 * `QueryProvider`; each hook's `meta.action` gives the central toast its
 * "Failed to {action}: {detail}" phrasing, and `meta.silent` hands the error to
 * the dialog's inline <Alert> instead (see queryErrors.ts).
 */

/**
 * The query keys a building write touches: the lists/energy folds plus the
 * per-building detail reads. The annualEnergy key's link fingerprint covers a
 * year add/delete by itself, but editing an EXISTING year's figures changes no
 * links — only this invalidation refetches that case. The series
 * listings/readings likewise pick up freshly imported day files.
 */
function invalidateBuildingData(qc: QueryClient): void {
  qc.invalidateQueries({ queryKey: queryKeys.buildings });
  qc.invalidateQueries({ queryKey: queryKeys.energy });
  qc.invalidateQueries({ queryKey: queryKeys.annualEnergy });
  qc.invalidateQueries({ queryKey: queryKeys.seriesDays });
  qc.invalidateQueries({ queryKey: queryKeys.dayReadings });
  qc.invalidateQueries({ queryKey: queryKeys.monthReadings });
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
      invoke("DeleteBuilding", { building }, getSession()),
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
    mutationFn: () => invoke("CheckInbox", {}, getSession()),
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
      invoke("ToggleVisibility", { buildingUri }, getSession()),
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
    mutationFn: (vars: { buildingUri: string; webId: string }) =>
      invoke("RevokeBuildingAccess", vars, getSession()),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: queryKeys.sharedOutLog });
    },
  });
}

export function useDeleteAggregation() {
  const qc = useQueryClient();
  return useMutation({
    // The core revokes every recipient first (notifying them, so the aggregation
    // drops off their "Aggregations shared with you"), THEN deletes the
    // definition/snapshot — that ordering is domain logic in the core.
    mutationFn: (aggregationId: string) =>
      invoke("DeleteAggregation", { aggregationId }, getSession()),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: queryKeys.aggregationDefinitions });
      qc.invalidateQueries({ queryKey: queryKeys.aggregationDetail });
      qc.invalidateQueries({ queryKey: queryKeys.sharedOutLog });
    },
  });
}

export function useRefreshAggregation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (aggregationId: string) =>
      invoke("RefreshAggregation", { aggregationId }, getSession()),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: queryKeys.aggregationDefinitions });
      // The standalone /aggregation page reads through aggregationDetail (definition +
      // snapshot), so the recompute must refetch it.
      qc.invalidateQueries({ queryKey: queryKeys.aggregationDetail });
    },
  });
}

export function useRevokeAggregationAccess() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { snapshotUri: string; webId: string }) =>
      invoke("RevokeAggregationAccess", vars, getSession()),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: queryKeys.sharedOutLog });
    },
  });
}

// ── Building writes (the dialogs' Pod writes) ────────────────────────────────

/**
 * The add flow: per building, energy datasets first and the discoverable
 * building file LAST (the commit point — a failure leaves only inert orphans),
 * exactly the ordering the serializer documents. The abort signal and progress
 * callback travel in the variables; a user cancel is an OUTCOME, not an error —
 * the mutation resolves with `aborted: true` and the buildings already written
 * (the dialog reports "kept"), while a real failure throws to the central toast.
 */
export function useUploadBuildings() {
  const qc = useQueryClient();
  return useMutation({
    meta: { action: "actionAddBuilding" },
    mutationFn: (vars: {
      buildings: Array<Record<string, string>>;
      lastgangReadings: LastgangReading[] | null;
      signal: AbortSignal;
      onProgress: (done: number, total: number) => void;
    }) =>
      invoke("AddBuilding", {
        buildings: vars.buildings,
        lastgangReadings: vars.lastgangReadings,
        signal: vars.signal,
        onProgress: vars.onProgress,
      }, getSession()),
    // The core auto-remembers each building's WebID agents (Pod writes); prime
    // the inactive contacts query here so Connect picks them up without a reload
    // (the cache concern that stays in the adapter).
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: queryKeys.contacts, refetchType: "all" }),
    onSettled: () => invalidateBuildingData(qc),
  });
}

/** Save edited master data on an existing building (conditional RMW PUT). */
export function useUpdateBuilding() {
  const qc = useQueryClient();
  return useMutation({
    meta: { action: "actionUpdateBuilding" },
    mutationFn: (vars: {
      fileUri: string;
      subjectUri: string;
      fields: Record<string, string>;
    }) =>
      invoke("UpdateBuilding", {
        fileUri: vars.fileUri,
        subjectUri: vars.subjectUri,
        fields: vars.fields,
      }, getSession()),
    // The core auto-remembers WebID agents (Pod writes); prime the inactive
    // contacts query here so Connect picks them up without a reload.
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: queryKeys.contacts, refetchType: "all" }),
    onSettled: () => invalidateBuildingData(qc),
  });
}

/** Write (create or replace) one annual (year, scenario) energy dataset. */
export function useWriteEnergyYear() {
  const qc = useQueryClient();
  return useMutation({
    meta: { action: "actionSaveEnergy" },
    // The core writes the year then best-effort reconciles the building's
    // sharing grants (domain logic — a failed reconcile must not fail the save).
    mutationFn: (vars: {
      fileUri: string;
      subjectUri: string;
      dataset: EnergyDataset;
    }) => invoke("SaveObservation", vars, getSession()),
    onSettled: () => invalidateBuildingData(qc),
  });
}

/** Delete one annual (year, scenario) energy dataset + its building link. */
export function useDeleteEnergyYear() {
  const qc = useQueryClient();
  return useMutation({
    meta: { action: "actionDeleteEnergy" },
    mutationFn: (vars: {
      fileUri: string;
      subjectUri: string;
      dataset: Pick<EnergyDataset, "year" | "granularity" | "scenario">;
    }) => invoke("DeleteObservation", vars, getSession()),
    onSettled: () => invalidateBuildingData(qc),
  });
}

// ── Attachments (building files) ─────────────────────────────────────────────
// Attachments link from the building file (`gran:hasAttachment`), so the
// buildings query is the one reader to refresh.

/**
 * Upload files to a building's `files/` container, sequentially; `onUploaded`
 * reports each landed file so the dialog's list can grow as the batch runs.
 * Stops at the first failure (the files before it are kept and reported).
 */
export function useUploadAttachments() {
  const qc = useQueryClient();
  return useMutation({
    meta: { action: "actionUploadFile" },
    mutationFn: (vars: {
      fileUri: string;
      subjectUri: string;
      files: File[];
      onUploaded?: (ref: AttachmentRef) => void;
    }) => invoke("UploadAttachments", vars, getSession()),
    onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.buildings }),
  });
}

export function useDeleteAttachment() {
  const qc = useQueryClient();
  return useMutation({
    meta: { action: "actionDeleteFile" },
    mutationFn: (vars: { fileUri: string; subjectUri: string; url: string }) =>
      invoke("DeleteAttachment", vars, getSession()),
    onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.buildings }),
  });
}

/** Flag one attachment as the energy certificate (`url: null` clears it). */
export function useSetEnergyCertificate() {
  const qc = useQueryClient();
  return useMutation({
    meta: { action: "actionUpdateCertificate" },
    mutationFn: (vars: {
      fileUri: string;
      subjectUri: string;
      url: string | null;
    }) => invoke("SetEnergyCertificate", vars, getSession()),
    onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.buildings }),
  });
}

// ── Sharing & aggregations (dialog side) ────────────────────────────────────────────

/**
 * Share a building with a list of recipients (sequential; stops at the first
 * failure — recipients already granted stay granted). Silent: the share
 * dialog's confirm step renders the error inline (the <Alert> carve-out).
 */
export function useShareBuilding() {
  const qc = useQueryClient();
  return useMutation({
    meta: { action: "actionShareBuilding", silent: true },
    // Thin adapter over the React-free core (src/intents/shareBuilding.ts),
    // routed through the registry's invoke() entry point (one path for UI +
    // headless): the core owns the Pod-request composition; the hook keeps only
    // busy state, the central toast, and the sharedOutLog invalidation.
    mutationFn: (vars: ShareBuildingParams) => invoke("ShareBuilding", vars, getSession()),
    onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.sharedOutLog }),
  });
}

/**
 * Share an aggregation snapshot with a list of recipients. The share-aggregation dialog
 * renders errors inline (`silent: true`); the standalone aggregation page toasts
 * (no option).
 */
export function useShareAggregationSnapshot(opts: { silent?: boolean } = {}) {
  const qc = useQueryClient();
  return useMutation({
    // `opts.silent` stays an adapter concern (the dialog renders the error inline
    // via meta.silent); the core knows nothing about it.
    meta: { action: "actionShareAggregation", silent: opts.silent },
    mutationFn: (vars: { snapshotUri: string; recipients: string[] }) =>
      invoke("ShareAggregation", vars, getSession()),
    onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.sharedOutLog }),
  });
}

/** Create an aggregation definition and compute its first snapshot (one user intent). */
export function useCreateAggregation() {
  const qc = useQueryClient();
  return useMutation({
    meta: { action: "actionCreateAggregation" },
    mutationFn: (vars: {
      name: string;
      buildingUris: string[];
      aggregationType: AggregationDefinition["aggregationType"];
      metrics: string[];
      period?: string;
      benchmark?: boolean;
    }) => invoke("CreateAggregation", vars, getSession()),
    onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.aggregationDefinitions }),
  });
}

// ── Organisation ─────────────────────────────────────────────────────────────

/**
 * Save the organisation node in the WebID profile (+ optional logo upload).
 * The resolved-agent caches read the profile, so both are refreshed.
 */
export function useSaveOrganization() {
  const qc = useQueryClient();
  return useMutation({
    meta: { action: "actionSaveOrganisation" },
    mutationFn: (vars: {
      org: Pick<Organization, "name" | "homepage" | "sameAs">;
      logo?: File | null;
    }) => invoke("SaveOrganisation", vars, getSession()),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: queryKeys.agent });
      qc.invalidateQueries({ queryKey: queryKeys.agentOrg });
    },
  });
}

// ── Contacts (address book) ──────────────────────────────────────────────────

/** Save (or update) a contact in the address book. */
export function useSaveContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (contact: Contact) => invoke("SaveContact", { contact }, getSession()),
    onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.contacts }),
  });
}

/** Remove a contact from the address book. */
export function useRemoveContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (webId: string) => invoke("RemoveContact", { webId }, getSession()),
    onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.contacts }),
  });
}

/** Dev-mode: seed the demo contacts (see the SeedDemoContacts core). */
export function useSeedDemoContacts() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => invoke("SeedDemoContacts", {}, getSession()),
    meta: { action: "actionAddDemoContacts" },
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

// Each adapter routes its Pod write through the React-free core via invoke()
// (one path for UI + headless): the core does the Pod write + reachability/
// existence check and returns the normalized room URI (`{ room }`), which the
// adapter's `patchRooms` race-guard folds into the cache. The return shape MUST
// match what each `onSuccess` patch consumes (the silent break-mode — the query
// cache is browser-only, so Tier-1 can't catch a mismatch).
export function useCreateRoom() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => invoke("CreateRoom", {}, getSession()),
    onSuccess: ({ room }) =>
      patchRooms(qc, (reg) => ({ known: withRoom(reg.known, room), current: room })),
  });
}

/** Dev-mode: seed the demo data rooms (see the SeedDemoRooms core). */
export function useSeedDemoRooms() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => invoke("SeedDemoRooms", {}, getSession()),
    meta: { action: "actionAddDemoRooms" },
    onSuccess: ({ rooms }) =>
      patchRooms(qc, (reg) => ({
        known: rooms.reduce(withRoom, reg.known),
        current: rooms[rooms.length - 1] ?? reg.current,
      })),
  });
}

/** Enter (join) a room by URI/invite link — leaves whatever room you were in. */
export function useEnterRoom() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (roomUri: string) => invoke("EnterRoom", { roomUri }, getSession()),
    onSuccess: ({ room }) =>
      patchRooms(qc, (reg) => ({ known: withRoom(reg.known, room), current: room })),
  });
}

export function useExitRoom() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (roomUri: string) => invoke("ExitRoom", { roomUri }, getSession()),
    onSuccess: ({ room }) =>
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
    mutationFn: (roomUri: string) => invoke("DeleteRoom", { roomUri }, getSession()),
    onSuccess: ({ room }) =>
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
    mutationFn: (input: string) => invoke("AddRoom", { input }, getSession()),
    onSuccess: ({ room }) =>
      patchRooms(qc, (reg) => ({ ...reg, known: withRoom(reg.known, room) })),
  });
}

/** Remove a room from your bookmark list (does not delete the room itself). */
export function useRemoveBookmark() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (roomUri: string) => invoke("RemoveBookmark", { roomUri }, getSession()),
    onSuccess: ({ room }) =>
      patchRooms(qc, (reg) => ({
        known: reg.known.filter((r) => r !== room),
        current: reg.current === room ? null : reg.current,
      })),
  });
}

export function useSaveRoles() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { room: string; roles: UserRole[] }) =>
      invoke("SaveRoles", vars, getSession()),
    // Roles live in the room's log, not the registry — refresh just that.
    onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.roomLog }),
  });
}

// ── Account-scope operations ─────────────────────────────────────────────────
// The dashboard's account actions: bulk seeding, the whole-collection wipe, the
// archive pair, and the sharing projection's audit/repair. The caller keeps the
// UI surfaces these need beyond the standard busy/toast handling — the
// computed-preview confirms, the full-page activity screen, and outcome
// rendering (tally toasts) — while the hook owns execution, busy state, the
// central error toast, and the invalidations.

/**
 * Dev-mode/banner: seed the fixed demo building set
 * (see the SeedDemoBuildings core). Per-building best-effort — the result is a
 * tally `{seeded, total}`, never a throw for an individual building; the
 * caller renders partial success ("Added N of M").
 */
export function useSeedDemoBuildings() {
  const qc = useQueryClient();
  return useMutation({
    meta: { action: "actionAddDemoBuildings" },
    mutationFn: () => invoke("SeedDemoBuildings", {}, getSession()),
    // Energy follows automatically: useEnergy is keyed on the building set.
    onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.buildings }),
  });
}

/**
 * Remove the entire app collection from the Pod (see the RemoveAppData core).
 * Long-running and cancellable: the abort signal travels in the variables and
 * a cancel resolves as an OUTCOME (`{aborted: true}`), never an error — the
 * `useUploadBuildings` pattern. The caller owns the confirmation (with its
 * resource-list preview) and the progress surface (`ActivityScreen` on
 * `isPending`); it must drive post-success flow from the `mutateAsync`
 * continuation, because the settle clears the whole cache (below).
 */
export function useRemoveAppData() {
  const qc = useQueryClient();
  return useMutation({
    meta: { action: "actionRemoveAppData" },
    mutationFn: (vars: { signal: AbortSignal }) =>
      invoke("RemoveAppData", vars, getSession()),
    // The "entire-cache" invalidation: success leaves an empty Pod, an abort
    // or failure an unknown partially-deleted subset — in every case nothing
    // cached can be trusted, so reset rather than enumerate key families.
    onSettled: () => qc.clear(),
  });
}

/**
 * Dev-mode: restore an archive into the Pod (see the RestoreArchive core), then
 * rebuild the WAC ACLs by replaying the shared-out log — the reconciliation
 * follow-up is part of the restore intent, because the archive carries the
 * log (ground truth) but not the derived `.acl` files. The caller owns the
 * confirmation (with its `inspectArchive` preview) and the tally toast.
 */
export function useRestoreArchive() {
  const qc = useQueryClient();
  return useMutation({
    meta: { action: "actionRestoreArchive" },
    mutationFn: (vars: { bytes: Uint8Array }) =>
      invoke("RestoreArchive", vars, getSession()),
    // The restore may have replaced anything under the app collection.
    onSettled: () => qc.invalidateQueries(),
  });
}

/**
 * Dev-mode: rebuild the WAC `.acl` projection from the shared-out event log
 * (see the ReissueGrants core) — a materialized-projection reconciliation behind a user-intent
 * button. No invalidations: it writes only the ACL projection, which no
 * query reads.
 */
export function useReissueGrants() {
  return useMutation({
    meta: { action: "actionRebuildSharing" },
    mutationFn: () => invoke("ReissueGrants", {}, getSession()),
  });
}

/**
 * Dev-mode: export the whole app collection as a ZIP.
 * @operation query — an imperative READ-intent: `useMutation` here is the
 * on-demand trigger primitive (busy state + the central error toast), not a
 * write; nothing on the Pod changes. The caller saves the blob and toasts
 * the count.
 */
export function useExportArchive() {
  return useMutation({
    meta: { action: "actionDownloadArchive" },
    // Routed through the registry's read entry point (query()); the core
    // (src/intents/exportArchive.ts) packs the archive and returns the blob.
    mutationFn: () => query("ExportArchive", {}, getSession()),
  });
}

/**
 * Dev-mode: dry-run diff of the `.acl` projection against the shared-out log
 * (see {@link checkSharingConsistencyCore}).
 * @operation query — an imperative READ-intent like {@link useExportArchive}.
 * Deliberately not a `useQuery`: every click must re-read the Pod — a cached
 * audit would report stale consistency. The caller renders the verdict.
 */
export function useAuditGrants() {
  return useMutation({
    meta: { action: "actionCheckSharing" },
    // Thin adapter over the React-free read core
    // (src/intents/checkSharingConsistency.ts), routed through the registry's
    // query() entry point: the core returns the drift report value; the hook
    // keeps only busy state + the central toast (a read declares no invalidation).
    mutationFn: () => query("AuditGrants", {}, getSession()),
  });
}
