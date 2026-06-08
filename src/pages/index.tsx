import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import Avatar from "@mui/material/Avatar";
import CircularProgress from "@mui/material/CircularProgress";
import Box from "@mui/material/Box";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
const ExplorePage = lazy(() => import("./ExplorePage.tsx"));
import { useLocation } from "react-router-dom";
import { useNotification } from "../context/NotificationContext.tsx";
import {
  formatResourceList,
  listContainedResources,
  listDirectChildren,
  removeAppData,
} from "../services/utils/podDelete.ts";
import { APP_DIR, getStorageRoot, podResources } from "../services/utils/solidUtils.ts";
import { Session } from "@inrupt/solid-client-authn-browser";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import PersonIcon from "@mui/icons-material/Person";
import SharePage from "./SharePage.tsx";
import ManagePage from "./ManagePage.tsx";
import ConnectPage from "./ConnectPage.tsx";
import Footer from "../components/Footer.tsx";
import { useDevMode } from "../components/devMode.ts";
import NetworkActivityIndicator from "../components/NetworkActivityIndicator.tsx";
import ActivityScreen from "../components/ActivityScreen.tsx";
import { hydrateActiveRoom } from "../services/interop/dataRoom.ts";
import { getAvatarObjectUrl } from "../services/utils/logoManager.ts";
import {
  getCompanyKind,
  getOrgLogoObjectUrl,
} from "../services/utils/organizationManager.ts";
import type { UserRole } from "../types.ts";
import OrganizationDialog from "../components/OrganizationDialog.tsx";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Collapse from "@mui/material/Collapse";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "../hooks/queries.ts";
import {
  companyKindHasDemo,
  seedDemoBuildings,
} from "../services/utils/buildingSerializer.ts";
import { readPrefs, setDemoSeedDeclined } from "../services/utils/prefs.ts";
import { logError } from "../services/utils/logError.ts";
import { formatError } from "../services/utils/formatError.ts";
import {
  exportArchive,
  importArchive,
  inspectArchive,
} from "../services/utils/podArchive.ts";
import { reissueGrants } from "../services/interop/share.ts";
import { downloadBlob } from "../services/utils/download.ts";

interface IndexPageProps {
  session: Session;
  onLogout: (
    opts?: { suppressAutoLogin?: boolean; logoutType?: "app" | "idp" },
  ) => void;
}

