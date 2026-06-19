import { msg } from "../../lib/messages.ts";
import { Box, Stack, Typography, useTheme } from "@mui/material";
import ShowChartIcon from "@mui/icons-material/ShowChart";
import type { BuildingType } from "../../types.ts";
import { RefLink } from "../detail/DetailView.tsx";
import { observationRoute } from "../../routes.ts";
import { useAnnualEnergy } from "../../hooks/queries.ts";
import { ANNUAL_METRICS } from "../../constants/annualMetrics.ts";
import Sparkline from "../detail/Sparkline.tsx";

/**
 * A compact energy summary on the building page — NOT the full charts. It reads the
 * building's `cons:hasEnergyDataset` links (already on the building, no extra
 * fetch) to report how many years are present and the latest one, then links to
 * the full observation page (`/observation/:id`) for the charts and per-year entry.
 */
export default function EnergySummarySection(
  { building }: { building: BuildingType },
) {
  const theme = useTheme();
  // Building-level years only — per-unit (featureOfInterest) observations are
  // summarised under their unit, not in the building's energy summary.
  const datasets = (building.energyDatasets ?? []).filter((d) => !d.featureOfInterest);
  const years = [...new Set(datasets.map((d) => d.year))].sort((a, b) => a - b);
  const latestYear = years.length > 0 ? years[years.length - 1] : null;
  // A sparkline of the primary (first present) metric over the years — the trend at a
  // glance beside the year count, before the link into the full charts.
  const rows = useAnnualEnergy(building).data?.actual ?? [];
  const primary = ANNUAL_METRICS.find((m) => rows.some((r) => r[m.key] != null));
  const spark = primary
    ? rows.map((r) => r[primary.key]).filter((v): v is number => typeof v === "number")
    : [];
  // The observation page resolves the same :selectedBuilding param the routes encode.
  const energyHref = observationRoute(building.id);

  return (
    <Box>
      <Typography variant="h6" sx={{ mb: 1 }}>{msg("secEnergy")}</Typography>
      {years.length === 0
        ? (
          <Typography variant="body2" color="text.secondary">
            {msg("essNoData")}{" "}
            <RefLink to={energyHref}>{msg("essOpenEnergyPage")}</RefLink>
          </Typography>
        )
        : (
          <Stack spacing={1}>
            <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
              <ShowChartIcon color="action" fontSize="small" />
              <Typography variant="body1">
                {msg("essYearsSummary", {
                  count: years.length,
                  year: latestYear ?? years[years.length - 1],
                })}
              </Typography>
              <Sparkline values={spark} color={theme.palette.primary.main} />
            </Stack>
            <RefLink to={energyHref}>{msg("essViewCharts")}</RefLink>
          </Stack>
        )}
    </Box>
  );
}
