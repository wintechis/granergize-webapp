import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  fetchNearestStations,
  fetchStationValues,
  WEATHER_PARAMETERS,
} from "../services/linkedWeather.ts";
import Box from "@mui/material/Box";
import FormControlLabel from "@mui/material/FormControlLabel";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import Typography from "@mui/material/Typography";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { BuildingType } from "../types.ts";
import { useT } from "../context/I18nProvider.tsx";
import { useAnnualEnergyByYear } from "../hooks/queries.ts";
import { type EnergyMetricKey } from "../services/rdf/energyDataset.ts";
import { DEFAULT_METRIC, metricRawAtYear } from "../services/energy/energyMetric.ts";
import {
  alignEnergyWeather,
  hasOverlap,
  weatherByYear,
} from "../services/energy/energyWeather.ts";
import { ELECTRICITY_COLOR } from "../constants/chartColors.ts";

/**
 * The **energy × weather overlay** (Step 6a of `plans/plan-cube-ui.md`): the
 * building's annual energy and a nearby DWD station's annual **mean temperature**
 * drawn on ONE year axis (a second, right-hand axis for °C), so consumption can be
 * read against the weather (the cross-layer superimpose guise).
 *
 * The weather path dereferences the `linked-wetterdienst` wrapper the way
 * `WeatherData.tsx` does (via `linkedWeather.ts`) — nearest-station-by-coordinates,
 * then annual values; the fetch is tracked by `trackedFetch`. The energy side reads
 * the SELECTED metric's absolute figure per year
 * (`metricRawAtYear` over `useAnnualEnergyByYear`) — the same cube and measure axis
 * the map's cube views honour, so a metric choice generalises both in one place.
 *
 * The alignment (union of years, missing → gap, overlap detection) is the pure,
 * unit-tested `energyWeather.ts`; this component owns only the fetch, the toggle,
 * and the dual-axis render. First cut = mean temperature; heating-degree-days is a
 * noted follow-up (it needs a base-temperature choice).
 */

const TEMP_COLOR = "#d95f02"; // warm orange — the weather axis, distinct from energy

/** The nearest DWD station to the building (rank 1) for mean temperature. Mirrors
 * `WeatherData.useWeatherStations` but takes only the closest, since the overlay
 * needs a single reference series. Opts into the activity store (the adapter fetch
 * isn't auto-instrumented like the Solid session). */
function useNearestStation(building: BuildingType) {
  const lat = building?.lat;
  const long = building?.long;
  return useQuery({
    queryKey: ["overlayWeatherStation", lat, long],
    enabled: Boolean(lat) && Boolean(long),
    queryFn: async () => {
      const stations = await fetchNearestStations(
        lat as number,
        long as number,
        1,
        WEATHER_PARAMETERS.TEMPERATURE_MEAN_ANNUAL,
      );
      return stations[0] ?? null;
    },
  });
}

/** Recent annual mean-temperature values for a station. */
function useStationTemperatures(stationId: string | null) {
  return useQuery({
    queryKey: ["overlayWeatherValues", stationId],
    enabled: Boolean(stationId),
    queryFn: () =>
      fetchStationValues(
        stationId as string,
        WEATHER_PARAMETERS.TEMPERATURE_MEAN_ANNUAL,
      ),
  });
}

interface EnergyWeatherOverlayProps {
  building: BuildingType;
  /** The observed property to overlay (the cube's measure axis); defaults to
   * electricity consumption — the basis the map's energy lens defaults to. */
  metric?: EnergyMetricKey;
}

export default function EnergyWeatherOverlay({
  building,
  metric = DEFAULT_METRIC,
}: EnergyWeatherOverlayProps) {
  const t = useT();
  const [on, setOn] = useState(false);

  // Energy per year on the SAME consumption basis as the map's energy lens — only
  // fetched once the overlay is switched on (and the building is located).
  const located = building.lat != null && building.long != null;
  const annual = useAnnualEnergyByYear([building], on);
  const stationQuery = useNearestStation(building);
  const station = stationQuery.data ?? null;
  const valuesQuery = useStationTemperatures(on ? (station?.station_id ?? null) : null);

  const toggle = (
    <FormControlLabel
      control={
        <Switch
          checked={on}
          onChange={(e) => setOn(e.target.checked)}
          disabled={!located}
        />
      }
      label={t("weatherOverlayToggle")}
    />
  );

  if (!located) {
    // No coordinates → no station to overlay; surface the caveat, keep the toggle
    // disabled rather than hiding the affordance.
    return (
      <Stack spacing={1}>
        {toggle}
        {on && (
          <Typography variant="body2" color="text.secondary">
            {t("weatherOverlayNoStation")}
          </Typography>
        )}
      </Stack>
    );
  }

  if (!on) return toggle;

  // Build per-year energy (absolute kWh of the selected metric) from the cube the
  // lens loads — the absolute figure, not a per-m² intensity, since the overlay
  // plots energy against temperature.
  const energyMap = new Map<number, number>();
  const byYear = annual.data?.get(building.id);
  if (byYear) {
    for (const [year, metrics] of byYear) {
      const kwh = metricRawAtYear(metrics, metric);
      if (kwh != null) energyMap.set(year, kwh);
    }
  }

  const weatherMap = weatherByYear(valuesQuery.data ?? []);
  const points = alignEnergyWeather(energyMap, weatherMap);

  // While a layer's data is still loading the region stays as plain text (the
  // header indicator is the single spinner).
  const loading = annual.isFetching || stationQuery.isFetching ||
    valuesQuery.isFetching;

  const km = station?.distance != null ? Math.round(station.distance) : null;

  return (
    <Stack spacing={1}>
      {toggle}
      <Typography variant="h6">{t("weatherOverlayTitle")}</Typography>

      {!station && !loading
        ? (
          <Typography variant="body2" color="text.secondary">
            {t("weatherOverlayNoStation")}
          </Typography>
        )
        : points.length === 0
        ? (
          <Typography variant="body2" color="text.secondary">
            {loading ? t("loadingEllipsis") : t("weatherOverlayNoOverlap")}
          </Typography>
        )
        : (
          <>
            <Box sx={{ width: "100%", height: 300 }}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                  data={points}
                  margin={{ top: 8, right: 16, bottom: 4, left: 8 }}
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="year" />
                  <YAxis
                    yAxisId="energy"
                    width={70}
                    label={{
                      value: t("weatherOverlayEnergyAxis"),
                      angle: -90,
                      position: "insideLeft",
                    }}
                  />
                  <YAxis
                    yAxisId="temp"
                    orientation="right"
                    width={60}
                    label={{
                      value: t("weatherOverlayTempAxis"),
                      angle: 90,
                      position: "insideRight",
                    }}
                  />
                  <Tooltip />
                  <Legend />
                  <Bar
                    yAxisId="energy"
                    dataKey="energy"
                    name={t("weatherOverlayEnergyAxis")}
                    fill={ELECTRICITY_COLOR}
                  />
                  <Line
                    yAxisId="temp"
                    type="monotone"
                    dataKey="weather"
                    name={t("weatherOverlayTempSeries")}
                    stroke={TEMP_COLOR}
                    dot={{ r: 2 }}
                    connectNulls
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </Box>

            {!hasOverlap(points) && (
              <Typography variant="body2" color="text.secondary">
                {t("weatherOverlayNoOverlap")}
              </Typography>
            )}

            {station && (
              <Typography variant="caption" color="text.secondary">
                {t("weatherOverlayStation", {
                  name: station.name,
                  id: station.station_id,
                  km: km ?? "?",
                })}
              </Typography>
            )}
          </>
        )}
    </Stack>
  );
}
