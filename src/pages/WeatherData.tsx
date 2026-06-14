import { buildingDisplayName } from "../lib/buildingDisplay.ts";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
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

/**
 * Nearby DWD stations for a building's coordinates + parameter — a read from the
 * external weather adapter (not the Pod), so a plain `useQuery`. The adapter
 * isn't auto-instrumented like the Solid session, so the fetch opts into the
 * global activity store (`beginActivity`/`endActivity`).
 */
function useWeatherStations(building: BuildingType, parameter: string) {
  const lat = building?.lat;
  const long = building?.long;
  return useQuery({
    queryKey: ["weatherStations", lat, long, parameter],
    enabled: Boolean(lat) && Boolean(long),
    queryFn: async () => {
      const token = beginActivity("weather stations");
      try {
        const res = await wetterdienstClient.getStations({
          provider: "dwd",
          network: "observation",
          parameters: parameter,
          latitude: lat as number,
          longitude: long as number,
          rank: 5,
        });
        return res.stations;
      } finally {
        endActivity(token);
      }
    },
  });
}

/** Recent values for one station + parameter; disabled until a station is picked. */
function useWeatherValues(station: string | null, parameter: string) {
  return useQuery({
    queryKey: ["weatherValues", station, parameter],
    enabled: Boolean(station),
    queryFn: async () => {
      const token = beginActivity("weather data");
      try {
        return await wetterdienstClient.getValues({
          provider: "dwd",
          network: "observation",
          parameters: parameter,
          periods: "recent",
          station: station as string,
        });
      } finally {
        endActivity(token);
      }
    },
  });
}

export default function WeatherData({ building }: WeatherDataProps) {
  const [selectedParameter, setSelectedParameter] = useState<string>(
    WeatherParameters.TEMPERATURE_MEAN_ANNUAL,
  );
  const [selectedStation, setSelectedStation] = useState<string | null>(null);

  const stationsQuery = useWeatherStations(building, selectedParameter);
  const stations = stationsQuery.data ?? [];
  const isLoadingStations = stationsQuery.isFetching;

  // Default to the closest station (the adapter returns them rank-sorted) once a
  // fresh station list arrives — a during-render reset keyed on the list identity
  // (building/parameter change refetches → new list → re-default), not an effect.
  const [seededStations, setSeededStations] = useState(stationsQuery.data);
  if (stationsQuery.data !== seededStations) {
    setSeededStations(stationsQuery.data);
    setSelectedStation(
      stationsQuery.data && stationsQuery.data.length > 0
        ? stationsQuery.data[0].station_id
        : null,
    );
  }

  const valuesQuery = useWeatherValues(selectedStation, selectedParameter);
  const weatherData = valuesQuery.data ?? null;
  const isLoading = valuesQuery.isFetching;

  const queryError = stationsQuery.error ?? valuesQuery.error;
  const error = queryError
    ? (queryError instanceof Error
      ? queryError.message
      : "Failed to fetch weather data")
    : null;

  return (
    <Card variant="outlined">
      <CardHeader
        avatar={<WbSunnyIcon />}
        titleTypographyProps={{ variant: "h5" }}
        title={`Weather Data for ${buildingDisplayName(building)}`}
      />
      <CardContent>
        <Grid container spacing={2} sx={{ mb: 2 }}>
          <Grid size={{ xs: 12, md: 6 }}>
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

          <Grid size={{ xs: 12, md: 6 }}>
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

        {!isLoading && !isLoadingStations && !error && stations.length === 0 && (
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
              sx={{ display: "block", mt: 1 }}
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
