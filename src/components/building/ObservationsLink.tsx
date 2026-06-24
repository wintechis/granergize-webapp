import { Box, Typography } from "@mui/material";
import { msg } from "../../lib/messages.ts";
import type { BuildingType } from "../../types.ts";
import { RefLink } from "../detail/DetailView.tsx";
import { observationRoute } from "../../routes.ts";

/**
 * The building page's LINK to its energy/observations — not the figures themselves.
 * Building info stays on the building page and observation (energy) info on the
 * observation page; the two only link, never mix. The figures live at the observation
 * route ({@link observationRoute}); the back link there returns here.
 */
export default function ObservationsLink({ building }: { building: BuildingType }) {
  return (
    <Box>
      <Typography variant="h6" sx={{ mb: 1 }}>{msg("secEnergy")}</Typography>
      <RefLink to={observationRoute(building.id)}>{msg("essViewCharts")}</RefLink>
    </Box>
  );
}
