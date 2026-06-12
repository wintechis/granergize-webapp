import {
  type QueryClient,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { getSession } from "./session.ts";
import { queryKeys } from "./queries.ts";
import { rememberBuildingAgents } from "./rememberAgents.ts";
import { deleteBuildingResource } from "../services/buildingActions.ts";
import {
  revokeAccess,
  revokeAllViewRecipients,
  revokeViewAccess,
  toggleBuildingVisibility,
} from "../services/interop/sharingManager.ts";
import {
  auditGrants,
  reconcileBuildingGrants,
  reissueGrants,
  shareAggregatedView,
  shareBuildingData,
} from "../services/interop/share.ts";
import { logError } from "../lib/logError.ts";
import { drainInbox } from "../services/interop/inbox.ts";
import {
  createViewDefinition,
  deleteView,
  getSnapshotUrl,
} from "../services/aggregation/viewManager.ts";
import {
  computeAndStoreSnapshot,
  refreshSnapshot,
} from "../services/aggregation/viewComputer.ts";
import {
  deleteEnergyYear,
  newBuildingUri,
  seedDemoBuildings,
  serializeBuildingToTurtle,
  updateBuilding,
  uploadBuilding,
  writeBuildingEnergy,
  writeEnergyYear,
} from "../services/rdf/building/buildingSerializer.ts";
import { removeAppData } from "../services/pod/podDelete.ts";
import { exportArchive, importArchive } from "../services/pod/podArchive.ts";
import { mintBuildingSubject } from "../services/rdf/building/buildingId.ts";
import type { EnergyDataset } from "../services/rdf/energyDataset.ts";
import type { LastgangReading } from "../services/rdf/energySeriesXlsx.ts";
import {
  deleteAttachment,
  setEnergyCertificate,
  uploadAttachment,
} from "../services/attachmentManager.ts";
import {
  type Organization,
  saveOrganization,
  uploadOrgLogo,
} from "../services/organization/organizationManager.ts";
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
  rememberAgent,
  removeContact,
} from "../services/contacts.ts";
import { seedDemoContacts, seedDemoRooms } from "../services/demoConnect.ts";
import type {
  AggregatedViewDefinition,
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

/** Refresh the building + energy queries after a building-data change. */
export function useInvalidateBuildingData() {
  const qc = useQueryClient();
  return () => invalidateBuildingData(qc);
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
      qc.invalidateQueries({ queryKey: queryKeys.viewDetail });
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
      // The standalone /view page reads through viewDetail (definition +
      // snapshot), so the recompute must refetch it.
      qc.invalidateQueries({ queryKey: queryKeys.viewDetail });
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
    meta: { action: "add the building" },
    mutationFn: async (vars: {
      buildings: Array<Record<string, string>>;
      lastgangReadings: LastgangReading[] | null;
      signal: AbortSignal;
      onProgress: (done: number, total: number) => void;
    }) => {
      const session = getSession();
      const webId = session.info.webId;
      if (!webId) throw new Error("Not authenticated");
      // Provenance records only WHO produced the building (the logged-in agent)
      // as a PROV qualified attribution.
      const provenance = { agent: webId };
      const added: string[] = [];
      try {
        for (const b of vars.buildings) {
          vars.signal.throwIfAborted();
          // A collision-free FILE name: `Date.now()`+short-random clashed when
          // several buildings were written within the same millisecond in a bulk
          // import, so the second PUT overwrote the first (buildings silently
          // vanished). Identity is the subject IRI, not the uuid.
          const uri = newBuildingUri(webId, crypto.randomUUID());
          const subjectUri = mintBuildingSubject(uri);

          // Group the Lastgang (15-min) readings by day into a single series
          // dataset; annual aggregates come from the field map (`_inv_*`/`_bsp_*`).
          let series:
            | {
              year: number;
              days: Array<{ date: string; readings: LastgangReading[] }>;
              label: string;
            }
            | undefined;
          if (vars.lastgangReadings && vars.lastgangReadings.length > 0) {
            const byDate = new Map<string, LastgangReading[]>();
            for (const r of vars.lastgangReadings) {
              const list = byDate.get(r.date) ?? [];
              list.push(r);
              byDate.set(r.date, list);
            }
            const days = [...byDate.entries()].map(([date, readings]) => ({
              date,
              readings,
            }));
            // All readings are one calendar year; take it from the first date.
            const year = parseInt(days[0].date.slice(0, 4));
            series = { year, days, label: b.label ?? "" };
          }

          const energyLinks = await writeBuildingEnergy(
            session,
            uri,
            subjectUri,
            b,
            series,
            vars.onProgress,
            vars.signal,
          );
          const ttl = serializeBuildingToTurtle(b, uri, energyLinks, provenance);
          await uploadBuilding(session, uri, ttl, webId, vars.signal);
          added.push(subjectUri);
          // Auto-remember the building's WebID agents in the address book.
          rememberBuildingAgents(session, qc, b);
        }
      } catch (err) {
        if (vars.signal.aborted) return { added, aborted: true };
        throw err;
      }
      return { added, aborted: false };
    },
    onSettled: () => invalidateBuildingData(qc),
  });
}

