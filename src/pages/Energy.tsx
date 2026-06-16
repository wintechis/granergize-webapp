import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { BuildingType } from "../types.ts";
import { Box, Divider, Stack, Typography } from "@mui/material";
import { useSolidData } from "../hooks/queries.ts";
import { ACTION_PARAM } from "../routes.ts";
import { usePaletteFocus } from "../context/PaletteFocusContext.tsx";
import { RdfSourceLink } from "../components/detail/DetailView.tsx";
import { useDevMode } from "../hooks/devMode.ts";
import { splitEnergyDatasets } from "../lib/energyResolution.ts";
import EnergyResolutionSwitch from "../components/EnergyResolutionSwitch.tsx";
import SeriesEnergy from "./SeriesEnergy.tsx";
import AnnualEnergy from "./AnnualEnergy.tsx";
import ObservationHeader from "../components/observation/ObservationHeader.tsx";
import WeatherData from "./WeatherData.tsx";
import EnergyWeatherOverlay from "../components/EnergyWeatherOverlay.tsx";
import RegionalContextSection from "../components/observation/RegionalContextSection.tsx";

type EnergyProps = {
  building: BuildingType;
};

export default function Energy({ building }: EnergyProps) {
  // Only the global error/loading flags are read here now — the annual and
  // series surfaces own their own data (AnnualEnergy via useAnnualEnergy from
  // building.energyDatasets; SeriesEnergy lazy-loads the time series).
  const { isLoading, error } = useSolidData();
  const dev = useDevMode();

  // Register the building this page is showing as the ⌘K palette's focused
  // object — the observation surface is titled by its building, and energy
  // belongs to that building. The energy verbs (SaveEnergyYear /
  // DeleteEnergyYear) are RICH (a dialog-routed surface, EnergyYearDialog), so
  // they need no direct handler — the palette routes here `?action=enter-energy`
  // and the header's EnergyEntryButton opens the dialog (mirroring Building.tsx /
  // Aggregation.tsx). Clearing on unmount returns the palette to navigation-only.
  const { setFocus, clearFocus } = usePaletteFocus();
  useEffect(() => {
    setFocus({ object: building, handlers: {} });
    return () => clearFocus();
    // Re-register whenever the focused building changes; the setters are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [building]);

  // A palette-routed energy entry arrives with `?action=enter-energy`, which the
  // header's EnergyEntryButton seeds open from (plan-palette §5). The close
  // handler strips the param so a reload / re-focus doesn't reopen the dialog.
  const [sp, setSp] = useSearchParams();
  const autoOpenEntry = sp.get(ACTION_PARAM) === "enter-energy";
  const onEntryClosed = () => {
    setSp((prev) => {
      const next = new URLSearchParams(prev);
      next.delete(ACTION_PARAM);
      return next;
    }, { replace: true });
  };

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
        <ObservationHeader
          building={building}
          autoOpenEntry={autoOpenEntry}
          onEntryClosed={onEntryClosed}
        />
        <Typography color="text.secondary">
          {building.isShared
            ? "No energy data available for this building. You may not have access to this data."
            : "No energy data yet. Use the “Edit energy years” button above to add a year."}
        </Typography>
        {weatherSection}
        <RegionalContextSection building={building} />
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
      <ObservationHeader
        building={building}
        autoOpenEntry={autoOpenEntry}
        onEntryClosed={onEntryClosed}
      />
      <EnergyResolutionSwitch
        annual={annualView}
        series={series.length > 0
          ? <SeriesEnergy building={building} />
          : undefined}
      />
      {weatherSection}
      <RegionalContextSection building={building} />
    </Stack>
  );
}
