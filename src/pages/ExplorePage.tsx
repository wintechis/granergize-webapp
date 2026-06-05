import { useEffect, useMemo, useRef, useState } from "react";
import { BuildingType, EnergyType } from "../../types/types.ts";
import Building from "./Building.tsx";
import Agent from "./Agent.tsx";
import { RefLink, UriLink } from "../components/detail/DetailView.tsx";
import VisibleEnergyMix from "../components/VisibleEnergyMix.tsx";
import {
  MapContainer,
  Marker,
  Tooltip,
  useMap,
  useMapEvents,
  WMSTileLayer,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import Grid from "@mui/material/Grid2";
import Energy from "./Energy.tsx";
import IconButton from "@mui/material/IconButton";
import { useSolidData } from "../hooks/queries.ts";
import WeatherData from "./WeatherData.tsx";
import InvestorEnergy from "./InvestorEnergy.tsx";
import BspEnergy from "./BspEnergy.tsx";
import { Session } from "@inrupt/solid-client-authn-browser";
import CorporateFareIcon from "@mui/icons-material/CorporateFare";
import OpenInFullIcon from "@mui/icons-material/OpenInFull";
import CloseFullscreenIcon from "@mui/icons-material/CloseFullscreen";
import {
  MARKER_OWNED_COLOR,
  MARKER_SELECTED_COLOR,
  MARKER_SHARED_COLOR,
} from "../constants/chartColors.ts";
import {
  beginActivity,
  endActivity,
} from "../services/utils/networkActivity.ts";
import { isSeriesGranularity } from "../services/utils/durationUtils.ts";

const SHADOW =
  "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png";

// Basemap: the official German basemap.de Web Raster (BKG) via its WMS endpoint
// (CRS EPSG:3857, Leaflet's default). The "farbe" (colour) layer; switch to
// "de_basemapde_web_raster_grau" for the muted grey variant. NOTE: basemap.de
// covers Germany only — buildings outside Germany render on a blank background.
// (Previously CartoDB Positron / OpenStreetMap XYZ tiles via <TileLayer>.)
const BASEMAP_DE = {
  url: "https://sgx.geodatenzentrum.de/wms_basemapde",
  layers: "de_basemapde_web_raster_farbe",
  attribution:
    '&copy; <a href="https://basemap.de/">basemap.de</a> / &copy; <a href="https://www.bkg.bund.de/">BKG</a>',
} as const;

function makeIcon(url: string): L.Icon {
  return new L.Icon({
    iconUrl: url,
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    shadowUrl: SHADOW,
    shadowSize: [41, 41],
  });
}

// One marker style; the only distinction is visibility (owned vs shared with you),
// not the data's provenance.
const BASE = import.meta.env.BASE_URL;
const OWNED_ICON = makeIcon(`${BASE}marker-dummy.png`);
const SHARED_ICON = makeIcon(`${BASE}marker-dummy-shared.png`);

function getIcon(building: BuildingType): L.Icon {
  return building.isShared ? SHARED_ICON : OWNED_ICON;
}

function createSelectedIcon(building: BuildingType): L.DivIcon {
  const imgUrl = getIcon(building).options.iconUrl as string;
  return L.divIcon({
    className: "",
    html:
      `<img src="${imgUrl}" alt="Selected building" style="width:25px;height:41px;filter:drop-shadow(0 0 3px ${MARKER_SELECTED_COLOR}) drop-shadow(0 0 5px ${MARKER_SELECTED_COLOR});" />`,
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
  });
}

/**
 * Leaflet miscalculates its size when its container was hidden (display:none).
 * When this map's tab becomes active again, recompute the size once it's visible.
 */
function InvalidateOnActive({ active }: { active: boolean }) {
  const map = useMap();
  useEffect(() => {
    if (active) {
      setTimeout(() => map.invalidateSize(), 0);
    }
  }, [active, map]);
  return null;
}

/**
 * Frame the map on the located buildings — once. Runs the first time the tab is
 * active and at least one building has coordinates; afterwards the user's
 * panning/zooming sticks (we never re-fit). Does nothing when no building has
 * coordinates, leaving the current view untouched.
 */
function FitToBuildings(
  { active, buildings }: { active: boolean; buildings: BuildingType[] },
) {
  const map = useMap();
  const done = useRef(false);
  useEffect(() => {
    if (done.current || !active) return;
    const pts = buildings
      .filter((b) => b.lat != null && b.long != null)
      .map((b) => [b.lat as number, b.long as number] as [number, number]);
    if (pts.length === 0) return;
    done.current = true;
    // Defer so it runs after invalidateSize() has corrected the container size.
    setTimeout(() => map.fitBounds(L.latLngBounds(pts), { padding: [40, 40] }), 0);
  }, [active, buildings, map]);
  return null;
}

/**
 * Reports the map's current bounding box to the parent whenever the user pans
 * or zooms (and once the map becomes visible, since invalidateSize changes the
 * visible bounds without firing a move event).
 */
function BoundsWatcher(
  { active, onChange }: {
    active: boolean;
    onChange: (bounds: L.LatLngBounds) => void;
  },
) {
  const map = useMapEvents({
    moveend: () => onChange(map.getBounds()),
    zoomend: () => onChange(map.getBounds()),
  });
  useEffect(() => {
    if (active) {
      const t = setTimeout(() => onChange(map.getBounds()), 50);
      return () => clearTimeout(t);
    }
  }, [active, map, onChange]);
  return null;
}

interface ExplorePageProps {
  session: Session;
  /** Whether the Home tab is currently visible (the map stays mounted while hidden). */
  active?: boolean;
}

/**
 * One entry in the right-pane focus trail. The pane always shows the last
 * entry; "back" pops it. Selecting a marker resets the trail to that building.
 */
type FocusTarget =
  | { kind: "building"; id: string }
  | { kind: "agent"; id: string };

export default function ExplorePage(
  { session, active = true }: ExplorePageProps,
) {
  const { buildings, agents, energyNeed, error } = useSolidData();
  // One activity token per tile-loading burst (the layer fires `loading` when it
  // starts fetching tiles and `load` once the visible set is in), so panning/
  // zooming registers in the global indicator without a token per image.
  const tileToken = useRef<number | null>(null);
  // The right-pane navigation stack. The last entry is what's shown; earlier
  // entries are the "back" history. Empty = nothing focused.
  const [trail, setTrail] = useState<FocusTarget[]>([]);
  // The map's current bounding box; the energy mix below the map is computed
  // over the buildings that fall inside it. The two pieces of map view state
  // are this bbox and the selected building (the anchor of `trail`).
  const [bbox, setBbox] = useState<L.LatLngBounds | null>(null);
  const [selectedEnergy, setSelectedEnergy] = useState<EnergyType | null>(null);
  // false = balanced 50/50 split with the map; true = the detail pane fills the
  // tab body and the map pane is hidden (kept mounted, see InvalidateOnActive).
  const [detailFull, setDetailFull] = useState(false);
  // Which detail tab is shown for the selected building: 0=building, 1=energy,
  // 2=weather.
  const [detailTab, setDetailTab] = useState(0);

  // Buildings currently visible in the map's bounding box (before the first
  // bounds report, treat every located building as visible).
  const visibleBuildings = useMemo(
    () =>
      buildings.filter((b) =>
        b.lat != null && b.long != null &&
        (!bbox || bbox.contains([b.lat, b.long]))
      ),
    [buildings, bbox],
  );

  const current = trail[trail.length - 1] ?? null;
  const findBuilding = (id: string) =>
    buildings.find((b) => b.id.toString() === id) ?? null;
  // The building the view is anchored on (the marker that started the trail);
  // stays highlighted on the map even while drilling into a related object.
  const anchorTarget = trail.find((t) => t.kind === "building") ?? null;
  const anchorBuilding = anchorTarget ? findBuilding(anchorTarget.id) : null;
  // Resolved object for the entry currently shown (re-resolved each render, so
  // it survives data reloads and disappears if the object is removed).
  const currentBuilding = current?.kind === "building"
    ? findBuilding(current.id)
    : null;
  const currentAgent = current?.kind === "agent"
    ? agents.find((a) => a.id.toString() === current.id) ?? null
    : null;

  const focusBuilding = (id: string) => setTrail([{ kind: "building", id }]);
  const pushFocus = (target: FocusTarget) => setTrail((t) => [...t, target]);
  const goBack = () => setTrail((t) => t.slice(0, -1));

  // Reset to the Building-data tab whenever a different building is shown.
  useEffect(() => {
    setDetailTab(0);
  }, [currentBuilding?.id]);

  // Keep the energy data in sync with the building currently in view.
  useEffect(() => {
    if (currentBuilding && energyNeed) {
      setSelectedEnergy(
        energyNeed.find((e) => e.id === currentBuilding.id) || null,
      );
    } else {
      setSelectedEnergy(null);
    }
  }, [currentBuilding, energyNeed]);

  const togglePaneSize = () => {
    setDetailFull((v) => !v);
  };

  return (
    <Box
      sx={{
        p: 3,
        height: "100%",
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
      }}
    >
      {error && (
        <Typography color="error" sx={{ mb: 2 }}>
          Error: {error}
        </Typography>
      )}

      {/* Wide screens: two panes fill the height side-by-side, each scrolling on
          its own. Narrow screens: the panes stack and the whole tab scrolls once. */}
      <Grid
        container
        spacing={2}
        sx={{ flexGrow: 1, minHeight: 0, overflow: { xs: "auto", md: "visible" } }}
      >
        <Grid
          size={{ xs: 12, md: 6 }}
          sx={{
            // Full-screen detail hides the map pane — but keep it mounted (display
            // none, not unmounted) so the Leaflet instance survives; InvalidateOnActive
            // recomputes its size when it reappears.
            display: detailFull ? "none" : "flex",
            height: { xs: "auto", md: "100%" },
            minHeight: { xs: "22.5rem", md: 0 },
            overflow: { xs: "visible", md: "auto" },
            position: "relative",
            flexDirection: "column",
          }}
        >
          <MapContainer
            className="map-container"
                center={[50.976558, 10.404674]}
                zoom={6.5}
                zoomSnap={0.5}
                style={{ flex: 1, minHeight: 0 }}
              >
                <WMSTileLayer
                  url={BASEMAP_DE.url}
                  layers={BASEMAP_DE.layers}
                  format="image/png"
                  transparent={false}
                  attribution={BASEMAP_DE.attribution}
                  eventHandlers={{
                    loading: () => {
                      if (tileToken.current === null) {
                        tileToken.current = beginActivity("map tiles");
                      }
                    },
                    load: () => {
                      if (tileToken.current !== null) {
                        endActivity(tileToken.current);
                        tileToken.current = null;
                      }
                    },
                  }}
                />
                <InvalidateOnActive active={active && !detailFull} />
                <FitToBuildings active={active} buildings={buildings} />
                <BoundsWatcher active={active} onChange={setBbox} />
                {buildings.map((building) => (
                  building.lat && building.long && (
                    <Marker
                      key={building.id}
                      position={[building.lat, building.long]}
                      icon={anchorBuilding?.id === building.id
                        ? createSelectedIcon(building)
                        : getIcon(building)}
                      eventHandlers={{
                        click: () => {
                          focusBuilding(building.id.toString());
                        },
                      }}
                    >
                      <Tooltip direction="top" offset={[0, -38]}>
                        <Box sx={{ display: "flex", gap: 1 }}>
                          <CorporateFareIcon fontSize="small" />
                          <span>
                            <strong>Building {building.id}</strong>
                            {building.streetAddress && (
                              <>
                                <br />
                                {building.streetAddress}
                              </>
                            )}
                            <br />
                            {`${building.postalCode ?? ""} ${
                              building.locality ?? ""
                            }${building.region ? `, ${building.region}` : ""}`}
                          </span>
                        </Box>
                      </Tooltip>
                    </Marker>
                  )
                ))}
          </MapContainer>
          {/* Map legend — a single compact row of swatches. */}
          <Paper
            variant="outlined"
            sx={{
              mt: 2,
              px: 1.5,
              py: 0.75,
              display: "flex",
              flexWrap: "wrap",
              gap: 1.5,
              alignItems: "center",
            }}
          >
            {(
              [
                [MARKER_OWNED_COLOR, "My Buildings"],
                [MARKER_SHARED_COLOR, "Shared with Me"],
              ] as const
            ).map(([color, label]) => (
              <Box key={label} sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
                <Box
                  sx={{
                    width: 10,
                    height: 10,
                    backgroundColor: color,
                    borderRadius: "50%",
                    flexShrink: 0,
                  }}
                />
                <Typography variant="body2">{label}</Typography>
              </Box>
            ))}
            {(
              [
                ["investor", `${BASE}legend-investor.png`, "Investor"],
                ["dummy", `${BASE}legend-dummy.png`, "Demo"],
                ["user", `${BASE}legend-user.png`, "User"],
                ["benchmark_service_provider", `${BASE}legend-bsp.png`, "BSP"],
              ] as const
            ).map(([role, src, label]) => (
              <Box key={role} sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
                <Box
                  component="img"
                  src={src}
                  alt={`${label} marker`}
                  sx={{ width: 9, height: 14, objectFit: "contain", flexShrink: 0 }}
                />
                <Typography variant="body2">{label}</Typography>
              </Box>
            ))}
          </Paper>
          <VisibleEnergyMix
            buildings={visibleBuildings}
            energyNeed={energyNeed}
          />
        </Grid>
        <Grid
          size={{ xs: 12, md: detailFull ? 12 : 6 }}
          sx={{
            height: { xs: "auto", md: "100%" },
            overflow: { xs: "visible", md: "auto" },
          }}
        >
          {!current
            ? (
              <Typography variant="body1">
                Select a marker to show details
              </Typography>
            )
            : (
              <Stack spacing={2}>
                {trail.length > 1 && (
                  <Box>
                    <RefLink onClick={goBack}>← Back</RefLink>
                  </Box>
                )}

                {currentAgent && (
                  <Agent agentId={currentAgent.id.toString()} embedded />
                )}

                {currentBuilding && (
                  <>
                    {/* Persistent building identity — the building stays the
                        focus while the tabs below switch its detail views. */}
                    <Box
                      sx={{
                        display: "flex",
                        gap: 1.5,
                        alignItems: "flex-start",
                        mb: 1,
                      }}
                    >
                      <CorporateFareIcon color="action" />
                      <Box sx={{ flexGrow: 1 }}>
                        <Typography variant="h6">
                          Building {currentBuilding.id}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          {currentBuilding.streetAddress}
                          <br />
                          {`${currentBuilding.postalCode ?? ""} ${
                            currentBuilding.locality ?? ""
                          }${
                            currentBuilding.region
                              ? `, ${currentBuilding.region}`
                              : ""
                          }`}
                        </Typography>
                        <Typography
                          variant="body1"
                          sx={{ mt: 0.5, wordBreak: "break-all" }}
                        >
                          <UriLink href={currentBuilding.uri}>
                            {currentBuilding.uri}
                          </UriLink>
                        </Typography>
                      </Box>
                      <IconButton
                        size="small"
                        onClick={togglePaneSize}
                        aria-label={detailFull
                          ? "Show map"
                          : "Fill screen with details"}
                        title={detailFull
                          ? "Show map"
                          : "Fill screen with details"}
                      >
                        {detailFull
                          ? <CloseFullscreenIcon fontSize="small" />
                          : <OpenInFullIcon fontSize="small" />}
                      </IconButton>
                    </Box>

                    <Tabs
                      value={detailTab}
                      onChange={(_e, v) => setDetailTab(v)}
                      variant="fullWidth"
                    >
                      <Tab label="Building data" />
                      <Tab label="Energy data" />
                      <Tab label="Weather data" />
                    </Tabs>

                    {detailTab === 0 && (
                      <Building
                        building={currentBuilding}
                        onHide={() => setTrail([])}
                        onNavigateAgent={(id) =>
                          pushFocus({ kind: "agent", id })}
                        embedded
                        hideHeader
                      />
                    )}

                    {detailTab === 1 && (
                      // Dispatch on the data the building actually carries, not its
                      // provenance role: annual aggregates → an annual chart (the BSP
                      // variant when bench-specific company/logistics fields are
                      // present, else the investor variant); otherwise the
                      // time-series / categorical Energy view.
                      (currentBuilding.energyDatasets?.some((d) =>
                          !isSeriesGranularity(d.granularity)
                        ))
                        ? (currentBuilding.companyName ||
                            currentBuilding.logisticsFunction)
                          ? (
                            <BspEnergy
                              building={currentBuilding}
                              session={session}
                            />
                          )
                          : (
                            <InvestorEnergy
                              building={currentBuilding}
                              session={session}
                            />
                          )
                        : (selectedEnergy ||
                            currentBuilding.energyDatasets?.some((d) =>
                              isSeriesGranularity(d.granularity)
                            ))
                        ? (
                          <Energy
                            selectedBuilding={currentBuilding.id.toString()}
                            operatedBy={currentBuilding.operatedBy?.toString() ||
                              ""}
                            building={currentBuilding}
                            session={session}
                          />
                        )
                        : (
                          <Typography variant="body2">
                            No energy data for this building.
                          </Typography>
                        )
                    )}

                    {detailTab === 2 && (
                      <WeatherData building={currentBuilding} />
                    )}
                  </>
                )}
              </Stack>
            )}
        </Grid>
      </Grid>
    </Box>
  );
}
