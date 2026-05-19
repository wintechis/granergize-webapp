import { useEffect, useRef, useState } from "react";
import { BuildingType, EnergyType } from "../../types/types.ts";
import Building from "./Building.tsx";
import { MapContainer, Marker, TileLayer } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";
import Grid from "@mui/material/Grid2";
import Energy from "./Energy.tsx";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import { useSolidData } from "../context/SolidDataContext.tsx";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import WeatherData from "./WeatherData.tsx";
import InvestorEnergy from "./InvestorEnergy.tsx";
import BspEnergy from "./BspEnergy.tsx";
import { Session } from "@inrupt/solid-client-authn-browser";
import AddIcon from "@mui/icons-material/Add";
import AddBuildingDialog from "../components/AddBuildingDialog.tsx";
import {
  MARKER_OWNED_COLOR,
  MARKER_SELECTED_COLOR,
  MARKER_SHARED_COLOR,
} from "../constants/chartColors.ts";

const SHADOW =
  "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png";

const BOUNCE_KEYFRAMES = `
@keyframes markerBounce {
  0%   { transform: translateY(-60px); opacity: 0; }
  50%  { transform: translateY(0);     opacity: 1; }
  65%  { transform: translateY(-14px); }
  80%  { transform: translateY(0); }
  90%  { transform: translateY(-6px); }
  100% { transform: translateY(0); }
}
`;

let bounceStyleInjected = false;
function ensureBounceStyle() {
  if (bounceStyleInjected) return;
  const style = document.createElement("style");
  style.textContent = BOUNCE_KEYFRAMES;
  document.head.appendChild(style);
  bounceStyleInjected = true;
}

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

const BASE = import.meta.env.BASE_URL;
const ROLE_ICONS: Record<string, { base: L.Icon; shared: L.Icon }> = {
  investor: {
    base: makeIcon(`${BASE}marker-investor.png`),
    shared: makeIcon(`${BASE}marker-investor.png`),
  },
  dummy: {
    base: makeIcon(`${BASE}marker-dummy.png`),
    shared: makeIcon(`${BASE}marker-dummy-shared.png`),
  },
  user: {
    base: makeIcon(`${BASE}marker-user.png`),
    shared: makeIcon(`${BASE}marker-user-shared.png`),
  },
  benchmark_service_provider: {
    base: makeIcon(`${BASE}marker-bsp.png`),
    shared: makeIcon(`${BASE}marker-bsp-shared.png`),
  },
};

function getIcon(building: BuildingType): L.Icon {
  const set = ROLE_ICONS[building.sourceRole ?? "dummy"] ?? ROLE_ICONS.dummy;
  return building.isShared ? set.shared : set.base;
}

function createBounceIcon(building: BuildingType): L.DivIcon {
  ensureBounceStyle();
  const imgUrl = getIcon(building).options.iconUrl as string;
  return L.divIcon({
    className: "",
    html: `<img src="${imgUrl}" style="width:25px;height:41px;animation:markerBounce 0.8s ease-out forwards;" />`,
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
  });
}

function createSelectedIcon(building: BuildingType): L.DivIcon {
  const imgUrl = getIcon(building).options.iconUrl as string;
  return L.divIcon({
    className: "",
    html:
      `<img src="${imgUrl}" style="width:25px;height:41px;filter:drop-shadow(0 0 3px ${MARKER_SELECTED_COLOR}) drop-shadow(0 0 5px ${MARKER_SELECTED_COLOR});" />`,
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
  });
}

interface MapProps {
  session: Session;
}

