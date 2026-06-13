import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import Avatar from "@mui/material/Avatar";
import CircularProgress from "@mui/material/CircularProgress";
import Box from "@mui/material/Box";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Divider from "@mui/material/Divider";
import Switch from "@mui/material/Switch";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
const ExplorePage = lazy(() => import("./ExplorePage.tsx"));
import { useSearchParams } from "react-router-dom";
import {
  mergeParams,
  slugFromTabIndex,
  tabIndexFromSlug,
} from "./uriState.ts";
import { useNotification } from "../context/NotificationContext.tsx";
import { useConfirm } from "../context/ConfirmContext.tsx";
import {
  formatResourceList,
  listContainedResources,
  listDirectChildren,
} from "../services/pod/podDelete.ts";
import { APP_DIR, getStorageRoot, podResources } from "../services/pod/solidUtils.ts";
import { Session } from "@inrupt/solid-client-authn-browser";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import PersonIcon from "@mui/icons-material/Person";
import SharePage from "./SharePage.tsx";
import ManagePage from "./ManagePage.tsx";
import ConnectPage from "./ConnectPage.tsx";
import Footer from "../components/Footer.tsx";
import { setDevMode, useDevMode } from "../hooks/devMode.ts";
import NetworkActivityIndicator from "../components/NetworkActivityIndicator.tsx";
import ActivityScreen from "../components/ActivityScreen.tsx";
import { hydrateActiveRoom } from "../services/interop/dataRoom.ts";
import { getAvatarObjectUrl } from "../services/organization/logoManager.ts";
import { getOrgLogoObjectUrl } from "../services/organization/organizationManager.ts";
import OrganizationDialog from "../components/OrganizationDialog.tsx";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Collapse from "@mui/material/Collapse";
import { useSharedWithMe } from "../hooks/queries.ts";
import { readPrefs, setDemoSeedDeclined } from "../services/prefs.ts";
import { logError } from "../lib/logError.ts";
import { formatError } from "../lib/formatError.ts";
import { inspectArchive } from "../services/pod/podArchive.ts";
import { downloadBlob } from "../lib/download.ts";
import {
  useAuditGrants,
  useExportArchive,
  useReissueGrants,
  useRemoveAppData,
  useRestoreArchive,
  useSeedDemoBuildings,
  useSeedDemoContacts,
  useSeedDemoRooms,
} from "../hooks/mutations.ts";

interface IndexPageProps {
  session: Session;
  onLogout: (
    opts?: { suppressAutoLogin?: boolean; logoutType?: "app" | "idp" },
  ) => void;
}

/**
 * Owns the object-URL lifecycle for a profile image (personal avatar or
 * organisation logo): loads on mount / session change and re-loads when
 * `version` is bumped (after the organisation dialog saves); the cleanup
 * revokes the URL the run loaded, covering both replace and unmount. A run
 * cancelled mid-fetch revokes its own URL instead of setting it, so nothing
 * leaks.
 */
function useProfileImageUrl(
  session: Session,
  version: number,
  load: (session: Session) => Promise<string | null>,
  action: string,
): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    let current: string | null = null;
    load(session)
      .then((loaded) => {
        if (cancelled) {
          if (loaded) URL.revokeObjectURL(loaded);
          return;
        }
        current = loaded;
        setUrl(loaded);
      })
      .catch((err) => logError(action, err));
    return () => {
      cancelled = true;
      if (current) URL.revokeObjectURL(current);
    };
  }, [session, version, load, action]);
  return url;
}

