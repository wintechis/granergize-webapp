import { useState } from "react";
import Avatar from "@mui/material/Avatar";
import Box from "@mui/material/Box";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import Map from "./Map.tsx";
import { useSolidData } from "../context/SolidDataContext.tsx";
import { readInbox } from "../services/interop/inbox.ts";
import EnergyMix from "./EnergyMix.tsx";
import QueryService from "./QueryService.tsx";
import { Session } from "@inrupt/solid-client-authn-browser";
import IconButton from "@mui/material/IconButton";
import RefreshIcon from "@mui/icons-material/Refresh";
import PersonIcon from "@mui/icons-material/Person";
import SettingsDialog from "../components/SettingsDialog.tsx";

interface IndexPageProps {
  session: Session;
  onLogout: () => void;
}

function IndexPage({ session, onLogout }: IndexPageProps) {
  const [tabValue, setTabValue] = useState(0);
  const [inboxLoading, setInboxLoading] = useState(false);
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { reloadData } = useSolidData();
  
  const menuOpen = Boolean(anchorEl);

  const handleTabChange = (_event: React.SyntheticEvent, newValue: number) => {
    setTabValue(newValue);
  };

  const handleRefresh = async () => {
    setInboxLoading(true);
    try {
      await readInbox(session);
      await reloadData();
    } catch (err) {
      console.error("Error reading inbox:", err);
    } finally {
      setInboxLoading(false);
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

  const handleSettingsOpen = () => {
    handleMenuClose();
    setSettingsOpen(true);
  };

  const handleSettingsClose = () => {
    setSettingsOpen(false);
    reloadData(); // Reload data when settings close in case visibility changed
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
          <Tab label="Home" />
          <Tab label="Energy Mix" />
          <Tab label="Query Service" />
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
          onClick={handleRefresh}
          disabled={inboxLoading}
          color="primary"
          size="large"
          sx={{ border: "none", background: "transparent" }}
        >
          <RefreshIcon />
        </IconButton>
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
              <PersonIcon
                 
              />
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
            <MenuItem onClick={handleSettingsOpen}>
              Settings
            </MenuItem>
            <MenuItem onClick={handleLogout}>
              Logout
            </MenuItem>
          </Menu>
        </Box>
      </Box>
      {tabValue === 0 && <Map session={session} />}
      {tabValue === 1 && <EnergyMix />}
      {tabValue === 2 && <QueryService />}
      <SettingsDialog
        open={settingsOpen}
        onClose={handleSettingsClose}
        session={session}
      />
    </Box>
  );
}

export default IndexPage;
