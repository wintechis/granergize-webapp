import { BuildingType } from "../types.ts";
import { Box, Divider, Stack, Typography } from "@mui/material";
import { useSolidData } from "../hooks/queries.ts";
import { RdfSourceLink } from "../components/detail/DetailView.tsx";
import { useDevMode } from "../hooks/devMode.ts";
import { splitEnergyDatasets } from "../lib/energyResolution.ts";
import EnergyResolutionSwitch from "../components/EnergyResolutionSwitch.tsx";
import SeriesEnergy from "./SeriesEnergy.tsx";
import AnnualEnergy from "./AnnualEnergy.tsx";
import ObservationHeader from "../components/observation/ObservationHeader.tsx";
import WeatherData from "./WeatherData.tsx";
import EnergyWeatherOverlay from "../components/EnergyWeatherOverlay.tsx";

type EnergyProps = {
  building: BuildingType;
};

export default function Energy({ building }: EnergyProps) {
  // Only the global error/loading flags are read here now — the annual and
  // series surfaces own their own data (AnnualEnergy via useAnnualEnergy from
  // building.energyDatasets; SeriesEnergy lazy-loads the time series).
  const { isLoading, error } = useSolidData();
  const dev = useDevMode();

  // While the global load is in flight, stay blank — the header spinner is the
  // single loading indicator; this avoids a misleading "no data" flash.
  if (isLoading) return null;

  if (error) {
    return (
      <Typography color="error">
        Error loading data: {error}
      </Typography>
    );
  }

  // The building's energy datasets partitioned by granularity. The finder lists
  // a building precisely when it has energy datasets, so gating the page on the
  // SAME source (not the latest-year bulk `energyNeed`) keeps the two in step:
  // a building the finder shows always renders its energy here.
  const { aggregates, series } = splitEnergyDatasets(building.energyDatasets);

  // Weather is the building's OTHER observation layer: external, live, read-only
  // observations from the nearest DWD station (a spatial join by proximity, see
  // notes/weather.md). It is about the building's location, so it shows whenever
  // the building has coordinates — independent of whether it owns energy data.
  const weatherSection =
    building.lat != null && building.long != null
      ? <WeatherData building={building} />
      : null;

  if (aggregates.length === 0 && series.length === 0) {
    // No energy yet — still the full detail page (header + back link); the
    // header carries the owner's "Edit energy years" action (the entry point
    // moved off the finder row to this page). A building shared with the user is
    // read-only, so it only gets the no-access note. Weather (when located) still
    // renders — it's an independent observation layer about the building.
    return (
      <Stack spacing={3} divider={<Divider />} sx={{ width: "100%" }}>
        <ObservationHeader building={building} />
        <Typography color="text.secondary">
          {building.isShared
            ? "No energy data available for this building. You may not have access to this data."
            : "No energy data yet. Use the “Edit energy years” button above to add a year."}
        </Typography>
        {weatherSection}
      </Stack>
    );
  }

  // The single annual view — multi-year per-year rows, the actual-vs-planned
  // (Soll-Ist) overlay, the per-metric charts, AND the operator / portfolio /
  // benchmark comparison rows. (The map's old "Energy data" detail tab folded
  // into this one home; the map is a pure finder now.)
  const annualView = aggregates.length > 0
    ? (
      <Box>
        {dev && (
          <>
            <RdfSourceLink href={aggregates[0].url} />
            <Divider />
          </>
        )}
        <AnnualEnergy building={building} />
        {/* Step 6a: overlay the building's annual energy with the nearest DWD
            station's mean temperature on the shared year axis (cross-layer
            superimpose). Off by default; honest about the station distance. */}
        <Box sx={{ mt: 3 }}>
          <EnergyWeatherOverlay building={building} />
        </Box>
      </Box>
    )
    : undefined;

  // Same master-detail shape as the building / contact / aggregation / room
  // pages: a header (back link + identity + the owner's energy-entry action) and
  // a divider-separated stack of sections — here the Annual | Time series view.
  return (
    <Stack spacing={3} divider={<Divider />} sx={{ width: "100%" }}>
      <ObservationHeader building={building} />
      <EnergyResolutionSwitch
        annual={annualView}
        series={series.length > 0
          ? <SeriesEnergy building={building} />
          : undefined}
      />
      {weatherSection}
    </Stack>
  );
}
