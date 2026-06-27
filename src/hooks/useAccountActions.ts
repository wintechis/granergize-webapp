import { type RefObject, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Session } from "@inrupt/solid-client-authn-browser";
import { sessionGateway } from "../services/pod/podGateway.ts";
import { useNotification } from "../context/NotificationContext.tsx";
import { useConfirm } from "../context/ConfirmContext.tsx";
import {
  formatResourceList,
  listContainedResources,
} from "../services/pod/podDelete.ts";
import { APP_DIR, getStorageRoot } from "../services/pod/solidUtils.ts";
import { hydrateActiveRoom } from "../services/interop/dataRoom.ts";
import { logError } from "../lib/logError.ts";
import { formatError } from "../lib/formatError.ts";
import { msg } from "../lib/messages.ts";
import { inspectArchive } from "../services/pod/podArchive.ts";
import { downloadBlob } from "../lib/download.ts";
import { FINDERS } from "../routes.ts";
import {
  useAuditGrants,
  useCheckObservationLinks,
  useExportArchive,
  useReissueGrants,
  useRemoveAppData,
  useRestoreArchive,
} from "./mutations.ts";

export interface AccountActions {
  /** Ref for the hidden "Import archive…" file picker the shell renders. */
  archiveInput: RefObject<HTMLInputElement | null>;
  handleDownloadArchive: () => void;
  handleArchiveFile: (e: React.ChangeEvent<HTMLInputElement>) => Promise<void>;
  handleAuditGrants: () => void;
  handleCheckObsLinks: () => void;
  handleReissueGrants: () => void;
  handleRemoveAppData: () => Promise<void>;
  handleCancelRemove: () => void;
  /** True while any archive/sharing-maintenance op is in flight (menu disable). */
  accountBusy: boolean;
  /** True while "Remove all app data" runs — the shell takes over the screen. */
  removing: boolean;
}

/**
 * The dev-mode account operations behind the profile menu: archive
 * download/restore, the sharing projection's audit/repair pair, the
 * observation-link drift check, and the destructive "Remove all app data" flow.
 * Extracted from {@link AppShell} so the shell is just chrome + outlet; these are
 * self-contained Pod mutations wired straight to `AccountMenu`.
 *
 * The two shell touch-points are passed in: `onMenuClose` (close the profile
 * menu) and `onResetOnboarding` (re-offer the demo buildings once the Pod is
 * wiped empty again) — the hook owns everything else.
 */