function IndexPage({ session, onLogout }: IndexPageProps) {
  // Tabs: 0 = Explore (map), 1 = Manage (your buildings + views), 2 = Share
  // (inbox), 3 = Connect (rooms). The active tab lives in the hash query param
  // `?tab=` so a browser reload (or a bookmark/share) restores it — see
  // notes/ui-state.md. Arriving from a room deep link (#/room/:uri) lands on the
  // Connect tab via `?tab=connect` (set in App.tsx's RoomDeepLink).
  const [searchParams, setSearchParams] = useSearchParams();
  const tabValue = tabIndexFromSlug(searchParams.get("tab"));
  const devMode = useDevMode();
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  // "Remove all app data" — while the mutation is pending the page renders a
  // full-page activity screen with the live deletion requests and a Cancel
  // button wired to this controller.
  const removeMut = useRemoveAppData();
  const removeAbort = useRef<AbortController | null>(null);
  const { showNotification } = useNotification();
  const { confirm } = useConfirm();

  // Header images, top-right: the organisation logo (foaf:logo on the <#org>
  // node) when one is set, then the person's own avatar (foaf:img /
  // vcard:hasPhoto) if set, else a PersonIcon. The avatar is always the user's
  // identity; the logo is the organisation's. Both re-load when
  // `avatarVersion` is bumped (after the organisation dialog saves).
  const [orgOpen, setOrgOpen] = useState(false);
  const [avatarVersion, setAvatarVersion] = useState(0);
  const loadAvatar = () => setAvatarVersion((v) => v + 1);
  const avatarUrl = useProfileImageUrl(
    session,
    avatarVersion,
    getAvatarObjectUrl,
    "load avatar",
  );
  const orgLogoUrl = useProfileImageUrl(
    session,
    avatarVersion,
    getOrgLogoObjectUrl,
    "load organisation logo",
  );

  // Fresh-Pod demo-buildings offer (non-blocking banner): shown when the buildings
  // container is absent (404) and the user hasn't declined. The choice persists in
  // prefs.ttl, so it doesn't nag on every login.
  const [demoShow, setDemoShow] = useState(false);
  // "No buildings yet" would mislead someone who has buildings SHARED with them
  // (they do have buildings to explore — just none of their own), so the offer
  // also waits for the shared-in fold and stands down if any shares exist. The
  // query is warm: the buildings load already depends on the same fold.
  const sharedWithMeQuery = useSharedWithMe();
  // `data` defined ⇔ the underlying folds resolved (the composite hook has no
  // isSuccess); undefined-while-loading keeps the banner down, no flash.
  const nothingShared = sharedWithMeQuery.data !== undefined &&
    sharedWithMeQuery.data.length === 0;
  // Dev-mode archive (download/upload the whole granergize/ collection as a ZIP)
  // and the sharing projection's audit/repair pair. The export and audit are
  // imperative READ-intents (see mutations.ts); the menu items disable on the
  // union since archive/sharing maintenance shouldn't interleave.
  const exportMut = useExportArchive();
  const restoreMut = useRestoreArchive();
  const auditMut = useAuditGrants();
  const reissueMut = useReissueGrants();
  const accountBusy = exportMut.isPending || restoreMut.isPending ||
    auditMut.isPending || reissueMut.isPending;
  const archiveInput = useRef<HTMLInputElement | null>(null);

  // Re-evaluate the fresh-Pod demo offer from its actual inputs (buildings, prefs).
  // Offer the demo when there are no buildings — whether the container is absent
  // (null) or exists-but-empty (all buildings deleted), so the offer (the only in-app
  // seed path) comes back, not only on a pristine Pod — and the demo hasn't been
  // declined. The fixed demo set is role-independent (no company kind gating).
  const refreshDemoOffer = useCallback(async () => {
    try {
      const webId = session.info.webId;
      if (!webId) return;
      const [children, prefs] = await Promise.all([
        listDirectChildren(podResources(webId).buildings, session),
        readPrefs(session),
      ]);
      const empty = children === null || children.length === 0;
      setDemoShow(empty && !prefs.demoSeedDeclined);
    } catch (err) {
      // The offer is best-effort, but log so a probe that silently fails (e.g. an
      // NSS Pod listing the buildings container differently) is diagnosable.
      logError("check whether to offer demo buildings", err);
    }
  }, [session]);

  useEffect(() => {
    refreshDemoOffer();
  }, [refreshDemoOffer]);

  /**
   * Seed the fixed demo building(s) — banner & menu share this. The hook owns
   * execution + the buildings invalidation (energy follows: useEnergy is keyed
   * on the building set); the seeder is best-effort per building (it never
   * throws for one), so the tally is the only place a partial failure
   * surfaces — rendered honestly here. Thrown errors toast centrally.
   */
  const seedBuildingsMut = useSeedDemoBuildings();
  const seedDemos = () =>
    seedBuildingsMut.mutate(undefined, {
      onSuccess: ({ seeded, total }) => {
        if (seeded === total) {
          setDemoShow(false);
          showNotification("Demo buildings added", "success");
        } else if (seeded > 0) {
          setDemoShow(false);
          showNotification(
            `Added ${seeded} of ${total} demo buildings`,
            "warning",
          );
        } else {
          showNotification(
            formatError(
              "add demo buildings",
              new Error("no building could be written"),
            ),
            "error",
          );
        }
      },
    });

  // Dev-mode Connect-tab demo data — the contacts/rooms counterpart of
  // `seedDemos` (the seeders tally partial success the same way).
  const seedContactsMut = useSeedDemoContacts();
  const seedRoomsMut = useSeedDemoRooms();
  const seedDemoContactsClick = () =>
    seedContactsMut.mutate(undefined, {
      onSuccess: ({ seeded, total }) =>
        showNotification(
          seeded === total
            ? "Demo contacts added"
            : `Added ${seeded} of ${total} demo contacts`,
          seeded === total ? "success" : "warning",
        ),
    });
  const seedDemoRoomsClick = () =>
    seedRoomsMut.mutate(undefined, {
      onSuccess: ({ rooms, total }) =>
        showNotification(
          rooms.length === total
            ? "Demo data rooms added"
            : `Added ${rooms.length} of ${total} demo data rooms`,
          rooms.length === total ? "success" : "warning",
        ),
    });

  const declineDemos = () => {
    setDemoShow(false);
    setDemoSeedDeclined(session, true).catch((err) =>
      logError("persist demo-seed declined", err)
    );
  };

  /** Dev-mode: download the whole granergize/ collection as a ZIP backup. */
  const handleDownloadArchive = () =>
    exportMut.mutate(undefined, {
      onSuccess: ({ bytes, count }) => {
        const stamp = new Date().toISOString().slice(0, 10);
        downloadBlob(
          new Blob([bytes], { type: "application/zip" }),
          `granergize-archive-${stamp}.zip`,
        );
        showNotification(`Archived ${count} resource(s)`, "success");
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
          ? `Content will be rebased from ${preview.base} to ${targetRoot}.`
          : "",
        preview.webId && preview.webId !== webId
          ? `Owner WebID will be rewritten from ${preview.webId} to ${webId}.`
          : "",
      ].filter(Boolean);
      rebaseNote = notes.length ? "\n\n" + notes.join("\n") : "";
    } catch (err) {
      // A pre-mutation failure (unreadable file / not an archive) — the
      // mutation's central toast can't cover it.
      showNotification(formatError("read the archive", err), "error");
      return;
    }
    if (
      !await confirm({
        title: "Restore archive",
        message:
          `Restore ${count} resource(s) from "${file.name}" into this Pod?\n\n` +
          "This overwrites any existing resource at a matching path under " +
          "granergize/. This cannot be undone — intended for a wiped Pod." +
          rebaseNote,
        confirmLabel: "Restore",
      })
    ) {
      return;
    }
    restoreMut.mutate({ bytes }, {
      onSuccess: ({ restored, rebasedTo, rebasedWebId, reissued }) => {
        hydrateActiveRoom(session).catch((err) =>
          logError("hydrate active data room", err)
        );
        const rebased = rebasedTo || rebasedWebId ? " (rebased)" : "";
        showNotification(
          `Restored ${restored} resource(s)${rebased}; reissued ${reissued} share grant(s)`,
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
          missing ? `${missing} deleted skipped` : "",
          skipped ? `${skipped} off-Pod skipped` : "",
        ].filter(Boolean);
        const tail = tails.length ? ` (${tails.join(", ")})` : "";
        if (drift.length === 0) {
          showNotification(
            `Sharing consistent: ${checked} grant(s) match the log${tail}`,
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
            `Sharing drift: ${drift.length} of ${checked} grant(s) differ from the log` +
              ` — run "Rebuild sharing from log"${tail}`,
            "warning",
          );
        }
      },
    });

  /** Dev-mode: rebuild WAC ACLs from the shared-out/ event log (repair / audit). */
  const handleReissueGrants = () =>
    reissueMut.mutate(undefined, {
      onSuccess: ({ buildings, views, skipped, missing, revoked }) => {
        const tails = [
          revoked ? `${revoked} revocation(s) replayed` : "",
          missing ? `${missing} deleted skipped` : "",
          skipped ? `${skipped} off-Pod skipped` : "",
        ].filter(Boolean);
        const tail = tails.length ? ` (${tails.join(", ")})` : "";
        showNotification(
          `Reissued ${buildings + views} share grant(s)${tail}`,
          "success",
        );
      },
    });

  const handleOrganisation = () => {
    handleMenuClose();
    setOrgOpen(true);
  };

  // Load the current-room pointer from the Pod into memory once after login, so
  // the sharing dialogs (which read it synchronously) know the room app-wide.
  useEffect(() => {
    hydrateActiveRoom(session).catch((err) =>
      logError("hydrate active data room on login", err)
    );
  }, [session]);

  const menuOpen = Boolean(anchorEl);

  const handleTabChange = (_event: React.SyntheticEvent, newValue: number) => {
    // No refresh-on-switch: every write already invalidates its own queries
    // (add/edit call reloadData on success; delete/visibility/share/view use
    // mutation hooks that invalidate). A blanket reload here just refetched the
    // whole dataset on every tab change — a request storm for nothing.
    // `replace` keeps tab switches out of the browser history (matches the old
    // state-only behaviour); `mergeParams` preserves Explore's `b`/`dt`.
    setSearchParams((p) => mergeParams(p, { tab: slugFromTabIndex(newValue) }), {
      replace: true,
    });
  };

  const handleMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleMenuClose = () => {
    setAnchorEl(null);
  };

  const handleLogout = () => {
    handleMenuClose();
    onLogout();
  };

  // Full logout AT the identity provider (clears its login cookie), so the next
  // login shows the account chooser instead of silently reusing this account —
  // the only way to switch accounts. Plain "Logout" leaves the IdP session intact.
  const handleChangeAccount = () => {
    handleMenuClose();
    onLogout({ logoutType: "idp" });
  };

  // Permanently wipe the whole granergize/ collection from the Pod, then log out.
  // The organisation logo lives in profile/ and is kept.
  const handleRemoveAppData = async () => {
    handleMenuClose();

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
        resources = await listContainedResources(`${root}${APP_DIR}/`, session);
      }
    } catch (err) {
      logError("list app-data resources for wipe preview", err);
      /* preview only */
    }

    const list = resources.length
      ? `\n\nThis permanently deletes ${resources.length} resource(s):\n\n` +
        `${formatResourceList(resources, root)}`
      : "";

    if (
      !await confirm({
        title: "Remove all app data",
        message: "Remove ALL Granergize data from your Pod?" + list +
          "\n\nYour profile and organisation logo are kept. This cannot be undone.",
        confirmLabel: "Remove all",
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
        showNotification(
          "Removal cancelled — some data may already be deleted",
          "warning",
        );
        return;
      }
      // Stay logged in: the Pod is now a fresh, empty granergize/ (the caches
      // were reset by the mutation). Re-hydrate the (now absent) active room
      // and re-offer the demo buildings — startup no longer re-seeds silently,
      // so there's nothing to "log out to avoid" any more.
      hydrateActiveRoom(session).catch((err) =>
        logError("hydrate active data room", err)
      );
      // Re-offer the demo buildings now the collection is empty again.
      setDemoShow(true);
      setSearchParams((p) => mergeParams(p, { tab: "explore" }), { replace: true });
      showNotification("All app data removed", "success");
    } catch {
      // Already toasted centrally via the hook's meta.action.
    } finally {
      removeAbort.current = null;
    }
  };

  const handleCancelRemove = () => removeAbort.current?.abort();

  const handleProfile = () => {
    handleMenuClose();
    if (session.info.webId) {
      globalThis.open(session.info.webId, "_blank", "noopener,noreferrer");
    }
  };

  // While wiping the Pod, take over the screen so the user sees the deletions
  // in flight and can cancel — rather than the app shell sitting there.
  if (removeMut.isPending) {
    return (
      <ActivityScreen
        title="Removing all app data…"
        onCancel={handleCancelRemove}
      />
    );
  }

  return (
    <Box
      sx={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          borderBottom: 1,
          borderColor: "divider",
          flexShrink: 0,
        }}
      >
        <Tabs value={tabValue} onChange={handleTabChange} centered>
          <Tab label="Explore" />
          <Tab label="Manage" />
          <Tab label="Share" />
          <Tab label="Connect" />
        </Tabs>
        <Box
          sx={{
            marginLeft: "auto",
            mr: 2,
            display: "flex",
            alignItems: "center",
            gap: 2,
          }}
        >
          <NetworkActivityIndicator />
          {orgLogoUrl && (
            <Box
              component="img"
              src={orgLogoUrl}
              alt="Organisation logo"
              sx={{ height: 40, maxWidth: 120, objectFit: "contain" }}
            />
          )}
          <Tooltip title={session.info.webId ?? "Account menu"}>
            <IconButton
              onClick={handleMenuOpen}
              aria-label={session.info.webId
                ? `Account menu — ${session.info.webId}`
                : "Account menu"}
              sx={{ p: 0 }}
            >
              <Avatar
                src={avatarUrl ?? undefined}
                sx={{
                  bgcolor: "primary.main",
                  width: 40,
                  height: 40,
                }}
              >
                <PersonIcon />
              </Avatar>
            </IconButton>
          </Tooltip>
          <Menu
            anchorEl={anchorEl}
            open={menuOpen}
            onClose={handleMenuClose}
            onClick={handleMenuClose}
            transformOrigin={{ horizontal: "right", vertical: "top" }}
            anchorOrigin={{ horizontal: "right", vertical: "bottom" }}
            slotProps={{
              paper: {
                elevation: 0,
                sx: {
                  overflow: "visible",
                  filter: "drop-shadow(0px 2px 8px rgba(0,0,0,0.32))",
                  mt: 1.5,
                  minWidth: 180,
                },
              },
            }}
          >
            {/* Identity */}
            <MenuItem onClick={handleProfile}>
              Profile
            </MenuItem>
            <MenuItem onClick={handleOrganisation}>
              Organisation…
            </MenuItem>

            {/* Developer-mode toggle — fixed third entry, present in both modes */}
            <Divider />
            <MenuItem
              // Keep the menu open and flip the switch in place — this toggles a
              // setting rather than running an action, so don't dismiss.
              onClick={(e) => {
                e.stopPropagation();
                setDevMode(!devMode);
              }}
              sx={{ justifyContent: "space-between", gap: 2 }}
            >
              Developer mode
              <Switch edge="end" size="small" checked={devMode} tabIndex={-1} />
            </MenuItem>

            {/* Dev: demo fixtures */}
            {devMode && <Divider />}
            {devMode && (
              <MenuItem onClick={seedDemos} disabled={seedBuildingsMut.isPending}>
                {seedBuildingsMut.isPending
                  ? "Adding…"
                  : "Add example buildings"}
              </MenuItem>
            )}
            {devMode && (
              <MenuItem
                onClick={() => {
                  seedDemoContactsClick();
                  seedDemoRoomsClick();
                }}
                disabled={seedContactsMut.isPending || seedRoomsMut.isPending}
              >
                {seedContactsMut.isPending || seedRoomsMut.isPending
                  ? "Adding…"
                  : "Add example contacts and rooms"}
              </MenuItem>
            )}

            {/* Dev: archive */}
            {devMode && <Divider />}
            {devMode && (
              <MenuItem onClick={handleDownloadArchive} disabled={accountBusy}>
                {accountBusy ? "Working…" : "Download archive"}
              </MenuItem>
            )}
            {devMode && (
              <MenuItem
                onClick={() => archiveInput.current?.click()}
                disabled={accountBusy}
              >
                Upload archive…
              </MenuItem>
            )}

            {/* Dev: sharing maintenance */}
            {devMode && <Divider />}
            {devMode && (
              <MenuItem onClick={handleAuditGrants} disabled={accountBusy}>
                Check sharing consistency
              </MenuItem>
            )}
            {devMode && (
              <MenuItem onClick={handleReissueGrants} disabled={accountBusy}>
                Rebuild sharing from log
              </MenuItem>
            )}

            {/* Dev: documentation */}
            {devMode && <Divider />}
            {devMode && (
              <MenuItem
                component="a"
                href={`${import.meta.env.BASE_URL}granergize-handbuch.docx`}
              >
                Praxishandbuch herunterladen
              </MenuItem>
            )}

            {/* Dev: destructive */}
            {devMode && <Divider />}
            {devMode && (
              <MenuItem
                onClick={handleRemoveAppData}
                sx={{ color: "error.main" }}
              >
                Remove all app data…
              </MenuItem>
            )}

            {/* Logout */}
            <Divider />
            {devMode && (
              <MenuItem onClick={handleChangeAccount}>
                Change account (full logout)
              </MenuItem>
            )}
            <MenuItem onClick={handleLogout}>
              Logout
            </MenuItem>
          </Menu>
        </Box>
      </Box>
      {/* Hidden picker for the dev-mode "Upload archive…" menu item. */}
      <input
        ref={archiveInput}
        type="file"
        accept=".zip,application/zip"
        style={{ display: "none" }}
        onChange={handleArchiveFile}
      />
      {/* Fresh-Pod onboarding: offer the demo buildings instead of writing them
          silently. Non-blocking (the app stays usable); dismissing it persists. */}
      <Collapse in={demoShow && nothingShared} sx={{ flexShrink: 0 }}>
        <Alert
          severity="info"
          sx={{ borderRadius: 0 }}
          action={
            <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
              <Button
                color="inherit"
                size="small"
                onClick={seedDemos}
                disabled={seedBuildingsMut.isPending}
              >
                {seedBuildingsMut.isPending ? "Adding…" : "Add examples"}
              </Button>
              <Button
                color="inherit"
                size="small"
                onClick={declineDemos}
                disabled={seedBuildingsMut.isPending}
              >
                No thanks
              </Button>
            </Box>
          }
        >
          No buildings yet — add a couple of example buildings to explore?
        </Alert>
      </Collapse>
      {/* Keep the map mounted so returning to Home is instant (no Leaflet re-init / tile re-fetch).
          Content area fills the remaining column height; the footer below stays pinned. */}
      <Box
        sx={{
          display: tabValue === 0 ? "flex" : "none",
          flexDirection: "column",
          flexGrow: 1,
          minHeight: 0,
        }}
      >
        <Suspense fallback={<CircularProgress sx={{ mt: 4, ml: 4 }} />}>
          <ExplorePage active={tabValue === 0} />
        </Suspense>
      </Box>
      {tabValue === 1 && (
        <Box sx={{ flexGrow: 1, minHeight: 0, overflow: "auto" }}>
          <ManagePage session={session} />
        </Box>
      )}
      {tabValue === 2 && (
        <Box sx={{ flexGrow: 1, minHeight: 0, overflow: "auto" }}>
          <SharePage session={session} />
        </Box>
      )}
      {tabValue === 3 && (
        <Box sx={{ flexGrow: 1, minHeight: 0, overflow: "auto" }}>
          <ConnectPage session={session} />
        </Box>
      )}
      <Box sx={{ flexShrink: 0 }}>
        <Footer />
      </Box>
      <OrganizationDialog
        open={orgOpen}
        session={session}
        onClose={() => setOrgOpen(false)}
        onSaved={() => {
          loadAvatar();
          refreshDemoOffer();
        }}
      />
    </Box>
  );
}

export default IndexPage;
