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
import { Session } from "@inrupt/solid-client-authn-browser";
import IconButton from "@mui/material/IconButton";
import PersonIcon from "@mui/icons-material/Person";
import SharingPage from "../components/SharingPage.tsx";
import DataRoomPage from "../components/DataRoomPage.tsx";
import Footer from "../components/Footer.tsx";
import { hydrateActiveRoom } from "../services/interop/dataRoom.ts";

interface IndexPageProps {
  session: Session;
  onLogout: () => void;
}

function IndexPage({ session, onLogout }: IndexPageProps) {
  const location = useLocation();
  const navigate = useNavigate();
  // Arriving from a room deep link (#/room/:uri) lands on the Data Room tab.
  const [tabValue, setTabValue] = useState(
    (location.state as { openRoom?: boolean } | null)?.openRoom ? 2 : 0,
  );
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const { reloadData } = useSolidData();

  // Load the current-room pointer from the Pod into memory once after login, so
  // the sharing dialogs (which read it synchronously) know the room app-wide.
  useEffect(() => {
    hydrateActiveRoom(session).catch(() => {});
  }, [session]);

  const menuOpen = Boolean(anchorEl);

  const handleTabChange = (_event: React.SyntheticEvent, newValue: number) => {
    // Leaving the Sharing or Data Room tab: refresh data in case sharing
    // visibility, views, or the user's data-room role changed.
    const leavingSharing = (tabValue === 1 || tabValue === 2) &&
      newValue !== tabValue;
    setTabValue(newValue);
    if (leavingSharing) {
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
    <Box sx={{ height: "calc(100vh - 50px)" }}>
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          borderBottom: 1,
          borderColor: "divider",
        }}
      >
        <Tabs value={tabValue} onChange={handleTabChange} centered>
          <Tab label="Map" />
          <Tab label="Sharing" />
          <Tab label="Room" />
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
          <IconButton
            onClick={handleMenuOpen}
            sx={{ p: 0 }}
          >
            <Avatar
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
            <MenuItem onClick={handleGuide}>
              Anleitung
            </MenuItem>
            <MenuItem onClick={handleLogout}>
              Logout
            </MenuItem>
          </Menu>
        </Box>
      </Box>
      {/* Keep the map mounted so returning to Home is instant (no Leaflet re-init / tile re-fetch). */}
      <Box
        sx={{ display: tabValue === 0 ? "block" : "none", height: "100%" }}
      >
        <Suspense fallback={<CircularProgress sx={{ mt: 4, ml: 4 }} />}>
          <Map session={session} active={tabValue === 0} />
        </Suspense>
      </Box>
      {tabValue === 1 && <SharingPage session={session} />}
      {tabValue === 2 && <DataRoomPage session={session} />}
      <Footer />
    </Box>
  );
}

export default IndexPage;
