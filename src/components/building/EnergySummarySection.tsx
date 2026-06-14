import { Box, Stack, Typography } from "@mui/material";
import ShowChartIcon from "@mui/icons-material/ShowChart";
import type { BuildingType } from "../../types.ts";
import { RefLink } from "../detail/DetailView.tsx";
import { observationRoute } from "../../routes.ts";

/**
 * A compact energy summary on the building page — NOT the full charts. It reads the
 * building's `cons:hasEnergyDataset` links (already on the building, no extra
 * fetch) to report how many years are present and the latest one, then links to
 * the full observation page (`/observation/:id`) for the charts and per-year entry.
 */
export default function EnergySummarySection(
  { building }: { building: BuildingType },
) {
  const datasets = building.energyDatasets ?? [];
  const years = [...new Set(datasets.map((d) => d.year))].sort((a, b) => a - b);
  const latestYear = years.length > 0 ? years[years.length - 1] : null;
  // The observation page resolves the same :selectedBuilding param the routes encode.
  const energyHref = observationRoute(building.id);

  return (
    <Box>
      <Typography variant="h6" sx={{ mb: 1 }}>Energy</Typography>
      {years.length === 0
        ? (
          <Typography variant="body2" color="text.secondary">
            No energy data yet.{" "}
            <RefLink to={energyHref}>Open the energy page</RefLink> to add a year.
          </Typography>
        )
        : (
          <Stack spacing={1}>
            <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
              <ShowChartIcon color="action" fontSize="small" />
              <Typography variant="body1">
                {years.length} year{years.length === 1 ? "" : "s"} of energy data
                {latestYear != null && ` (latest: ${latestYear})`}
              </Typography>
            </Stack>
            <RefLink to={energyHref}>View energy charts →</RefLink>
          </Stack>
        )}
    </Box>
  );
}
