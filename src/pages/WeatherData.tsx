import { useEffect, useState } from "react";
import {
  Station,
  ValuesResponse,
  WeatherParameters,
  WetterdienstClient,
} from "@wintechis/wetterdienst-rdf-adapter";
import {
  Alert,
  Card,
  CardContent,
  CardHeader,
  FormControl,
  Grid,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import WbSunnyIcon from "@mui/icons-material/WbSunny";
import { BuildingType } from "../types.ts";
import {
  beginActivity,
  endActivity,
} from "../lib/networkActivity.ts";
import { RdfSourceLink } from "../components/detail/DetailView.tsx";

interface WeatherDataProps {
  building: BuildingType;
}

const WEATHER_API_URL = import.meta.env.VITE_WEATHER_API_URL || "/weather-api/";

// The weather RDF adapter the app actually queries, resolved to an absolute URI
// (the dev proxy `/weather-api/` → its origin). Surfaced as a dev-mode source
// link so the external data service is inspectable, mirroring the Pod links.
const WEATHER_SOURCE_URL = WEATHER_API_URL.startsWith("http")
  ? WEATHER_API_URL
  : `${globalThis.location.origin}${WEATHER_API_URL}`;

const wetterdienstClient = new WetterdienstClient(
  WEATHER_API_URL.startsWith("http")
    ? WEATHER_API_URL
    : `${globalThis.location.origin}${WEATHER_API_URL}`,
  3, // maxRetries
  10000, // timeout
  { "Accept": "application/json" }, // headers
);

// Map of parameter names to more readable titles
const parameterTitles: Record<string, string> = {
  [WeatherParameters.SUNSHINE_DURATION_ANNUAL]: "Sunshine Duration Annual",
  [WeatherParameters.TEMPERATURE_MEAN_ANNUAL]: "Mean Temperature Annual",
  [WeatherParameters.PRECIPITATION_ANNUAL]: "Precipitation Annual",
};

// Map of parameter names to their units
const parameterUnits: Record<string, string> = {
  [WeatherParameters.SUNSHINE_DURATION_ANNUAL]: "h",
  [WeatherParameters.TEMPERATURE_MEAN_ANNUAL]: "°C",
  [WeatherParameters.PRECIPITATION_ANNUAL]: "mm",
};

export default function WeatherData({ building }: WeatherDataProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingStations, setIsLoadingStations] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedParameter, setSelectedParameter] = useState<string>(
    WeatherParameters.TEMPERATURE_MEAN_ANNUAL,
  );
  const [stations, setStations] = useState<Station[]>([]);
  const [selectedStation, setSelectedStation] = useState<string | null>(null);
  const [weatherData, setWeatherData] = useState<ValuesResponse | null>(null);

  // Fetch nearby weather stations when building changes
  useEffect(() => {
    if (!building || !building.lat || !building.long) return;

    const fetchStations = async () => {
      setIsLoadingStations(true);
      setError(null);
      const token = beginActivity("weather stations");
      try {
        const nearbyStations = (await wetterdienstClient.getStations({
          provider: "dwd",
          network: "observation",
          parameters: selectedParameter,
          latitude: building.lat as number,
          longitude: building.long as number,
          rank: 5,
        })).stations;

        setStations(nearbyStations);
        // Select the closest station by default
        if (nearbyStations.length > 0) {
          setSelectedStation(nearbyStations[0].station_id);
        } else {
          setSelectedStation(null);
        }
      } catch (err) {
        console.error("Error fetching weather stations:", err);
        setError(
          err instanceof Error
            ? err.message
            : "Failed to fetch weather stations",
        );
      } finally {
        endActivity(token);
        setIsLoadingStations(false);
      }
    };

    fetchStations();
  }, [building, selectedParameter]);

  // Fetch weather data when station or parameter changes
  useEffect(() => {
    if (!selectedStation) {
      setWeatherData(null);
      return;
    }

    const fetchWeatherData = async () => {
      setIsLoading(true);
      setError(null);
      const token = beginActivity("weather data");
      try {
        const values = await wetterdienstClient.getValues({
          provider: "dwd",
          network: "observation",
          parameters: selectedParameter,
          periods: "recent",
          station: selectedStation,
        });

        setWeatherData(values);
      } catch (err) {
        console.error("Error fetching weather data:", err);
        setError(
          err instanceof Error ? err.message : "Failed to fetch weather data",
        );
        setWeatherData(null);
      } finally {
        endActivity(token);
        setIsLoading(false);
      }
    };

    fetchWeatherData();
  }, [selectedStation, selectedParameter]);

  return (
    <Card variant="outlined">
      <CardHeader
        avatar={<WbSunnyIcon />}
        titleTypographyProps={{ variant: "h5" }}
        title={`Weather Data for Building ${building.id}`}
      />
      <CardContent>
        <Grid container spacing={2} sx={{ mb: 2 }}>
          <Grid item xs={12} md={6}>
            <FormControl fullWidth>
              <InputLabel>Weather Parameter</InputLabel>
              <Select
                value={selectedParameter}
                onChange={(e) => setSelectedParameter(e.target.value)}
                label="Weather Parameter"
                disabled={isLoadingStations}
              >
                {Object.entries(parameterTitles).map(([value, label]) => (
                  <MenuItem key={value} value={value}>{label}</MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>

          <Grid item xs={12} md={6}>
            <FormControl fullWidth disabled={stations.length === 0}>
              <InputLabel>Weather Station</InputLabel>
              <Select
                value={selectedStation || ""}
                onChange={(e) => setSelectedStation(e.target.value)}
                label="Weather Station"
              >
                {isLoadingStations
                  ? <MenuItem disabled>Loading stations…</MenuItem>
                  : (
                    stations.map((station) => (
                      <MenuItem
                        key={station.station_id}
                        value={station.station_id}
                      >
                        {station.name} ({station.station_id}) -{" "}
                        {station.distance !== undefined
                          ? `${Math.round(station.distance)} km`
                          : "Distance N/A"}
                      </MenuItem>
                    ))
                  )}
              </Select>
            </FormControl>
          </Grid>
        </Grid>

        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        {!isLoading && !error && stations.length === 0 && (
          <Alert severity="info">
            No weather stations found near this location for the selected
            parameter.
          </Alert>
        )}

        {!isLoading && !error && weatherData?.values &&
          weatherData?.values.length === 0 && (
          <Alert severity="info">
            No weather data available for the selected station and parameter.
          </Alert>
        )}

        {!isLoading && !error && weatherData?.values &&
          weatherData?.values.length > 0 && (
          <>
            <Typography variant="h6" gutterBottom>
              Recent Weather Data
            </Typography>

            <TableContainer component={Paper} sx={{ mb: 2 }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Year</TableCell>
                    <TableCell>Value</TableCell>
                    <TableCell>Quality</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {weatherData.values &&
                    weatherData.values.map((item, index) => (
                      <TableRow key={index}>
                        <TableCell>
                          {new Date(item.date).getFullYear()}
                        </TableCell>
                        <TableCell>
                          {item.value} {parameterUnits[selectedParameter]}
                        </TableCell>
                        <TableCell>{item.quality}</TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </TableContainer>

            <Typography variant="body2" color="text.secondary">
              Data source: Deutscher Wetterdienst (DWD)
            </Typography>
            <RdfSourceLink href={WEATHER_SOURCE_URL} />

            <Typography
              variant="caption"
              color="text.secondary"
              display="block"
              sx={{ mt: 1 }}
            >
              Station {selectedStation}:{" "}
              {stations.find((s) => s.station_id === selectedStation)?.name ||
                ""}
            </Typography>
          </>
        )}
      </CardContent>
    </Card>
  );
}
