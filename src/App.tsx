import { type ReactNode, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { HashRouter, Route, Routes } from "react-router-dom";
import { openRoom } from "./services/interop/dataRoom.ts";
import { resolveStorageRoot } from "./services/utils/solidUtils.ts";
import Index from "./pages/index.tsx";
import Building from "./pages/Building.tsx";
import Agent from "./pages/Agent.tsx";
import Energy from "./pages/Energy.tsx";
import AggregatedView from "./pages/AggregatedView.tsx";
import GuidePage from "./components/GuidePage.tsx";
import "./App.css";
import CircularProgress from "@mui/material/CircularProgress";
import Box from "@mui/material/Box";
import Container from "@mui/material/Container";
import Typography from "@mui/material/Typography";

// Create wrapper components to handle URL params
import { Session } from "@inrupt/solid-client-authn-browser";
import type { BuildingType } from "../types/types.ts";
import { useSolidData } from "./hooks/queries.ts";

function useBuildingParam(): {
  building: BuildingType | null;
  selectedBuilding: string;
  isLoading: boolean;
  error: string | null;
} {
  const { selectedBuilding = "" } = useParams();
  const { buildings, isLoading, error } = useSolidData();
  const building =
    buildings.find((b) => b.id.toString() === selectedBuilding) ?? null;
  return { building, selectedBuilding, isLoading, error };
}

/** A centered, full-viewport loading spinner (standalone routes / pre-shell). */
function FullPageSpinner() {
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

/**
 * Resolve the `:selectedBuilding` route param against loaded data and render the
 * loading / error / not-found states once, then hand the building to `children`.
 * Shared by the building and energy routes so those three states live in one place.
 */
function BuildingRouteGuard(
  { children }: {
    children: (building: BuildingType, selectedBuilding: string) => ReactNode;
  },
) {
  const { building, selectedBuilding, isLoading, error } = useBuildingParam();

  if (isLoading) return <FullPageSpinner />;
  if (error) {
    return <Typography color="error">Error loading data: {error}</Typography>;
  }
  if (!building) {
    return (
      <Typography>
        Building not found or you don't have access to view this building.
      </Typography>
    );
  }
  return <>{children(building, selectedBuilding)}</>;
}

function BuildingWrapper({ session }: { session: Session }) {
  const navigate = useNavigate();
  return (
    <BuildingRouteGuard>
      {(building) => (
        <Container maxWidth="md" sx={{ py: 3 }}>
          <Building
            building={building}
            session={session}
            onHide={() => navigate(-1)}
          />
        </Container>
      )}
    </BuildingRouteGuard>
  );
}

function EnergyWrapper({ session }: { session: Session }) {
  return (
    <BuildingRouteGuard>
      {(building, selectedBuilding) => (
        <Energy
          selectedBuilding={selectedBuilding}
          operatedBy={building.operatedBy?.toString() || ""}
          building={building}
          session={session}
        />
      )}
    </BuildingRouteGuard>
  );
}

function AggregatedViewWrapper({ session }: { session: Session }) {
  return <AggregatedView session={session} />;
}

/**
 * Deep link `#/room/:roomUri` — opens (and joins) the linked room, then lands the
 * user on the Connect tab. This is what the room QR code / invite link points at.
 */
function RoomDeepLink({ session }: { session: Session }) {
  const { roomUri = "" } = useParams();
  const navigate = useNavigate();

  useEffect(() => {
    let active = true;
    (async () => {
      if (roomUri) {
        await openRoom(roomUri, session).catch(() => {});
      }
      if (active) navigate("/", { replace: true, state: { openRoom: true } });
    })();
    return () => {
      active = false;
    };
  }, [roomUri, session, navigate]);

  return <FullPageSpinner />;
}

interface AppProps {
  onLogout: (opts?: { suppressAutoLogin?: boolean }) => void;
  session: Session;
}

function App({ onLogout, session }: AppProps) {
  // Resolve the Pod storage root (pim:storage) once, before rendering anything
  // that builds Pod paths. Many components call the synchronous `getStorageRoot`
  // (data rooms, dialogs, registries), which throws until this has run — so the
  // whole authenticated app waits on it here.
  const [rootReady, setRootReady] = useState(false);
  const [rootError, setRootError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    resolveStorageRoot(session)
      .then(() => active && setRootReady(true))
      .catch((e) =>
        active && setRootError(e instanceof Error ? e.message : String(e))
      );
    return () => {
      active = false;
    };
  }, [session]);

  if (rootError) {
    return (
      <Box sx={{ p: 4 }}>
        <Typography color="error">
          Could not locate your Pod storage: {rootError}
        </Typography>
      </Box>
    );
  }
  if (!rootReady) {
    return <FullPageSpinner />;
  }

  return (
    <HashRouter>
        <Routes>
          <Route
            path="/"
            element={<Index onLogout={onLogout} session={session} />}
          />
          <Route
            path="/building/:selectedBuilding"
            element={<BuildingWrapper session={session} />}
          />
          <Route path="/agent/:selectedAgent" element={<Agent />} />
          <Route
            path="/energy/:selectedBuilding"
            element={<EnergyWrapper session={session} />}
          />
          <Route
            path="/view/:viewId"
            element={<AggregatedViewWrapper session={session} />}
          />
          <Route
            path="/room/:roomUri"
            element={<RoomDeepLink session={session} />}
          />
          <Route path="/guide" element={<GuidePage />} />
        </Routes>
    </HashRouter>
  );
}

export default App;
