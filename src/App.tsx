import { useState, useEffect } from 'react';
import Container from '@mui/material/Container';
import { BrowserRouter, Route, Routes, useParams } from "react-router-dom";
import Index from "./pages/index.tsx";
import Building from "./pages/Building.tsx";
import Agent from "./pages/Agent.tsx";
import Energy from "./pages/Energy.tsx";
import "./App.css";
import type { BuildingType } from "../types/types.ts";

// Create wrapper components to handle URL params
function BuildingWrapper() {
  const { selectedBuilding } = useParams();
  const [building, setBuilding] = useState<BuildingType | undefined>(undefined);

  useEffect(() => {
    (async () => {
      if (selectedBuilding) {
        const response = await fetch(`/api/buildings/${selectedBuilding}`);
        const buildingData = await response.json() as BuildingType;
        setBuilding(buildingData);
      }
    })();
  }, [selectedBuilding]);

  if (!building) {
    return <div>Loading...</div>;
  }

  return <Building building={building} onHide={() => {}} />;
}

function EnergyWrapper() {
  const { selectedBuilding } = useParams();
  return <Energy selectedBuilding={selectedBuilding || ""} />;
}


function App() {
  return (
    <Container maxWidth={false}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/building/:selectedBuilding" element={<BuildingWrapper />} />
          <Route path="/agent/:selectedAgent" element={<Agent />} />
          <Route path="/energy/:selectedBuilding" element={<EnergyWrapper />} />
        </Routes>
      </BrowserRouter>
    </Container>
  );
}

export default App;