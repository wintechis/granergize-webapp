import { lazy, Suspense, useEffect, useState } from "react";
import Avatar from "@mui/material/Avatar";
import CircularProgress from "@mui/material/CircularProgress";
import Box from "@mui/material/Box";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
const Map = lazy(() => import("./Map.tsx"));
import { useLocation, useNavigate } from "react-router-dom";
import { useSolidData } from "../context/SolidDataContext.tsx";
import { useNotification } from "../context/NotificationContext.tsx";
import {
  formatResourceList,
  listContainedResources,
  removeAppData,
} from "../services/utils/podDelete.ts";
import { getStorageRoot } from "../services/utils/solidUtils.ts";
import { Session } from "@inrupt/solid-client-authn-browser";
import IconButton from "@mui/material/IconButton";
import PersonIcon from "@mui/icons-material/Person";
import SharingPage from "../components/SharingPage.tsx";
import BuildingsPage from "../components/BuildingsPage.tsx";
import DataRoomPage from "../components/DataRoomPage.tsx";
import Footer from "../components/Footer.tsx";
import NetworkActivityIndicator from "../components/NetworkActivityIndicator.tsx";
import { hydrateActiveRoom } from "../services/interop/dataRoom.ts";
import { getAvatarObjectUrl } from "../services/utils/logoManager.ts";
import { getOrgLogoObjectUrl } from "../services/utils/organizationManager.ts";
import OrganizationDialog from "../components/OrganizationDialog.tsx";

interface IndexPageProps {
  session: Session;
  onLogout: (opts?: { suppressAutoLogin?: boolean }) => void;
}

function IndexPage({ session, onLogout }: IndexPageProps) {
  const location = useLocation();
  const navigate = useNavigate();
  // Tabs: 0 = View (map), 1 = Data (your buildings), 2 = Share, 3 = Meet (rooms).
  // Arriving from a room deep link (#/room/:uri) lands on the Meet tab.
  const [tabValue, setTabValue] = useState(
    (location.state as { openRoom?: boolean } | null)?.openRoom ? 3 : 0,
  );
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const { reloadData } = useSolidData();
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
    // Leaving the Data, Share or Meet tab: refresh in case a building was
    // added/edited/deleted, sharing/visibility changed, or the room role changed.
    const leavingMutatingTab = tabValue >= 1 && tabValue <= 3 &&
      newValue !== tabValue;
    setTabValue(newValue);
    if (leavingMutatingTab) {
      reloadData();
    }
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
        resources = await listContainedResources(`${root}granergize/`, session);
      }
    } catch { /* preview only */ }

    const list = resources.length
      ? `\n\nThis permanently deletes ${resources.length} resource(s):\n\n` +
        `${formatResourceList(resources, root)}`
      : "";

    if (
      !globalThis.confirm(
        "Remove ALL Granergize data from your Pod?" + list +
          "\n\nYour profile and organisation logo are kept. You will be logged " +
          "out. This cannot be undone.",
      )
    ) {
      return;
    }
    try {
      await removeAppData(session);
      showNotification("All app data removed", "success");
      // Log out and stay out: don't auto-restore the session, or the app would
      // silently log back in and re-bootstrap the collection we just deleted.
      onLogout({ suppressAutoLogin: true });
    } catch (err) {
      showNotification(
        `Failed to remove app data: ${(err as Error).message}`,
        "error",
      );
    }
  };

  const handleProfile = () => {
    handleMenuClose();
    if (session.info.webId) {
      globalThis.open(session.info.webId, "_blank", "noopener,noreferrer");
    }
  };

  const handleGuide = () => {
    handleMenuClose();
    navigate("/guide");
  };

  return (
    <Box
      sx={{
        height: "100vh",
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
          <Tab label="View" />
          <Tab label="Data" />
          <Tab label="Share" />
          <Tab label="Meet" />
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
            <MenuItem onClick={handleGuide}>
              Anleitung
            </MenuItem>
            <MenuItem
              onClick={handleRemoveAppData}
              sx={{ color: "error.main" }}
            >
              Remove all app data…
            </MenuItem>
            <MenuItem onClick={handleLogout}>
              Logout
            </MenuItem>
          </Menu>
        </Box>
      </Box>
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
          <Map session={session} active={tabValue === 0} />
        </Suspense>
      </Box>
      {tabValue === 1 && (
        <Box sx={{ flexGrow: 1, minHeight: 0, overflow: "auto" }}>
          <BuildingsPage session={session} />
        </Box>
      )}
      {tabValue === 2 && (
        <Box sx={{ flexGrow: 1, minHeight: 0, overflow: "auto" }}>
          <SharingPage session={session} />
        </Box>
      )}
      {tabValue === 3 && (
        <Box sx={{ flexGrow: 1, minHeight: 0, overflow: "auto" }}>
          <DataRoomPage session={session} />
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
