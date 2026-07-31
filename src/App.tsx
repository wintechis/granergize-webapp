import { sessionGateway } from "./services/pod/podGateway.ts";
import { msg } from "./lib/messages.ts";
import { lazy, type ReactNode, Suspense, useEffect, useState } from "react";
import {
  Navigate,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import {
  getStorageRoot,
  resolveStorageRoot,
} from "./services/pod/solidUtils.ts";
import { ALIASES, DETAIL_PATTERNS, FINDERS, HOME } from "./routes.ts";
import AppShell from "./pages/AppShell.tsx";
import OpenBuildingDetail from "./components/building/OpenBuildingDetail.tsx";
import OpenObservationDetail from "./components/building/OpenObservationDetail.tsx";
import { isOpenBuildingIri } from "./services/sources/lod2Rooftop.ts";
import { isOpenObservationIri } from "./services/sources/openObservations.ts";

// Route targets are code-split: each page is its own chunk fetched on first
// navigation, not carried in the initial bundle. `AppShell` (the shared finder
// chrome) stays eager — it mounts on the first post-login route. The <Suspense>
// boundaries in the route table render a spinner while a page chunk loads; for
// finders the boundary sits inside AppShell's <Outlet>, so the nav stays put.
// (This lazy-chunk fallback is the sanctioned exception to the single-indicator
// loading policy — see CLAUDE.md.)
const BuildingsFinder = lazy(() => import("./pages/BuildingsFinder.tsx"));
const ObservationsFinder = lazy(() => import("./pages/ObservationsFinder.tsx"));
const RoomsFinder = lazy(() => import("./pages/RoomsFinder.tsx"));
const AgentsFinder = lazy(() => import("./pages/AgentsFinder.tsx"));
const SharingFinder = lazy(() => import("./pages/SharingFinder.tsx"));
const BuildingDetail = lazy(() => import("./pages/BuildingDetail.tsx"));
const EnergyDetail = lazy(() => import("./pages/EnergyDetail.tsx"));
const AgentDetail = lazy(() => import("./pages/AgentDetail.tsx"));
const RoomDetail = lazy(() => import("./pages/RoomDetail.tsx"));
const AggregationDetail = lazy(() => import("./pages/AggregationDetail.tsx"));
const RegionalDataset = lazy(() => import("./pages/RegionalDataset.tsx"));
const DataSources = lazy(() => import("./pages/DataSources.tsx"));
const Organisation = lazy(() => import("./pages/Organisation.tsx"));
import ActivityScreen from "./components/ActivityScreen.tsx";
import "./App.css";
import CircularProgress from "@mui/material/CircularProgress";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Container from "@mui/material/Container";
import Typography from "@mui/material/Typography";

// Create wrapper components to handle URL params
import { Session } from "@inrupt/solid-client-authn-browser";
import type { Building } from "./types.ts";
import { useSolidData } from "./hooks/queries.ts";
import { logError } from "./lib/logError.ts";

/**
 * The app root for `BrowserRouter`'s `basename`, read from the R-b inline
 * `<head>` script's `window.__APP_BASE__` (see index.html — it strips a trailing
 * known-route portion off the pathname so the same build runs at any deploy
 * depth). The script always sets it to a path ENDING in "/"; react-router wants a
 * `basename` WITHOUT a trailing slash (except the bare root "/"), so strip it.
 * Falls back to "/" if the script didn't run (e.g. a non-browser test render).
 */
function appBasename(): string {
  const root = globalThis.__APP_BASE__ ?? "/";
  if (root === "/") return "/";
  return root.endsWith("/") ? root.slice(0, -1) : root;
}

function useBuildingParam(): {
  building: Building | null;
  selectedBuilding: string;
  isLoading: boolean;
  error: string | null;
} {
  // The id rides in a query param: `?ref=` (own, storage-relative) or `?uri=`
  // (foreign/shared, absolute). It comes back in the SAME form the app stores
  // building ids in, so the id-equality match below is unchanged.
  const [sp] = useSearchParams();
  const selectedBuilding = sp.get("uri") ?? sp.get("ref") ?? "";
  const { buildings, isLoading, error } = useSolidData();
  const building =
    buildings.find((b) => b.id === selectedBuilding) ?? null;
  return { building, selectedBuilding, isLoading, error };
}

/** A centered, full-viewport loading spinner (standalone routes / pre-shell). */
function FullPageSpinner() {
  return (
    <Box
      sx={{
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        height: "100vh",
      }}
    >
      <CircularProgress />
    </Box>
  );
}

/** Suspense fallback for a finder route: fills the AppShell content region
 *  (which is a flex column) so the chrome stays put while the chunk loads. */
function ContentFallback() {
  return (
    <Box
      sx={{
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        flexGrow: 1,
        minHeight: 0,
      }}
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
    children: (building: Building, selectedBuilding: string) => ReactNode;
  },
) {
  const { building, selectedBuilding, isLoading, error } = useBuildingParam();

  if (isLoading) return <FullPageSpinner />;
  if (error) {
    return (
      <Typography color="error">
        {msg("appErrorLoadingData", { error: String(error) })}
      </Typography>
    );
  }
  if (!building) {
    return <Typography>{msg("buildingNotFoundOrNoAccess")}</Typography>;
  }
  return <>{children(building, selectedBuilding)}</>;
}

function BuildingWrapper() {
  const navigate = useNavigate();
  const [sp] = useSearchParams();
  // An open (LoD2) building isn't a Pod resource (not in `useSolidData`), so the guard
  // would say "not found". Render its read-only in-app detail directly instead.
  const uri = sp.get("uri") ?? sp.get("ref") ?? "";
  if (isOpenBuildingIri(uri)) {
    return (
      <Container maxWidth="lg" sx={{ py: 3 }}>
        <OpenBuildingDetail iri={uri} />
      </Container>
    );
  }
  return (
    <BuildingRouteGuard>
      {(building) => (
        <Container maxWidth="lg" sx={{ py: 3 }}>
          <BuildingDetail
            building={building}
            onHide={() => navigate(-1)}
          />
        </Container>
      )}
    </BuildingRouteGuard>
  );
}

function EnergyWrapper() {
  const [sp] = useSearchParams();
  // An open observation is a renewable PLANT (a MaStR unit), not a Pod building — so the
  // guard would say "not found". Render its read-only in-app plant detail directly.
  const uri = sp.get("uri") ?? sp.get("ref") ?? "";
  if (isOpenObservationIri(uri)) {
    return (
      <Container maxWidth="lg" sx={{ py: 3 }}>
        <OpenObservationDetail iri={uri} />
      </Container>
    );
  }
  return (
    <BuildingRouteGuard>
      {(building) => (
        // Same md-width container as the other detail pages (building / contact /
        // room wrappers, and Aggregation's own) so the observation page doesn't
        // sprawl full-width.
        <Container maxWidth="lg" sx={{ py: 3 }}>
          <EnergyDetail building={building} />
        </Container>
      )}
    </BuildingRouteGuard>
  );
}

function AggregationWrapper({ session }: { session: Session }) {
  return <AggregationDetail session={session} />;
}

/** Render the standalone public regional-dataset page (the `open` tier of the
 *  Aggregations finder); it reads its `?table=`/`?ags=` params itself. */
function RegionalWrapper() {
  return (
    <Container maxWidth="lg" sx={{ py: 3 }}>
      <RegionalDataset />
    </Container>
  );
}

/** The standalone "Data sources & licences" credits/attribution page (reached
 *  from the profile menu). */
function DataSourcesWrapper() {
  return (
    <Container maxWidth="lg" sx={{ py: 3 }}>
      <DataSources />
    </Container>
  );
}

/** Resolve the `?uri=` WebID query param and render the agent detail view. */
function AgentWrapper() {
  const [sp] = useSearchParams();
  const webId = sp.get("uri") ?? "";
  if (!webId) {
    return <Typography>{msg("noAgentSpecified")}</Typography>;
  }
  return (
    <Container maxWidth="lg" sx={{ py: 3 }}>
      <AgentDetail webId={webId} />
    </Container>
  );
}

/**
 * Resolve the room query param and render the standalone room detail page. The
 * room page opens (joins + enters) the linked room on mount — this is what the
 * room QR code / invite link points at.
 *
 * Room ids are always stored/handled as ABSOLUTE container IRIs (they're
 * `normalizeRoomUri`-d everywhere; bookmarks hold the absolute URI; `ownsRoom`
 * tests `startsWith(storageRoot)`), so an invite link carries the room in
 * `?uri=`. `?ref=` is accepted as a fallback and passed through — `Room` /
 * `useEnterRoom` apply `extractRoomUri`/`normalizeRoomUri` to whatever arrives.
 */
function RoomWrapper() {
  const [sp] = useSearchParams();
  const roomUri = sp.get("uri") ?? sp.get("ref") ?? "";
  if (!roomUri) {
    return <Typography>{msg("noRoomSpecified")}</Typography>;
  }
  return (
    <Container maxWidth="lg" sx={{ py: 3 }}>
      <RoomDetail roomUri={roomUri} />
    </Container>
  );
}

/**
 * The `/explore` alias: the Explore surface's future canonical path, redirecting onto
 * the Observations finder that still owns it (see {@link ALIASES}). The query string
 * rides along, so a deep link keeps its cube coordinate (`?m=`/`?y=`/`?rows=`/`?in=`)
 * and its projection (`?view=`).
 */
function ExploreAlias() {
  const { search } = useLocation();
  return <Navigate to={`${FINDERS.observations}${search}`} replace />;
}

/**
 * The `/aggregations` alias: the former Aggregations finder, folded into Explore as its
 * saved-views projection (Step 2 of `plans/plan-cube-centered-ui.md`). The incoming query
 * string is MERGED rather than replaced — `?guise=`, `?q=`, `?offset=`, `?tiers=` and a
 * palette-routed `?action=create-aggregation` all ride along onto the folded surface, so
 * old bookmarks and deep links keep their state. `replace` keeps the redirect out of the
 * history (Back returns to where the user came from, not into the redirect again).
 */
function AggregationsAlias() {
  const { search } = useLocation();
  const params = new URLSearchParams(search);
  params.set("view", "aggregations");
  return <Navigate to={`${FINDERS.observations}?${params}`} replace />;
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
    } catch (err) {
      logError("read cached storage root for initial ready state", err);
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
    Promise.race([resolveStorageRoot(sessionGateway(session)), timeout])
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
          {msg("podStorageError", { error: rootError })}
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
          {msg("backToLogin")}
        </Button>
      </Box>
    );
  }
  if (!rootReady) {
    // Same plain activity screen as the login loading, so the hand-off from
    // login to the app shell reads as one continuous "Loading…" screen.
    return <ActivityScreen title={msg("loadingEllipsis")} />;
  }

  // Standalone DETAIL routes — rendered shell-less (no top-nav), as siblings of
  // the finder shell. Each is a bare path (`/building`, `/observation`, …); the
  // resource id rides in a `?ref=`/`?uri=` query param resolved by the wrappers.
  const detailRoutes: { path: string; element: ReactNode }[] = [
    { path: DETAIL_PATTERNS.building, element: <BuildingWrapper /> },
    { path: DETAIL_PATTERNS.observation, element: <EnergyWrapper /> },
    { path: DETAIL_PATTERNS.aggregation, element: <AggregationWrapper session={session} /> },
    { path: DETAIL_PATTERNS.agent, element: <AgentWrapper /> },
    { path: DETAIL_PATTERNS.room, element: <RoomWrapper /> },
    { path: DETAIL_PATTERNS.regional, element: <RegionalWrapper /> },
    { path: DETAIL_PATTERNS.dataSources, element: <DataSourcesWrapper /> },
    { path: DETAIL_PATTERNS.organisation, element: <Organisation /> },
  ];

  // The five FINDER routes share the persistent app chrome (top-nav + header):
  // they are children of one shell route whose <Outlet/> swaps the active finder
  // while the nav stays mounted. "/" redirects to the Buildings finder.
  const finderRoutes: { path: string; element: ReactNode }[] = [
    { path: FINDERS.buildings, element: <BuildingsFinder session={session} /> },
    { path: FINDERS.observations, element: <ObservationsFinder /> },
    { path: FINDERS.rooms, element: <RoomsFinder session={session} /> },
    { path: FINDERS.agents, element: <AgentsFinder session={session} /> },
    { path: FINDERS.sharing, element: <SharingFinder session={session} /> },
  ];

  return (
    <BrowserRouter basename={appBasename()}>
      <Routes>
        <Route element={<AppShell onLogout={onLogout} session={session} />}>
          <Route path={HOME} element={<Navigate to={FINDERS.buildings} replace />} />
          <Route path={ALIASES.explore} element={<ExploreAlias />} />
          <Route path={ALIASES.aggregations} element={<AggregationsAlias />} />
          {finderRoutes.map((r) => (
            <Route
              key={r.path}
              path={r.path}
              element={<Suspense fallback={<ContentFallback />}>{r.element}</Suspense>}
            />
          ))}
        </Route>
        {detailRoutes.map((r) => (
          <Route
            key={r.path}
            path={r.path}
            element={<Suspense fallback={<FullPageSpinner />}>{r.element}</Suspense>}
          />
        ))}
      </Routes>
    </BrowserRouter>
  );
}

export default App;