export function useAccountActions(
  session: Session,
  opts: { onMenuClose: () => void; onResetOnboarding: () => void },
): AccountActions {
  const { onMenuClose, onResetOnboarding } = opts;
  const navigate = useNavigate();
  const { showNotification } = useNotification();
  const { confirm } = useConfirm();

  // "Remove all app data" — while the mutation is pending the shell renders a
  // full-page activity screen with the live deletion requests and a Cancel
  // button wired to this controller.
  const removeMut = useRemoveAppData();
  const removeAbort = useRef<AbortController | null>(null);

  // Dev-mode archive (download/upload the whole granergize/ collection as a ZIP)
  // and the sharing projection's audit/repair pair. The export and audit are
  // imperative READ-intents (see mutations.ts); the menu items disable on the
  // union since archive/sharing maintenance shouldn't interleave.
  const exportMut = useExportArchive();
  const restoreMut = useRestoreArchive();
  const auditMut = useAuditGrants();
  const obsLinksMut = useCheckObservationLinks();
  const reissueMut = useReissueGrants();
  const accountBusy = exportMut.isPending || restoreMut.isPending ||
    auditMut.isPending || obsLinksMut.isPending || reissueMut.isPending;
  const archiveInput = useRef<HTMLInputElement | null>(null);

  /** Dev-mode: download the whole granergize/ collection as a ZIP backup. */
  const handleDownloadArchive = () =>
    exportMut.mutate(undefined, {
      onSuccess: ({ bytes, count }) => {
        const stamp = new Date().toISOString().slice(0, 10);
        downloadBlob(
          new Blob([bytes as BlobPart], { type: "application/zip" }),
          `granergize-archive-${stamp}.zip`,
        );
        showNotification(msg("archived", { count }), "success");
      },
    });

  /** Dev-mode: restore a previously downloaded archive into the current Pod.
   * The file read + `inspectArchive` preview parameterise the confirm; the
   * restore itself (incl. the ACL rebuild from the restored log) is the
   * mutation, which also owns the invalidate-all. */
  const handleArchiveFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file later
    if (!file) return;
    let bytes: Uint8Array;
    let count: number;
    let rebaseNote: string;
    try {
      bytes = new Uint8Array(await file.arrayBuffer());
      // Restore overwrites resources at matching paths (no merge) — confirm first.
      const preview = inspectArchive(bytes);
      count = preview.count;
      const webId = session.info.webId;
      const targetRoot = webId ? getStorageRoot(webId) : "";
      const notes = [
        preview.base && preview.base !== targetRoot
          ? msg("devRebaseContent", { base: preview.base, target: targetRoot })
          : "",
        preview.webId && preview.webId !== webId
          ? msg("devRebaseWebId", { old: preview.webId, new: webId ?? "" })
          : "",
      ].filter(Boolean);
      rebaseNote = notes.length ? "\n\n" + notes.join("\n") : "";
    } catch (err) {
      // A pre-mutation failure (unreadable file / not an archive) — the
      // mutation's central toast can't cover it.
      showNotification(formatError("actionReadArchive", err), "error");
      return;
    }
    if (
      !await confirm({
        title: msg("dlgRestoreArchive"),
        message: msg("devRestoreConfirm", { count, file: file.name }) + rebaseNote,
        confirmLabel: msg("btnRestore"),
      })
    ) {
      return;
    }
    restoreMut.mutate({ bytes }, {
      onSuccess: ({ restored, rebasedTo, rebasedWebId, reissued }) => {
        hydrateActiveRoom(sessionGateway(session)).catch((err) =>
          logError("hydrate active data room", err)
        );
        const rebased = rebasedTo || rebasedWebId ? msg("devRebased") : "";
        showNotification(
          msg("devRestoreSuccess", { restored, rebased, reissued }),
          "success",
        );
      },
    });
  };

  /** Dev-mode: dry-run diff of the .acl projection against the shared-out/ log —
   * read-only drift detection (the diffing twin of "Rebuild sharing from log"). */
  const handleAuditGrants = () =>
    auditMut.mutate(undefined, {
      onSuccess: ({ checked, drift, skipped, missing }) => {
        const tails = [
          missing ? msg("devAuditMissing", { count: missing }) : "",
          skipped ? msg("devAuditSkipped", { count: skipped }) : "",
        ].filter(Boolean);
        const tail = tails.length ? ` (${tails.join(", ")})` : "";
        if (drift.length === 0) {
          showNotification(
            msg("devAuditConsistent", { checked, tail }),
            "success",
          );
        } else {
          // Name each drifted pair on the console so a dev sees exactly what a
          // rebuild would change (the toast only carries the count).
          console.warn(
            "Sharing drift:",
            drift.map((d) => `${d.kind} ${d.resource} → ${d.grantee}`),
          );
          showNotification(
            msg("devAuditDrift", { drift: drift.length, checked, tail }),
            "warning",
          );
        }
      },
    });

  /** Dev-mode: dry-run diff of each observation's `ofBuilding` against the building's
   * `hasEnergyDataset` link — read-only drift detection (own-Pod), the observation-link
   * twin of "Check sharing consistency". */
  const handleCheckObsLinks = () =>
    obsLinksMut.mutate(undefined, {
      onSuccess: ({ checked, drift }) => {
        if (drift.length === 0) {
          showNotification(msg("devObsLinksConsistent", { checked }), "success");
        } else {
          // Name each drifted pair on the console (the toast only carries the count).
          console.warn(
            "Observation-link drift:",
            drift.map((d) => `${d.kind} ${d.dataset} ↔ ${d.building}`),
          );
          showNotification(
            msg("devObsLinksDrift", { drift: drift.length, checked }),
            "warning",
          );
        }
      },
    });

  /** Dev-mode: rebuild WAC ACLs from the shared-out/ event log (repair / audit). */
  const handleReissueGrants = () =>
    reissueMut.mutate(undefined, {
      onSuccess: ({ buildings, aggregations, skipped, missing, revoked }) => {
        const tails = [
          revoked ? msg("devReissueRevoked", { count: revoked }) : "",
          missing ? msg("devAuditMissing", { count: missing }) : "",
          skipped ? msg("devAuditSkipped", { count: skipped }) : "",
        ].filter(Boolean);
        const tail = tails.length ? ` (${tails.join(", ")})` : "";
        showNotification(
          msg("devReissueSuccess", { count: buildings + aggregations, tail }),
          "success",
        );
      },
    });

  // Permanently wipe the whole granergize/ collection from the Pod, then log out.
  // The organisation logo lives in profile/ and is kept.
  const handleRemoveAppData = async () => {
    onMenuClose();

    let root = "";
    try {
      if (session.info.webId) root = getStorageRoot(session.info.webId);
    } catch (err) {
      logError("resolve storage root for app-data wipe", err);
      /* not resolved — fall back to absolute URLs */
    }

    // Show exactly what will be wiped (everything under granergize/).
    let resources: string[] = [];
    try {
      if (root) {
        resources = await listContainedResources(`${root}${APP_DIR}/`, sessionGateway(session));
      }
    } catch (err) {
      logError("list app-data resources for wipe preview", err);
      /* preview only */
    }

    const list = resources.length
      ? `\n\n${msg("devRemoveDeletes", { count: resources.length })}\n\n` +
        `${formatResourceList(resources, root)}`
      : "";

    if (
      !await confirm({
        title: msg("dlgRemoveAppData"),
        message: msg("devRemoveAllHead") + list + "\n\n" + msg("devRemoveAllTail"),
        confirmLabel: msg("btnRemoveAll"),
      })
    ) {
      return;
    }
    // Take over the screen with the live deletion requests (and a Cancel
    // button) instead of wiping silently behind a notification. The mutation
    // settle clears the WHOLE query cache (mutation cache included), so the
    // post-success flow runs in this continuation — mutate-option callbacks
    // would not survive the clear. A cancel resolves as an outcome
    // ({aborted: true}); a real failure rejects and the central
    // "Failed to remove app data" toast has already reported it.
    const controller = new AbortController();
    removeAbort.current = controller;
    try {
      const { aborted } = await removeMut.mutateAsync({
        signal: controller.signal,
      });
      if (aborted) {
        showNotification(msg("removalCancelled"), "warning");
        return;
      }
      // Stay logged in: the Pod is now a fresh, empty granergize/ (the caches
      // were reset by the mutation). Re-hydrate the (now absent) active room
      // and re-offer the demo buildings — startup no longer re-seeds silently,
      // so there's nothing to "log out to avoid" any more.
      hydrateActiveRoom(sessionGateway(session)).catch((err) =>
        logError("hydrate active data room", err)
      );
      // Re-offer the demo buildings now the collection is empty again: the wipe
      // cleared the query cache, so useDemoOffer re-probes the (now empty) Pod and
      // returns true; just lift any in-session dismissal so the banner can show.
      onResetOnboarding();
      void navigate(FINDERS.buildings, { replace: true });
      showNotification(msg("allDataRemoved"), "success");
    } catch {
      // Already toasted centrally via the hook's meta.action.
    } finally {
      removeAbort.current = null;
    }
  };

  const handleCancelRemove = () => removeAbort.current?.abort();

  return {
    archiveInput,
    handleDownloadArchive,
    handleArchiveFile,
    handleAuditGrants,
    handleCheckObsLinks,
    handleReissueGrants,
    handleRemoveAppData,
    handleCancelRemove,
    accountBusy,
    removing: removeMut.isPending,
  };
}