/** Save edited master data on an existing building (conditional RMW PUT). */
export function useUpdateBuilding() {
  const qc = useQueryClient();
  return useMutation({
    meta: { action: "update the building" },
    mutationFn: async (vars: {
      fileUri: string;
      subjectUri: string;
      fields: Record<string, string>;
    }) => {
      const session = getSession();
      await updateBuilding(session, vars.fileUri, vars.subjectUri, vars.fields);
      rememberBuildingAgents(session, qc, vars.fields);
    },
    onSettled: () => invalidateBuildingData(qc),
  });
}

/** Write (create or replace) one annual (year, scenario) energy dataset. */
export function useWriteEnergyYear() {
  const qc = useQueryClient();
  return useMutation({
    meta: { action: "save energy data" },
    mutationFn: async (vars: {
      fileUri: string;
      subjectUri: string;
      dataset: EnergyDataset;
    }) => {
      const session = getSession();
      await writeEnergyYear(session, vars.fileUri, vars.subjectUri, vars.dataset);
      // Reconciliation: an active all-years grant must extend to the dataset
      // that now exists (its ACL projection is enumerated per dataset, so a
      // grown scope needs a re-apply). Best-effort — the year is already
      // saved, so a failed reconcile must not fail the save; the resulting
      // drift is what auditGrants detects and reissueGrants repairs.
      await reconcileBuildingGrants(vars.fileUri, session).catch((err) =>
        logError("reconcile sharing grants after energy write", err)
      );
    },
    onSettled: () => invalidateBuildingData(qc),
  });
}

/** Delete one annual (year, scenario) energy dataset + its building link. */
export function useDeleteEnergyYear() {
  const qc = useQueryClient();
  return useMutation({
    meta: { action: "delete energy data" },
    mutationFn: (vars: {
      fileUri: string;
      subjectUri: string;
      dataset: Pick<EnergyDataset, "year" | "granularity" | "scenario">;
    }) => deleteEnergyYear(getSession(), vars.fileUri, vars.subjectUri, vars.dataset),
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
    meta: { action: "upload the file" },
    mutationFn: async (vars: {
      fileUri: string;
      subjectUri: string;
      files: File[];
      onUploaded?: (ref: AttachmentRef) => void;
    }) => {
      const session = getSession();
      for (const file of vars.files) {
        const ref = await uploadAttachment(
          vars.fileUri,
          vars.subjectUri,
          file,
          session,
        );
        vars.onUploaded?.(ref);
      }
    },
    onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.buildings }),
  });
}

export function useDeleteAttachment() {
  const qc = useQueryClient();
  return useMutation({
    meta: { action: "delete the file" },
    mutationFn: (vars: { fileUri: string; subjectUri: string; url: string }) =>
      deleteAttachment(vars.fileUri, vars.subjectUri, vars.url, getSession()),
    onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.buildings }),
  });
}

/** Flag one attachment as the energy certificate (`url: null` clears it). */
export function useSetEnergyCertificate() {
  const qc = useQueryClient();
  return useMutation({
    meta: { action: "update the energy certificate" },
    mutationFn: (vars: {
      fileUri: string;
      subjectUri: string;
      url: string | null;
    }) =>
      setEnergyCertificate(vars.fileUri, vars.subjectUri, vars.url, getSession()),
    onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.buildings }),
  });
}

// ── Sharing & views (dialog side) ────────────────────────────────────────────

/**
 * Share a building with a list of recipients (sequential; stops at the first
 * failure — recipients already granted stay granted). Silent: the share
 * dialog's confirm step renders the error inline (the <Alert> carve-out).
 */
export function useShareBuilding() {
  const qc = useQueryClient();
  return useMutation({
    meta: { action: "share the building", silent: true },
    mutationFn: async (vars: {
      buildingUri: string;
      recipients: string[];
      includeEnergyData: boolean;
      years?: number[];
    }) => {
      const session = getSession();
      for (const recipient of vars.recipients) {
        await shareBuildingData(vars.buildingUri, recipient, session, {
          includeEnergyData: vars.includeEnergyData,
          years: vars.years,
        });
        // Auto-remember the recipient in the address book (fire-and-forget).
        void rememberAgent(session, recipient);
      }
    },
    onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.sharedOutLog }),
  });
}

/**
 * Share a view snapshot with a list of recipients. The share-view dialog
 * renders errors inline (`silent: true`); the standalone view page toasts
 * (no option).
 */
export function useShareViewSnapshot(opts: { silent?: boolean } = {}) {
  const qc = useQueryClient();
  return useMutation({
    meta: { action: "share the view", silent: opts.silent },
    mutationFn: async (vars: { snapshotUrl: string; recipients: string[] }) => {
      const session = getSession();
      for (const recipient of vars.recipients) {
        await shareAggregatedView(vars.snapshotUrl, recipient, session);
      }
    },
    onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.sharedOutLog }),
  });
}

