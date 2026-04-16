import { useEffect, useState } from "react";
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
import { MARKER_OWNED_COLOR, MARKER_SHARED_COLOR, MARKER_SELECTED_COLOR } from "../constants/chartColors.ts";

// Define custom icons
const ownedIcon = new L.Icon({
  iconUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png",
  shadowSize: [41, 41],
});

const sharedIcon = new L.Icon({
  iconUrl:
    "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-green.png",
  shadowUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

const selectedIcon = new L.Icon({
  iconUrl:
    "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-red.png",
  shadowUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

interface MapProps {
  session: Session;
}

export default function Map({ session }: MapProps) {
  const { buildings, energyNeed, isLoading, error, role } = useSolidData();
  const [selectedBuilding, setSelectedBuilding] = useState<BuildingType | null>(
    null,
  );
  const [selectedEnergy, setSelectedEnergy] = useState<EnergyType | null>(null);
  const [isRightPaneLarge, setIsRightPaneLarge] = useState(false);
  const [activeTab, setActiveTab] = useState(0);

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
      <Box sx={{ display: "flex", justifyContent: "flex-end", padding: 1 }}>
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
                  <Typography variant="subtitle2" sx={{ fontWeight: "bold", mb: 1 }}>
                    Legend
                  </Typography>
                  <Box sx={{ display: "flex", alignItems: "center", mb: 0.5 }}>
                    <Box
                      sx={{
                        width: 12,
                        height: 12,
                        backgroundColor: MARKER_OWNED_COLOR,
                        borderRadius: "50%",
                        mr: 1,
                      }}
                    />
                    <Typography variant="body2">My Buildings</Typography>
                  </Box>
                  <Box sx={{ display: "flex", alignItems: "center", mb: 0.5 }}>
                    <Box
                      sx={{
                        width: 12,
                        height: 12,
                        backgroundColor: MARKER_SHARED_COLOR,
                        borderRadius: "50%",
                        mr: 1,
                      }}
                    />
                    <Typography variant="body2">Shared with Me</Typography>
                  </Box>
                  <Box sx={{ display: "flex", alignItems: "center" }}>
                    <Box
                      sx={{
                        width: 12,
                        height: 12,
                        backgroundColor: MARKER_SELECTED_COLOR,
                        borderRadius: "50%",
                        mr: 1,
                      }}
                    />
                    <Typography variant="body2">Selected</Typography>
                  </Box>
                </Box>
                {buildings.map((building) => (
                  building.lat && building.long && (
                    <Marker
                      key={building.id}
                      position={[building.lat, building.long]}
                      icon={selectedBuilding &&
                          selectedBuilding.id === building.id
                        ? selectedIcon
                        : (building.isShared ? sharedIcon : ownedIcon)}
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
                  {activeTab === 0 && role === "benchmark_service_provider" && (
                    <BspEnergy building={selectedBuilding} />
                  )}
                  {activeTab === 0 && role === "investor" && (
                    <InvestorEnergy building={selectedBuilding} />
                  )}
                  {activeTab === 0 && role !== "investor" && role !== "benchmark_service_provider" && (selectedEnergy || role === "user") && (
                    <Energy
                      selectedBuilding={selectedBuilding.id.toString()}
                      operatedBy={selectedBuilding.operatedBy?.toString() || ""}
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
        for the research project <a href="https://www.scs.fraunhofer.de/de/referenzen/granergize-graphenbasierter-datenraum-logistikimmobilien.html">Granergize</a>. Contact:{" "}
        <a href="mailto:thomas.wehr@fau.de">Thomas Wehr</a>
      </Typography>
    </Box>
  );
}