function IndexPage({ session, onLogout }: IndexPageProps) {
  const location = useLocation();
  // Tabs: 0 = Explore (map), 1 = Manage (your buildings + views), 2 = Share
  // (inbox), 3 = Connect (rooms). Arriving from a room deep link (#/room/:uri)
  // lands on the Connect tab.
  const [tabValue, setTabValue] = useState(
    (location.state as { openRoom?: boolean } | null)?.openRoom ? 3 : 0,
  );
  const devMode = useDevMode();
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  // True while "Remove all app data" is wiping the Pod — shows a full-page
  // activity screen with the live deletion requests and a Cancel button.
  const [removing, setRemoving] = useState(false);
  const removeAbort = useRef<AbortController | null>(null);
  const { showNotification } = useNotification();

  // Avatar shown top-right: the organisation's logo (foaf:logo) if set, else the
  // person's avatar (foaf:img / vcard:hasPhoto), else a PersonIcon.
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [orgOpen, setOrgOpen] = useState(false);

  const loadAvatar = () => {
    return getOrgLogoObjectUrl(session)
      .then((org) => org ?? getAvatarObjectUrl(session))
      .then((url) => {
        setLogoUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return url;
        });
      })
      .catch((err) => logError("load organisation logo / avatar", err));
  };

  const queryClient = useQueryClient();
  // Fresh-Pod demo-buildings offer (non-blocking banner): shown when the buildings
  // container is absent (404) and the user hasn't declined. The choice persists in
  // prefs.ttl, so it doesn't nag on every login.
  const [demoShow, setDemoShow] = useState(false);
  const [demoBusy, setDemoBusy] = useState(false);
  // The user's company kind (org:classification), or null until they've filled in
  // their organisation. Gates the demo offer and selects which demo shape to seed.
  const [companyKind, setCompanyKind] = useState<UserRole | null>(null);
  // Dev-mode archive (download/upload the whole granergize/ collection as a ZIP).
  const [archiveBusy, setArchiveBusy] = useState(false);
  const archiveInput = useRef<HTMLInputElement | null>(null);

  // Re-evaluate the fresh-Pod demo offer from its actual inputs (buildings, prefs,
  // company kind) and sync `companyKind`. Offer the demo when there are no buildings
  // — whether the container is absent (null) or exists-but-empty (all buildings
  // deleted), so the offer (the only in-app seed path) comes back, not only on a
  // pristine Pod. Gated on the demo not being declined AND on a company kind we have
  // example data for — the seed mirrors that kind, so without a supported kind
  // there's nothing meaningful to seed. Runs at login AND whenever the organisation
  // dialog saves: the offer depends on the company kind, so SETTING the kind must
  // bring the banner back without a reload (a freshly-classified Pod still gets it).
  const refreshDemoOffer = useCallback(async () => {
    try {
      const webId = session.info.webId;
      if (!webId) return;
      const [children, prefs, kind] = await Promise.all([
        listDirectChildren(podResources(webId).buildings, session),
        readPrefs(session),
        getCompanyKind(session),
      ]);
      setCompanyKind(kind);
      const empty = children === null || children.length === 0;
      setDemoShow(empty && companyKindHasDemo(kind) && !prefs.demoSeedDeclined);
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
   * Seed the demo building(s) matching the user's company kind + refresh the
   * dashboard (banner & menu share this). Requires a company kind — the offer is
   * gated on it, so this is a no-op guard for the menu path.
   */
  const seedDemos = async () => {
    const webId = session.info.webId;
    if (!webId || !companyKindHasDemo(companyKind)) return;
    setDemoBusy(true);
    try {
      await seedDemoBuildings(session, webId, companyKind);
      // Refetch buildings; energy follows automatically because useEnergy is keyed on
      // the building set (so the seeded annual building's energy loads without a
      // separate, race-prone energy invalidation here).
      await queryClient.invalidateQueries({
        queryKey: queryKeys.buildings,
      });
      setDemoShow(false);
      showNotification("Demo buildings added", "success");
    } catch (err) {
      showNotification(formatError("add demo buildings", err), "error");
    } finally {
      setDemoBusy(false);
    }
  };

  const declineDemos = () => {
    setDemoShow(false);
    setDemoSeedDeclined(session, true).catch((err) =>
      logError("persist demo-seed declined", err)
    );
  };

  /** Dev-mode: download the whole granergize/ collection as a ZIP backup. */
  const handleDownloadArchive = async () => {
    if (archiveBusy) return;
    setArchiveBusy(true);
    try {
      const { bytes, count } = await exportArchive(session);
      const stamp = new Date().toISOString().slice(0, 10);
      downloadBlob(
        new Blob([bytes], { type: "application/zip" }),
        `granergize-archive-${stamp}.zip`,
      );
      showNotification(`Archived ${count} resource(s)`, "success");
    } catch (err) {
      showNotification(formatError("download archive", err), "error");
    } finally {
      setArchiveBusy(false);
    }
  };

  /** Dev-mode: restore a previously downloaded archive into the current Pod. */
  const handleArchiveFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file later
    if (!file) return;
    setArchiveBusy(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      // Restore overwrites resources at matching paths (no merge) — confirm first.
      const { count, base, webId: srcWebId } = inspectArchive(bytes);
      const webId = session.info.webId;
      const targetRoot = webId ? getStorageRoot(webId) : "";
      const notes = [
        base && base !== targetRoot
          ? `Content will be rebased from ${base} to ${targetRoot}.`
          : "",
        srcWebId && srcWebId !== webId
          ? `Owner WebID will be rewritten from ${srcWebId} to ${webId}.`
          : "",
      ].filter(Boolean);
      const rebaseNote = notes.length ? "\n\n" + notes.join("\n") : "";
      if (
        !globalThis.confirm(
          `Restore ${count} resource(s) from "${file.name}" into this Pod?\n\n` +
            "This overwrites any existing resource at a matching path under " +
            "granergize/. This cannot be undone — intended for a wiped Pod." +
            rebaseNote,
        )
      ) {
        setArchiveBusy(false);
        return;
      }
      const { restored, rebasedTo, rebasedWebId } = await importArchive(session, bytes);
      // The archive carries the shared-out/ log but not the derived .acl files,
      // so rebuild enforcement by replaying the log (now valid on this Pod since
      // the log's IRIs were rebased onto it).
      const { buildings, views } = await reissueGrants(session);
      await queryClient.invalidateQueries();
      hydrateActiveRoom(session).catch((err) =>
        logError("hydrate active data room", err)
      );
      const rebased = rebasedTo || rebasedWebId ? " (rebased)" : "";
      showNotification(
        `Restored ${restored} resource(s)${rebased}; reissued ${buildings + views} share grant(s)`,
        "success",
      );
    } catch (err) {
      showNotification(formatError("upload archive", err), "error");
    } finally {
      setArchiveBusy(false);
    }
  };

  /** Dev-mode: rebuild WAC ACLs from the shared-out/ event log (repair / audit). */
  const handleReissueGrants = async () => {
    if (archiveBusy) return;
    setArchiveBusy(true);
    try {
      const { buildings, views, skipped } = await reissueGrants(session);
      const tail = skipped ? ` (${skipped} off-Pod skipped)` : "";
      showNotification(
        `Reissued ${buildings + views} share grant(s)${tail}`,
        "success",
      );
    } catch (err) {
      showNotification(formatError("rebuild sharing", err), "error");
    } finally {
      setArchiveBusy(false);
    }
  };

  // Load (and revoke) the avatar object URL for the current session.
  useEffect(() => {
    let current: string | null = null;
    getOrgLogoObjectUrl(session)
      .then((org) => org ?? getAvatarObjectUrl(session))
      .then((url) => {
        current = url;
        setLogoUrl(url);
      })
      .catch((err) => logError("load avatar object URL", err));
    return () => {
      if (current) URL.revokeObjectURL(current);
    };
  }, [session]);

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
    setTabValue(newValue);
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
      !globalThis.confirm(
        "Remove ALL Granergize data from your Pod?" + list +
          "\n\nYour profile and organisation logo are kept. This cannot be undone.",
      )
    ) {
      return;
    }
    // Take over the screen with the live deletion requests (and a Cancel
    // button) instead of wiping silently behind a notification.
    const controller = new AbortController();
    removeAbort.current = controller;
    setRemoving(true);
    try {
      await removeAppData(session, controller.signal);
      // Stay logged in: the Pod is now a fresh, empty granergize/. Reset the
      // query caches so everything refetches empty, re-hydrate the (now absent)
      // active room, and re-offer the demo buildings — startup no longer
      // re-seeds silently, so there's nothing to "log out to avoid" any more.
      setRemoving(false);
      queryClient.clear();
      hydrateActiveRoom(session).catch((err) =>
        logError("hydrate active data room", err)
      );
      // Re-offer only when we have example data for the company kind.
      if (companyKindHasDemo(companyKind)) setDemoShow(true);
      setTabValue(0);
      showNotification("All app data removed", "success");
    } catch (err) {
      setRemoving(false);
      if (controller.signal.aborted) {
        showNotification(
          "Removal cancelled — some data may already be deleted",
          "warning",
        );
      } else {
        showNotification(
          `Failed to remove app data: ${(err as Error).message}`,
          "error",
        );
      }
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
  if (removing) {
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
          <Tooltip title={session.info.webId ?? "Account menu"}>
            <IconButton
              onClick={handleMenuOpen}
              aria-label={session.info.webId
                ? `Account menu — ${session.info.webId}`
                : "Account menu"}
              sx={{ p: 0 }}
            >
              <Avatar
                src={logoUrl ?? undefined}
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
            <MenuItem onClick={handleProfile}>
              Profile
            </MenuItem>
            <MenuItem onClick={handleOrganisation}>
              Organisation…
            </MenuItem>
            {devMode && companyKindHasDemo(companyKind) && (
              <MenuItem onClick={seedDemos} disabled={demoBusy}>
                {demoBusy ? "Adding demo buildings…" : "Add demo buildings"}
              </MenuItem>
            )}
            {devMode && (
              <MenuItem onClick={handleDownloadArchive} disabled={archiveBusy}>
                {archiveBusy ? "Working…" : "Download archive"}
              </MenuItem>
            )}
            {devMode && (
              <MenuItem
                onClick={() => archiveInput.current?.click()}
                disabled={archiveBusy}
              >
                Upload archive…
              </MenuItem>
            )}
            {devMode && (
              <MenuItem onClick={handleReissueGrants} disabled={archiveBusy}>
                Rebuild sharing from log
              </MenuItem>
            )}
            {devMode && (
              <MenuItem
                onClick={handleRemoveAppData}
                sx={{ color: "error.main" }}
              >
                Remove all app data…
              </MenuItem>
            )}
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
      <Collapse in={demoShow} sx={{ flexShrink: 0 }}>
        <Alert
          severity="info"
          sx={{ borderRadius: 0 }}
          action={
            <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
              <Button
                color="inherit"
                size="small"
                onClick={seedDemos}
                disabled={demoBusy}
              >
                {demoBusy ? "Adding…" : "Add examples"}
              </Button>
              <Button
                color="inherit"
                size="small"
                onClick={declineDemos}
                disabled={demoBusy}
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
          <ExplorePage session={session} active={tabValue === 0} />
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
