import { msg } from "../lib/messages.ts";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  fetchNearestStations,
  fetchStationValues,
  WEATHER_PARAMETERS,
} from "../services/rdf/linkedWeather.ts";
import {
  Alert,
  Box,
  FormControl,
  Grid,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
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
import { RdfSourceLink } from "../components/detail/DetailView.tsx";

interface WeatherDataProps {
  building: BuildingType;
}

const WEATHER_API_URI = import.meta.env.VITE_WEATHER_API_URI || "/weather-api/";

// The linked-wetterdienst wrapper the app dereferences, resolved to an absolute URI
// (the dev proxy `/weather-api/` → its origin). Surfaced as a dev-mode source link so
// the external data service is inspectable, mirroring the Pod links.
const WEATHER_SOURCE_URI = WEATHER_API_URI.startsWith("http")
  ? WEATHER_API_URI
  : `${globalThis.location.origin}${WEATHER_API_URI}`;

// Map of parameter dataset paths to more readable titles
const parameterTitles: Record<string, string> = {
  [WEATHER_PARAMETERS.SUNSHINE_DURATION_ANNUAL]: "Sunshine Duration Annual",
  [WEATHER_PARAMETERS.TEMPERATURE_MEAN_ANNUAL]: "Mean Temperature Annual",
  [WEATHER_PARAMETERS.PRECIPITATION_ANNUAL]: "Precipitation Annual",
};

// Map of parameter dataset paths to their units
const parameterUnits: Record<string, string> = {
  [WEATHER_PARAMETERS.SUNSHINE_DURATION_ANNUAL]: "h",
  [WEATHER_PARAMETERS.TEMPERATURE_MEAN_ANNUAL]: "°C",
  [WEATHER_PARAMETERS.PRECIPITATION_ANNUAL]: "mm",
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
    queryFn: () =>
      fetchNearestStations(lat as number, long as number, 5, parameter),
  });
}

/** Recent values for one station + parameter; disabled until a station is picked. */
function useWeatherValues(station: string | null, parameter: string) {
  return useQuery({
    queryKey: ["weatherValues", station, parameter],
    enabled: Boolean(station),
    queryFn: () => fetchStationValues(station as string, parameter),
  });
}

export default function WeatherData({ building }: WeatherDataProps) {
  const [selectedParameter, setSelectedParameter] = useState<string>(
    WEATHER_PARAMETERS.TEMPERATURE_MEAN_ANNUAL,
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
  const values = valuesQuery.data ?? null;
  const isLoading = valuesQuery.isFetching;

  const queryError = stationsQuery.error ?? valuesQuery.error;
  const error = queryError
    ? (queryError instanceof Error
      ? queryError.message
      : "Failed to fetch weather data")
    : null;

  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
        <WbSunnyIcon color="action" />
        <Typography variant="h6">Weather</Typography>
      </Stack>
      <Box>
        <Grid container spacing={2} sx={{ mb: 2 }}>
          <Grid size={{ xs: 12, md: 6 }}>
            <FormControl fullWidth>
              <InputLabel>{msg("wdParameter")}</InputLabel>
              <Select
                value={selectedParameter}
                onChange={(e) => setSelectedParameter(e.target.value)}
                label={msg("wdParameter")}
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
              <InputLabel>{msg("wdStation")}</InputLabel>
              <Select
                value={selectedStation || ""}
                onChange={(e) => setSelectedStation(e.target.value)}
                label={msg("wdStation")}
              >
                {isLoadingStations
                  ? <MenuItem disabled>{msg("wdLoadingStations")}</MenuItem>
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

        {!isLoading && !error && values &&
          values.length === 0 && (
          <Alert severity="info">
            No weather data available for the selected station and parameter.
          </Alert>
        )}

        {!isLoading && !error && values &&
          values.length > 0 && (
          <>
            <Typography variant="h6" gutterBottom>
              Recent Weather Data
            </Typography>

            <TableContainer component={Paper} sx={{ mb: 2 }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>{msg("lblYear")}</TableCell>
                    <TableCell>{msg("wdValue")}</TableCell>
                    <TableCell>{msg("wdQuality")}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {values.map((item, index) => (
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
            <RdfSourceLink href={WEATHER_SOURCE_URI} />

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
      </Box>
    </Stack>
  );
}
