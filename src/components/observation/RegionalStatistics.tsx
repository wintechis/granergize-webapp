/**
 * The building's regional statistics with a **Table | Map** toggle — the figures table
 * ({@link ./RegionalContextSection.tsx}) and the choropleth ({@link ./RegionalMetricsSection.tsx})
 * as two guises of one section, rather than two stacked sections. The toggle is always shown when
 * the section renders; a side with no data (figures that didn't resolve, or a building without
 * coordinates) is a *disabled* button, so the control is reliably present. Nothing renders only
 * when neither side has anything.
 */
import { useState } from "react";
import { Box, Stack, ToggleButton, ToggleButtonGroup } from "@mui/material";
import type { BuildingType } from "../../types.ts";
import { useRegionalContext } from "../../hooks/regional.ts";
import RegionalContextSection from "./RegionalContextSection.tsx";
import RegionalMetricsSection from "./RegionalMetricsSection.tsx";
import { useT } from "../../context/I18nProvider.tsx";

export default function RegionalStatistics(
  { building }: { building: BuildingType },
) {
  const t = useT();
  // Table-first: the figures are the primary content, and the region now resolves reliably at
  // geocode time (so the table isn't the flaky side any more). `active` snaps to the map only
  // when there are no figures (e.g. a located building outside the statistics' coverage).
  const [view, setView] = useState<"table" | "map">("table");
  // Same query the table section uses (React Query dedupes), so we can tell whether the
  // table has figures before offering it. The map needs only coordinates.
  const { data } = useRegionalContext(building);
  const hasTable = !!data && data.metrics.length > 0;
  const hasMap = building.lat != null && building.long != null;

  if (!hasTable && !hasMap) return null;
  // Snap to an available view if the chosen one has no data (so a disabled button is never active).
  const active = view === "table" && !hasTable
    ? "map"
    : view === "map" && !hasMap
    ? "table"
    : view;

  return (
    <Stack spacing={1}>
      <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
        <ToggleButtonGroup
          size="small"
          exclusive
          value={active}
          onChange={(_e, next: "table" | "map" | null) => {
            if (next) setView(next);
          }}
          aria-label={t("regStatsViewAria")}
        >
          <ToggleButton value="table" disabled={!hasTable}>{t("btnTable")}</ToggleButton>
          <ToggleButton value="map" disabled={!hasMap}>{t("btnMap")}</ToggleButton>
        </ToggleButtonGroup>
      </Box>
      {active === "table"
        ? <RegionalContextSection building={building} />
        : <RegionalMetricsSection building={building} />}
    </Stack>
  );
}