/** Create a view definition and compute its first snapshot (one user intent). */
export function useCreateView() {
  const qc = useQueryClient();
  return useMutation({
    meta: { action: "create the view" },
    mutationFn: async (vars: {
      name: string;
      buildingUris: string[];
      aggregationType: AggregatedViewDefinition["aggregationType"];
      metrics: string[];
      period?: string;
      benchmark?: boolean;
    }) => {
      const session = getSession();
      const def = await createViewDefinition(
        session,
        vars.name,
        vars.buildingUris,
        vars.aggregationType,
        vars.metrics,
        { period: vars.period, benchmark: vars.benchmark },
      );
      await computeAndStoreSnapshot(session, def.id);
      return def;
    },
    onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.viewDefinitions }),
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
    meta: { action: "save your organisation" },
    mutationFn: async (vars: {
      org: Pick<Organization, "name" | "homepage" | "sameAs">;
      logo?: File | null;
    }) => {
      const session = getSession();
      await saveOrganization(session, vars.org);
      if (vars.logo) await uploadOrgLogo(vars.logo, session);
    },
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

/** Dev-mode: seed the demo contacts (see {@link seedDemoContacts}). */
export function useSeedDemoContacts() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => seedDemoContacts(getSession()),
    meta: { action: "add demo contacts" },
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

/** Dev-mode: seed the demo data rooms (see {@link seedDemoRooms}). */
export function useSeedDemoRooms() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => seedDemoRooms(getSession()),
    meta: { action: "add demo data rooms" },
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

// ── Account-scope operations ─────────────────────────────────────────────────
// The dashboard's account actions: bulk seeding, the whole-collection wipe, the
// archive pair, and the sharing projection's audit/repair. The caller keeps the
// UI surfaces these need beyond the standard busy/toast handling — the
// computed-preview confirms, the full-page activity screen, and outcome
// rendering (tally toasts) — while the hook owns execution, busy state, the
// central error toast, and the invalidations.

/**
 * Dev-mode/banner: seed the fixed demo building set
 * (see {@link seedDemoBuildings}). Per-building best-effort — the result is a
 * tally `{seeded, total}`, never a throw for an individual building; the
 * caller renders partial success ("Added N of M").
 */
export function useSeedDemoBuildings() {
  const qc = useQueryClient();
  return useMutation({
    meta: { action: "add demo buildings" },
    mutationFn: () => {
      const session = getSession();
      const webId = session.info.webId;
      if (!webId) throw new Error("Not authenticated");
      return seedDemoBuildings(session, webId);
    },
    // Energy follows automatically: useEnergy is keyed on the building set.
    onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.buildings }),
  });
}

/**
 * Remove the entire app collection from the Pod (see {@link removeAppData}).
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
    meta: { action: "remove app data" },
    mutationFn: async (vars: { signal: AbortSignal }) => {
      try {
        await removeAppData(getSession(), vars.signal);
      } catch (err) {
        if (vars.signal.aborted) return { aborted: true };
        throw err;
      }
      return { aborted: false };
    },
    // The "entire-cache" invalidation: success leaves an empty Pod, an abort
    // or failure an unknown partially-deleted subset — in every case nothing
    // cached can be trusted, so reset rather than enumerate key families.
    onSettled: () => qc.clear(),
  });
}

/**
 * Dev-mode: restore an archive into the Pod (see {@link importArchive}), then
 * rebuild the WAC ACLs by replaying the shared-out log — the reconciliation
 * follow-up is part of the restore intent, because the archive carries the
 * log (ground truth) but not the derived `.acl` files. The caller owns the
 * confirmation (with its `inspectArchive` preview) and the tally toast.
 */
export function useRestoreArchive() {
  const qc = useQueryClient();
  return useMutation({
    meta: { action: "restore the archive" },
    mutationFn: async (vars: { bytes: Uint8Array }) => {
      const session = getSession();
      const restore = await importArchive(session, vars.bytes);
      const reissue = await reissueGrants(session);
      return { ...restore, reissued: reissue.buildings + reissue.views };
    },
    // The restore may have replaced anything under the app collection.
    onSettled: () => qc.invalidateQueries(),
  });
}

/**
 * Dev-mode: rebuild the WAC `.acl` projection from the shared-out event log
 * (see {@link reissueGrants}) — a materialized-projection reconciliation behind a user-intent
 * button. No invalidations: it writes only the ACL projection, which no
 * query reads.
 */
export function useReissueGrants() {
  return useMutation({
    meta: { action: "rebuild sharing" },
    mutationFn: () => reissueGrants(getSession()),
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
    meta: { action: "download the archive" },
    mutationFn: () => exportArchive(getSession()),
  });
}

/**
 * Dev-mode: dry-run diff of the `.acl` projection against the shared-out log
 * (see {@link auditGrants}).
 * @operation query — an imperative READ-intent like {@link useExportArchive}.
 * Deliberately not a `useQuery`: every click must re-read the Pod — a cached
 * audit would report stale consistency. The caller renders the verdict.
 */
export function useAuditGrants() {
  return useMutation({
    meta: { action: "check sharing consistency" },
    mutationFn: () => auditGrants(getSession()),
  });
}
