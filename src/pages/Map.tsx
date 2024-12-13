import { useEffect, useState } from "react";
import Building from './Building.tsx';
import { BuildingType, EnergyType } from "../../types/types.ts";
import {
  MapContainer,
  TileLayer,
  Marker
} from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import Grid2 from '@mui/material/Grid2';
import Energy from './Energy.tsx';
import Button from '@mui/material/Button';

// Define custom icons
const defaultIcon = new L.Icon({
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
  shadowSize: [41, 41]
});

const selectedIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-red.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
});

export default function Map() {
  const [buildings, setBuildings] = useState<BuildingType[]>([]);
  const [selectedBuilding, setSelectedBuilding] = useState<BuildingType | null>(null);
  const [selectedEnergy, setSelectedEnergy] = useState<EnergyType | null>(null);
  const [isRightPaneLarge, setIsRightPaneLarge] = useState(false);

  useEffect(() => {
    (async () => {
      // load all buildings
      const response = await fetch(`/api/buildings/`);
      const allBuildings = await response.json() as BuildingType[];
      setBuildings(allBuildings);
    })();
  }, []);

  useEffect(() => {
    if (selectedBuilding) {
      const fetchEnergyData = async () => {
        const response = await fetch(`/api/energy/${selectedBuilding.id}`);
        const energyData = await response.json() as EnergyType;
        setSelectedEnergy(energyData);
      };
      fetchEnergyData();
    } else {
      setSelectedEnergy(null);
    }
  }, [selectedBuilding]);

  const togglePaneSize = () => {
    setIsRightPaneLarge(!isRightPaneLarge);
  };

  return (
    <Box>
      <Typography variant="h3" gutterBottom>
        Map of Granergize buildings
      </Typography>
      <Typography variant="body1" paragraph>
        Created by the <a href="https://www.ti.rw.fau.de/">FAU Chair of Technical Information Systems</a> in cooperation with the <a href="https://www.scs.fraunhofer.de/">Fraunhofer Department for Risk and Location Analyses</a> for the research project <a href="#">Granergize</a>. Contact: <a href="mailto:thomas.wehr@fau.de">Thomas Wehr</a>
      </Typography>
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', padding: 1 }}>
        <Button variant="contained" onClick={togglePaneSize}>
          {isRightPaneLarge ? 'Shrink Details' : 'Enlarge Details'}
        </Button>
      </Box>
      <Grid2 container spacing={2} sx={{ height: 'calc(100vh - 200px)' }}>
        <Grid2 size={isRightPaneLarge ? 3 : 8} sx={{ height: '100%', overflow: 'auto' }}>
          <MapContainer
            className="map-container"
            center={[50.976558, 10.404674]}
            zoom={6.5}
            zoomSnap={0.5}
            style={{ height: '100%' }}
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            {buildings.map((building: BuildingType) => (
              (building.lat && building.long && <Marker
                key={building.id}
                position={[building.lat, building.long]}
                icon={selectedBuilding && selectedBuilding.id === building.id ? selectedIcon : defaultIcon}
                eventHandlers={{
                  click: () => {
                    setSelectedBuilding(building);
                  },
                }}
              >
              </Marker>)
            ))}
            {selectedBuilding && (
              <Building building={selectedBuilding} onHide={() => setSelectedBuilding(null)} />
            )}
          </MapContainer>
        </Grid2>
        <Grid2 size={isRightPaneLarge ? 9 : 4} sx={{ height: '100%', overflow: 'auto' }}>
          {
            !selectedEnergy && 
            <Typography variant="h4">Select a marker to show details</Typography>
          }
          {
            selectedEnergy &&
            selectedBuilding && (
              <Energy selectedBuilding={selectedBuilding.id.toString()} operatedBy={selectedBuilding.operatedBy?.toString()} />
            )
          }
        </Grid2>
      </Grid2>
    </Box>
  );
}