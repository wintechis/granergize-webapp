import { lazy, Suspense, useEffect, useRef, useState } from "react";
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
import PersonIcon from "@mui/icons-material/Person";
import SharePage from "./SharePage.tsx";
import ManagePage from "./ManagePage.tsx";
import ConnectPage from "./ConnectPage.tsx";
import Footer from "../components/Footer.tsx";
import NetworkActivityIndicator from "../components/NetworkActivityIndicator.tsx";
import ActivityScreen from "../components/ActivityScreen.tsx";
import { hydrateActiveRoom } from "../services/interop/dataRoom.ts";
import { getAvatarObjectUrl } from "../services/utils/logoManager.ts";
import { getOrgLogoObjectUrl } from "../services/utils/organizationManager.ts";
import OrganizationDialog from "../components/OrganizationDialog.tsx";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Collapse from "@mui/material/Collapse";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "../hooks/queries.ts";
import { seedDemoBuildings } from "../services/utils/buildingSerializer.ts";
import { readPrefs, setDemoSeedDeclined } from "../services/utils/prefs.ts";
import { formatError } from "../services/utils/formatError.ts";

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
      .catch(() => {});
  };

  const queryClient = useQueryClient();
  // Fresh-Pod demo-buildings offer (non-blocking banner): shown when the buildings
  // container is absent (404) and the user hasn't declined. The choice persists in
  // prefs.ttl, so it doesn't nag on every login.
  const [demoShow, setDemoShow] = useState(false);
  const [demoBusy, setDemoBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const webId = session.info.webId;
        if (!webId) return;
        const [children, prefs] = await Promise.all([
          listDirectChildren(podResources(webId).buildings, session),
          readPrefs(session),
        ]);
        if (!cancelled && children === null && !prefs.demoSeedDeclined) {
          setDemoShow(true);
        }
      } catch { /* the offer is best-effort */ }
    })();
    return () => {
      cancelled = true;
    };
  }, [session]);

  /** Seed the two demo buildings + refresh the dashboard (banner & menu share this). */
  const seedDemos = async () => {
    const webId = session.info.webId;
    if (!webId) return;
    setDemoBusy(true);
    try {
      await seedDemoBuildings(session, webId);
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
    setDemoSeedDeclined(session, true).catch(() => {});
  };

  const handleCreateDemos = () => {
    handleMenuClose();
    seedDemos();
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
      .catch(() => {});
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
    hydrateActiveRoom(session).catch(() => {});
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

  // Switch account: log out at the identity provider too, so it doesn't silently
  // re-authorize the same account on the next login. Redirects to the provider.
  const handleSwitchAccount = () => {
    handleMenuClose();
    onLogout({ suppressAutoLogin: true, logoutType: "idp" });
  };

  // Permanently wipe the whole granergize/ collection from the Pod, then log out.
  // The organisation logo lives in profile/ and is kept.
  const handleRemoveAppData = async () => {
    handleMenuClose();

    let root = "";
    try {
      if (session.info.webId) root = getStorageRoot(session.info.webId);
    } catch { /* not resolved — fall back to absolute URLs */ }

    // Show exactly what will be wiped (everything under granergize/).
    let resources: string[] = [];
    try {
      if (root) {
        resources = await listContainedResources(`${root}${APP_DIR}/`, session);
      }
    } catch { /* preview only */ }

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
      hydrateActiveRoom(session).catch(() => {});
      setDemoShow(true);
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
          <IconButton
            onClick={handleMenuOpen}
            aria-label="Account menu"
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
            <MenuItem onClick={handleCreateDemos}>
              Create demo buildings
            </MenuItem>
            <MenuItem
              onClick={handleRemoveAppData}
              sx={{ color: "error.main" }}
            >
              Remove all app data…
            </MenuItem>
            <MenuItem onClick={handleSwitchAccount}>
              Switch account…
            </MenuItem>
            <MenuItem onClick={handleLogout}>
              Logout
            </MenuItem>
          </Menu>
        </Box>
      </Box>
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
        onSaved={loadAvatar}
      />
    </Box>
  );
}

export default IndexPage;