export default function Map({ session }: MapProps) {
  const { buildings, energyNeed, isLoading, error, reloadData } = useSolidData();
  const [selectedBuilding, setSelectedBuilding] = useState<BuildingType | null>(
    null,
  );
  const [selectedEnergy, setSelectedEnergy] = useState<EnergyType | null>(null);
  const [isRightPaneLarge, setIsRightPaneLarge] = useState(false);
  const [activeTab, setActiveTab] = useState(0);
  const [addBuildingOpen, setAddBuildingOpen] = useState(false);
  const [newBuildingUris, setNewBuildingUris] = useState<Set<string>>(new Set());
  const bounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep selectedBuilding in sync with context: update on reload, clear on removal
  useEffect(() => {
    if (!selectedBuilding) return;
    const updated = buildings.find((b) => b.id === selectedBuilding.id);
    if (updated !== selectedBuilding) {
      setSelectedBuilding(updated ?? null);
    }
  }, [buildings, selectedBuilding]);

  // When a building is selected, find its energy data
  useEffect(() => {
    if (selectedBuilding && energyNeed) {
      const buildingEnergy = energyNeed.find((e) =>
        e.id === selectedBuilding.id
      );
      setSelectedEnergy(buildingEnergy || null);
    } else {
      setSelectedEnergy(null);
    }
  }, [selectedBuilding, energyNeed]);

  const togglePaneSize = () => {
    setIsRightPaneLarge(!isRightPaneLarge);
  };

  const handleTabChange = (_event: React.SyntheticEvent, newValue: number) => {
    setActiveTab(newValue);
  };

  return (
    <Box>
      <Box sx={{ display: "flex", justifyContent: "flex-end", gap: 1, padding: 1 }}>
        <Button
          variant="outlined"
          startIcon={<AddIcon />}
          size="small"
          onClick={() => setAddBuildingOpen(true)}
        >
          Add Building
        </Button>
        <Button variant="contained" onClick={togglePaneSize}>
          {isRightPaneLarge ? "Shrink Details" : "Enlarge Details"}
        </Button>
      </Box>

      {error && (
        <Typography color="error" sx={{ mb: 2 }}>
          Error: {error}
        </Typography>
      )}

      <Grid container spacing={2} sx={{ height: "calc(100vh - 160px)" }}>
        <Grid
          size={isRightPaneLarge ? 3 : 8}
          sx={{ height: "100%", overflow: "auto" }}
        >
          {isLoading
            ? (
              <Box
                display="flex"
                justifyContent="center"
                alignItems="center"
                height="100%"
              >
                <CircularProgress />
              </Box>
            )
            : (
              <MapContainer
                className="map-container"
                center={[50.976558, 10.404674]}
                zoom={6.5}
                zoomSnap={0.5}
                style={{ height: "100%" }}
              >
                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                {/* Map Legend */}
                <Box
                  sx={{
                    position: "absolute",
                    bottom: 20,
                    left: 10,
                    backgroundColor: "white",
                    padding: 2,
                    borderRadius: 1,
                    boxShadow: "0 1px 5px rgba(0,0,0,0.4)",
                    zIndex: 1000,
                  }}
                >
                  <Typography
                    variant="subtitle2"
                    sx={{ fontWeight: "bold", mb: 1 }}
                  >
                    Legend
                  </Typography>
                  {(
                    [
                      [MARKER_OWNED_COLOR, "My Buildings"],
                      [MARKER_SHARED_COLOR, "Shared with Me"],
                    ] as const
                  ).map(([color, label]) => (
                    <Box
                      key={label}
                      sx={{ display: "flex", alignItems: "center", mb: 0.5 }}
                    >
                      <Box
                        sx={{
                          width: 12,
                          height: 12,
                          backgroundColor: color,
                          borderRadius: "50%",
                          mr: 1,
                          flexShrink: 0,
                        }}
                      />
                      <Typography variant="body2">{label}</Typography>
                    </Box>
                  ))}
                  <Box sx={{ borderTop: "1px solid #eee", mt: 0.5, pt: 0.5 }}>
                    {(
                      [
                        ["investor", `${BASE}legend-investor.png`, "Investor"],
                        ["dummy", `${BASE}legend-dummy.png`, "Demo"],
                        ["user", `${BASE}legend-user.png`, "User"],
                        [
                          "benchmark_service_provider",
                          `${BASE}legend-bsp.png`,
                          "BSP",
                        ],
                      ] as const
                    ).map(([role, src, label]) => (
                      <Box
                        key={role}
                        sx={{ display: "flex", alignItems: "center", mb: 0.5 }}
                      >
                        <Box
                          component="img"
                          src={src}
                          sx={{
                            width: 10,
                            height: 16,
                            mr: 1,
                            objectFit: "contain",
                            flexShrink: 0,
                          }}
                        />
                        <Typography variant="body2">{label}</Typography>
                      </Box>
                    ))}
                  </Box>
                </Box>
                {buildings.map((building) => (
                  building.lat && building.long && (
                    <Marker
                      key={building.id}
                      position={[building.lat, building.long]}
                      icon={selectedBuilding?.id === building.id
                        ? createSelectedIcon(building)
                        : newBuildingUris.has(building.uri as string)
                        ? createBounceIcon(building)
                        : getIcon(building)}
                      eventHandlers={{
                        click: () => {
                          setSelectedBuilding(building);
                        },
                      }}
                    >
                    </Marker>
                  )
                ))}
                {selectedBuilding && (
                  <Building
                    building={selectedBuilding}
                    session={session}
                    onHide={() => setSelectedBuilding(null)}
                  />
                )}
              </MapContainer>
            )}
        </Grid>
        <Grid
          size={isRightPaneLarge ? 9 : 4}
          sx={{ height: "100%", overflow: "auto" }}
        >
          {!selectedBuilding
            ? (
              <Typography variant="body1" sx={{ mt: 2 }}>
                Select a marker to show details
              </Typography>
            )
            : (
              <Box sx={{ width: "100%" }}>
                <Box sx={{ borderBottom: 1, borderColor: "divider" }}>
                  <Tabs
                    value={activeTab}
                    onChange={handleTabChange}
                    aria-label="building data tabs"
                  >
                    <Tab label="Energy Data" />
                    <Tab label="Weather Data" />
                  </Tabs>
                </Box>
                <Box sx={{ padding: 2 }}>
                  {activeTab === 0 &&
                    selectedBuilding.sourceRole ===
                      "benchmark_service_provider" &&
                    <BspEnergy building={selectedBuilding} />}
                  {activeTab === 0 &&
                    selectedBuilding.sourceRole === "investor" && (
                    <InvestorEnergy building={selectedBuilding} />
                  )}
                  {activeTab === 0 &&
                    selectedBuilding.sourceRole !== "investor" &&
                    selectedBuilding.sourceRole !==
                      "benchmark_service_provider" &&
                    (selectedEnergy ||
                      selectedBuilding.sourceRole === "user") &&
                    (
                      <Energy
                        selectedBuilding={selectedBuilding.id.toString()}
                        operatedBy={selectedBuilding.operatedBy?.toString() ||
                          ""}
                        building={selectedBuilding}
                        session={session}
                      />
                    )}
                  {activeTab === 1 && (
                    <WeatherData building={selectedBuilding} />
                  )}
                </Box>
              </Box>
            )}
        </Grid>
      </Grid>

      <Typography variant="body1" paragraph>
        Created by the{" "}
        <a href="https://www.ti.rw.fau.de/">
          FAU Chair of Technical Information Systems
        </a>{" "}
        in cooperation with the{" "}
        <a href="https://www.scs.fraunhofer.de/">
          Fraunhofer Department for Risk and Location Analyses
        </a>{" "}
        for the research project{" "}
        <a href="https://www.scs.fraunhofer.de/de/referenzen/granergize-graphenbasierter-datenraum-logistikimmobilien.html">
          Granergize
        </a>. Contact: <a href="mailto:thomas.wehr@fau.de">Thomas Wehr</a>
      </Typography>

      <AddBuildingDialog
        open={addBuildingOpen}
        session={session}
        onClose={() => setAddBuildingOpen(false)}
        onBuildingAdded={(uris) => {
          if (bounceTimerRef.current) clearTimeout(bounceTimerRef.current);
          reloadData();
          setNewBuildingUris(new Set(uris));
          bounceTimerRef.current = setTimeout(() => setNewBuildingUris(new Set()), 3000);
        }}
      />
    </Box>
  );
}
