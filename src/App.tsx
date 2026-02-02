import { useParams } from "react-router-dom";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import Index from "./pages/index.tsx";
import Building from "./pages/Building.tsx";
import Agent from "./pages/Agent.tsx";
import Energy from "./pages/Energy.tsx";
import AggregatedView from "./pages/AggregatedView.tsx";
import Container from "@mui/material/Container";
import "./App.css";
import { useSolidData } from "./context/SolidDataContext.tsx";
import CircularProgress from "@mui/material/CircularProgress";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";

// Create wrapper components to handle URL params
import { Session } from "@inrupt/solid-client-authn-browser";

function BuildingWrapper({ session }: { session: Session }) {
  const { selectedBuilding } = useParams();
  const { buildings, isLoading, error } = useSolidData();

  if (isLoading) {
    return (
      <Box
        display="flex"
        justifyContent="center"
        alignItems="center"
        height="100vh"
      >
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Typography color="error">
        Error loading data: {error}
      </Typography>
    );
  }

  const building = buildings.find((b) => b.id.toString() === selectedBuilding);

  if (!building) {
    return (
      <Typography>
        Building not found or you don't have access to view this building.
      </Typography>
    );
  }

  return <Building building={building} session={session} onHide={() => {}} />;
}

function EnergyWrapper() {
  const { selectedBuilding } = useParams();
  const { buildings, isLoading, error } = useSolidData();

  if (isLoading) {
    return (
      <Box
        display="flex"
        justifyContent="center"
        alignItems="center"
        height="100vh"
      >
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Typography color="error">
        Error loading data: {error}
      </Typography>
    );
  }

  const building = buildings.find((b) => b.id.toString() === selectedBuilding);

  if (!building) {
    return (
      <Typography>
        Building not found or you don't have access to view this building.
      </Typography>
    );
  }

  return (
    <Energy
      selectedBuilding={selectedBuilding || ""}
      operatedBy={building.operatedBy?.toString() || ""}
    />
  );
}

function AggregatedViewWrapper({ session }: { session: Session }) {
  return <AggregatedView session={session} />;
}

interface AppProps {
  onLogout: () => void;
  session: Session;
}

function App({ onLogout, session }: AppProps) {
  return (
    <Container maxWidth={false}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Index onLogout={onLogout} session={session} />} />
          <Route
            path="/building/:selectedBuilding"
            element={<BuildingWrapper session={session} />}
          />
          <Route path="/agent/:selectedAgent" element={<Agent />} />
          <Route path="/energy/:selectedBuilding" element={<EnergyWrapper />} />
          <Route path="/view/:viewId" element={<AggregatedViewWrapper session={session} />} />
        </Routes>
      </BrowserRouter>
    </Container>
  );
}

export default App;
