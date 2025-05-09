import { useState } from "react";
import Box from '@mui/material/Box';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import Button from '@mui/material/Button';
import Map from "./Map.tsx";
import EnergyMix from "./EnergyMix.tsx";
import QueryService from "./QueryService.tsx";

interface IndexPageProps {
  onLogout: () => void;
}

function IndexPage({ onLogout }: IndexPageProps) {
  const [tabValue, setTabValue] = useState(0);

  const handleTabChange = (_event: React.SyntheticEvent, newValue: number) => {
    setTabValue(newValue);
  };

  return (
    <Box sx={{ height: 'calc(100vh - 50px)' }}>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          borderBottom: 1,
          borderColor: 'divider',
        }}
      >
        <Tabs value={tabValue} onChange={handleTabChange} centered>
          <Tab label="Home" />
          <Tab label="Energy Mix" />
          <Tab label="Query Service" />
        </Tabs>
        <Box sx={{ marginLeft: 'auto', mr: 2, display: 'flex', alignItems: 'center' }}>
          <Button onClick={onLogout}>Logout</Button>
        </Box>
      </Box>
      {tabValue === 0 && <Map />}
      {tabValue === 1 && <EnergyMix />}
      {tabValue === 2 && <QueryService />}
    </Box>
  );
}

export default IndexPage;