import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { msg } from "../lib/messages.ts";
import { Building } from "../types.ts";
import { Box, Divider, Stack, Typography } from "@mui/material";
import { useSolidData } from "../hooks/queries.ts";
import { ACTION_PARAM } from "../routes.ts";
import { usePaletteFocus } from "../context/PaletteFocusContext.tsx";
import { RdfSourceLink } from "../components/detail/DetailView.tsx";
import { ProvenanceMarker } from "../components/ProvenanceMarker.tsx";
import EnergyYearEditor from "../components/EnergyYearEditor.tsx";
import { getSession } from "../hooks/session.ts";
import { useDevMode } from "../hooks/devMode.ts";
import { splitEnergyDatasets } from "../lib/energyResolution.ts";
import EnergyResolutionSwitch from "../components/EnergyResolutionSwitch.tsx";
import SeriesEnergy from "./SeriesEnergy.tsx";
import AnnualEnergy from "./AnnualEnergy.tsx";
import UnitObservationsSection from "../components/building/UnitObservationsSection.tsx";
import ObservationHeader from "../components/observation/ObservationHeader.tsx";
import WeatherData from "./WeatherData.tsx";
import EnergyWeatherOverlay from "../components/EnergyWeatherOverlay.tsx";
// The building's location energy CONTEXT — moved here from the building page so building
// info stays on the building and observation/context lives on the observation page.
import StandortEnergieprofil from "../components/building/StandortEnergieprofil.tsx";
import NeighbourhoodEnergyMap from "../components/observation/NeighbourhoodEnergyMap.tsx";
import RegionalStatistics from "../components/observation/RegionalStatistics.tsx";

type EnergyProps = {
  building: Building;
};

export default function EnergyDetail({ building }: EnergyProps) {
  // Only the global error/loading flags are read here now — the annual and
  // series surfaces own their own data (AnnualEnergy via useAnnualEnergy from
  // building.energyDatasets; SeriesEnergy lazy-loads the time series).
  const { isLoading, error } = useSolidData();
  const dev = useDevMode();

  // Register the building this page is showing as the ⌘K palette's focused
  // object — the observation surface is titled by its building, and energy
  // belongs to that building. The energy verbs (SaveEnergyYear /
  // DeleteEnergyYear) are RICH (a routed surface — the inline EnergyYearEditor),
  // so they need no direct handler — the palette routes here `?action=enter-energy`
  // and the header's EnergyEntryButton toggles the editor open (mirroring
  // Building.tsx). Clearing on unmount returns the palette to navigation-only.
  const { setFocus, clearFocus } = usePaletteFocus();
  useEffect(() => {
    setFocus({ object: building, handlers: {} });
    return () => clearFocus();
    // Re-register whenever the focused building changes; the setters are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [building]);

  // A palette-routed energy entry arrives with `?action=enter-energy`, which seeds
  // the inline editor open (`entering` below). The close handler strips the param
  // so a reload / re-focus doesn't reopen the editor.
  const [sp, setSp] = useSearchParams();
  const autoOpenEntry = sp.get(ACTION_PARAM) === "enter-energy";
  const onEntryClosed = () => {
    setSp((prev) => {
      const next = new URLSearchParams(prev);
      next.delete(ACTION_PARAM);
      return next;
    }, { replace: true });
  };

  // The energy-year editor is INLINE on this page now (not a modal). The header's
  // "Edit energy years" button toggles it; the palette's `?action=enter-energy` seeds it
  // open. Owned here so it renders in the page body below the header.
  const [entering, setEntering] = useState(
    autoOpenEntry && !building.isShared,
  );
  const closeEntry = () => {
    setEntering(false);
    onEntryClosed();
  };

  // While the global load is in flight, stay blank — the header spinner is the
  // single loading indicator; this avoids a misleading "no data" flash.
  if (isLoading) return null;

  if (error) {
    return (
      <Typography color="error">
        {msg("energyLoadError", { error: String(error) })}
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
          onEdit={() => setEntering(true)}
        />
        {entering
          ? (
            <EnergyYearEditor
              inline
              building={building}
              session={getSession()}
              onClose={closeEntry}
            />
          )
          : (
            <Typography color="text.secondary">
              {building.isShared ? msg("energyNoneShared") : msg("energyNoneOwn")}
            </Typography>
          )}
        {weatherSection}
        <StandortEnergieprofil building={building} />
        <NeighbourhoodEnergyMap building={building} />
        <RegionalStatistics building={building} />
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
            {/* Every annual dataset (one resource per year), not just the first —
                the series view lists all of its datasets the same way. */}
            {aggregates.map((d) => <RdfSourceLink key={d.uri} href={d.uri} />)}
            <Divider />
          </>
        )}
        {/* Group provenance for the annual view: one dataset node per year. */}
        <ProvenanceMarker
          subject={aggregates.map((d) => d.uri)}
          sources={[...new Set(aggregates.map((d) => d.uri.split("#")[0]))]}
        />
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
        onEdit={() => setEntering(true)}
      />
      {entering
        ? (
          <EnergyYearEditor
            inline
            building={building}
            session={getSession()}
            onClose={closeEntry}
          />
        )
        : (
          <EnergyResolutionSwitch
            annual={annualView}
            series={series.length > 0
              ? (
                <>
                  <ProvenanceMarker
                    subject={series.map((d) => d.uri)}
                    sources={[
                      ...new Set(series.map((d) => d.uri.split("#")[0])),
                    ]}
                  />
                  <SeriesEnergy building={building} />
                </>
              )
              : undefined}
          />
        )}
      <UnitObservationsSection building={building} />
      {weatherSection}
      <StandortEnergieprofil building={building} />
      <NeighbourhoodEnergyMap building={building} />
      <RegionalStatistics building={building} />
    </Stack>
  );
}
