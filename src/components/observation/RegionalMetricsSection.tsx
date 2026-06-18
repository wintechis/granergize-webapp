/**
 * The building's regional statistics as a MAP — the Bundesland/Kreis choropleth
 * ({@link ../region/RegionalMetricsMap.tsx}) anchored on the building's location, the
 * map sibling of {@link ./RegionalContextSection.tsx}'s figures table. Shown for any
 * located building (the regions are German — the pilot scope); zoom out for the
 * Bundesland, in for the Kreis, and pick the metric from the dropdown.
 */
import { Box } from "@mui/material";
import type { BuildingType } from "../../types.ts";
import RegionalMetricsMap from "../region/RegionalMetricsMap.tsx";

export default function RegionalMetricsSection(
  { building }: { building: BuildingType },
) {
  const { lat, long } = building;
  if (lat == null || long == null) return null;
  return (
    <Box sx={{ height: 380 }}>
      <RegionalMetricsMap
        center={[lat, long]}
        zoom={8}
        marker={{ lat, long, shared: building.isShared ?? false }}
      />
    </Box>
  );
}
