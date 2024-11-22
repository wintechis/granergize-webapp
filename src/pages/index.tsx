import { useState } from "react";
import Map from "./Map.tsx";
import EnergyMix from "./EnergyMix.tsx";
import QueryService from "./QueryService.tsx";
import Box from '@mui/material/Box';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';

function IndexPage() {
  const [tabValue, setTabValue] = useState(0);

  const handleTabChange = (event: React.SyntheticEvent, newValue: number) => {
    setTabValue(newValue);
  };

  return (
    <Box sx={{ height: 'calc(100vh - 50px)' }}>
      <Tabs value={tabValue} onChange={handleTabChange} centered>
        <Tab label="Home" />
        <Tab label="Energy Mix" />
        <Tab label="Query Service" />
      </Tabs>
      {tabValue === 0 && (
        <Map />
      )}
      {tabValue === 1 && (
        <EnergyMix />
      )}
      {tabValue === 2 && (
        <QueryService />
      )}
    </Box>
  );
}

export default IndexPage;