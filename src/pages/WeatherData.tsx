import { msg, type MessageId } from "../lib/messages.ts";
import { sourceKeys } from "../services/sources/sourceKeys.ts";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import {
  fetchNearestStations,
  fetchStationValues,
  WEATHER_PARAMETERS,
  weatherStationsUrl,
  weatherValuesUrl,
} from "../services/sources/linkedWeather.ts";
import {
  resolveWeatherParameter,
  resolveWeatherStation,
  weatherParameterToParams,
  weatherStationToParams,
} from "../services/sources/weatherParams.ts";
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
import { Building } from "../types.ts";
import { RdfSourceLink } from "../components/detail/DetailView.tsx";

interface WeatherDataProps {
  building: Building;
}


// Map of parameter dataset paths to their catalog label id (resolved at render).
const parameterTitles: Record<string, MessageId> = {
  [WEATHER_PARAMETERS.SUNSHINE_DURATION_ANNUAL]: "wdSunshineDuration",
  [WEATHER_PARAMETERS.TEMPERATURE_MEAN_ANNUAL]: "wdMeanTemperature",
  [WEATHER_PARAMETERS.PRECIPITATION_ANNUAL]: "wdPrecipitation",
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
function useWeatherStations(building: Building, parameter: string) {
  const lat = building?.lat;
  const long = building?.long;
  return useQuery({
    queryKey: [...sourceKeys.weatherStations, lat, long, parameter],
    enabled: Boolean(lat) && Boolean(long),
    queryFn: () =>
      fetchNearestStations(lat as number, long as number, 5, parameter),
  });
}

/** Recent values for one station + parameter; disabled until a station is picked. */
function useWeatherValues(station: string | null, parameter: string) {
  return useQuery({
    queryKey: [...sourceKeys.weatherValues, station, parameter],
    enabled: Boolean(station),
    queryFn: () => fetchStationValues(station as string, parameter),
  });
}

export default function WeatherData({ building }: WeatherDataProps) {
  // Navigational sub-state (deep-linkable, survives reload): the parameter (?wp) and
  // station (?ws) live in the URI (ui-state.md → weatherParams.ts).
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedParameter = resolveWeatherParameter(searchParams);
  const setSelectedParameter = (parameter: string) =>
    setSearchParams((prev) => weatherParameterToParams(parameter, prev), {
      replace: true,
    });

  const stationsQuery = useWeatherStations(building, selectedParameter);
  const stations = stationsQuery.data ?? [];
  const isLoadingStations = stationsQuery.isFetching;

  // The selected station: the URI's choice when it's still in the current list,
  // otherwise the closest (the adapter returns them rank-sorted) — derived, so a
  // building/parameter change that refetches a different list re-defaults with no
  // during-render reset. An absent ?ws → the nearest.
  const urlStation = resolveWeatherStation(searchParams);
  const selectedStation =
    urlStation && stations.some((s) => s.station_id === urlStation)
      ? urlStation
      : (stations[0]?.station_id ?? null);
  const setSelectedStation = (station: string | null) =>
    setSearchParams((prev) => weatherStationToParams(station, prev), {
      replace: true,
    });

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
        <Typography variant="h6">{msg("secWeather")}</Typography>
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
                {Object.entries(parameterTitles).map(([value, labelId]) => (
                  <MenuItem key={value} value={value}>{msg(labelId)}</MenuItem>
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
                          : msg("wdDistanceNA")}
                      </MenuItem>
                    ))
                  )}
              </Select>
            </FormControl>
          </Grid>
        </Grid>

        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        {!isLoading && !isLoadingStations && !error && stations.length === 0 && (
          <Alert severity="info">{msg("wdNoStations")}</Alert>
        )}

        {!isLoading && !error && values &&
          values.length === 0 && (
          <Alert severity="info">{msg("wdNoData")}</Alert>
        )}

        {!isLoading && !error && values &&
          values.length > 0 && (
          <>
            <Typography variant="h6" gutterBottom>
              {msg("wdRecentData")}
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
              {msg("dataSourceLabel")} Deutscher Wetterdienst (DWD)
            </Typography>
            {/* Dev-mode source link to the ACTUAL dereferenced wrapper query (the
                values?… IRI for the shown station, else the near?… stations IRI) —
                absolute + clickable, mirroring the regional/MaStR sections. */}
            <RdfSourceLink
              href={selectedStation
                ? weatherValuesUrl(selectedStation, selectedParameter)
                : weatherStationsUrl(
                  building.lat ?? 0,
                  building.long ?? 0,
                  5,
                  selectedParameter,
                )}
            />

            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ display: "block", mt: 1 }}
            >
              {msg("wdStationCaption", {
                id: selectedStation ?? "",
                name:
                  stations.find((s) => s.station_id === selectedStation)?.name ||
                  "",
              })}
            </Typography>
          </>
        )}
      </Box>
    </Stack>
  );
}
