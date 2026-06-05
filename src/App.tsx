import { type ReactNode, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { HashRouter, Route, Routes } from "react-router-dom";
import { openRoom } from "./services/interop/dataRoom.ts";
import {
  getStorageRoot,
  resolveStorageRoot,
} from "./services/utils/solidUtils.ts";
import Index from "./pages/index.tsx";
import Building from "./pages/Building.tsx";
import Agent from "./pages/Agent.tsx";
import Energy from "./pages/Energy.tsx";
import AggregatedView from "./pages/AggregatedView.tsx";
import GuidePage from "./components/GuidePage.tsx";
import ActivityScreen from "./components/ActivityScreen.tsx";
import "./App.css";
import CircularProgress from "@mui/material/CircularProgress";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
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

function BuildingWrapper() {
  const navigate = useNavigate();
  return (
    <BuildingRouteGuard>
      {(building) => (
        <Container maxWidth="md" sx={{ py: 3 }}>
          <Building
            building={building}
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
  onLogout: (
    opts?: { suppressAutoLogin?: boolean; logoutType?: "app" | "idp" },
  ) => void;
  session: Session;
}

function App({ onLogout, session }: AppProps) {
  // Resolve the Pod storage root (pim:storage) once, before rendering anything
  // that builds Pod paths. Many components call the synchronous `getStorageRoot`
  // (data rooms, dialogs, registries), which throws until this has run — so the
  // whole authenticated app waits on it here.
  // Start ready if the storage root is already cached (resolved on a previous
  // mount this session) — avoids a spurious "Loading…" flash when it's known.
  const [rootReady, setRootReady] = useState(() => {
    try {
      return session.info.webId
        ? Boolean(getStorageRoot(session.info.webId))
        : false;
    } catch {
      return false;
    }
  });
  const [rootError, setRootError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    // Bound the resolution: a hung profile fetch must surface as the (escapable)
    // error screen below, not an indefinite spinner with no way back to login.
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error("Timed out locating your Pod storage")),
        15000,
      );
    });
    Promise.race([resolveStorageRoot(session), timeout])
      .then(() => active && setRootReady(true))
      .catch((e) => {
        const msg = e instanceof Error ? e.message : String(e);
        // Mirror to the console (like showNotification) so this gate failure is
        // observable in devtools and to the e2e error guard, not just on-screen.
        console.error(`[notify] Could not locate your Pod storage: ${msg}`);
        if (active) setRootError(msg);
      })
      .finally(() => clearTimeout(timer));
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [session]);

  if (rootError) {
    return (
      <Box sx={{ p: 4 }}>
        <Typography color="error" sx={{ mb: 2 }}>
          Could not locate your Pod storage: {rootError}
        </Typography>
        {
          /* This screen is otherwise a dead end (the app shell, and its logout
            menu, never mount). Offer an explicit way back to Login, suppressing
            auto-restore so we don't immediately log back into the same broken
            session. */
        }
        <Button
          variant="contained"
          onClick={() => onLogout({ suppressAutoLogin: true })}
        >
          Back to login
        </Button>
      </Box>
    );
  }
  if (!rootReady) {
    // Same plain activity screen as the login loading, so the hand-off from
    // login to the app shell reads as one continuous "Loading…" screen.
    return <ActivityScreen title="Loading…" />;
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
          element={<BuildingWrapper />}
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
