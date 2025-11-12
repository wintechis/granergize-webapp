import { useState } from "react";
import Box from "@mui/material/Box";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import Button from "@mui/material/Button";
import Map from "./Map.tsx";
import { useSolidData } from "../context/SolidDataContext.tsx";
import { readInbox } from "../services/interop/inbox.ts";
import EnergyMix from "./EnergyMix.tsx";
import QueryService from "./QueryService.tsx";
import { Session } from "@inrupt/solid-client-authn-browser";
import IconButton from "@mui/material/IconButton";
import RefreshIcon from "@mui/icons-material/Refresh";

interface IndexPageProps {
  session: Session;
  onLogout: () => void;
}

function IndexPage({ session, onLogout }: IndexPageProps) {
  const [tabValue, setTabValue] = useState(0);
  const [inboxLoading, setInboxLoading] = useState(false);
  const { reloadData } = useSolidData();

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
          <Button onClick={onLogout}>Logout</Button>
        </Box>
      </Box>
      {tabValue === 0 && <Map session={session} />}
      {tabValue === 1 && <EnergyMix />}
      {tabValue === 2 && <QueryService />}
    </Box>
  );
}

export default IndexPage;
