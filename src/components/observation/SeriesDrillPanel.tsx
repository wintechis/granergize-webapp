import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import CloseIcon from "@mui/icons-material/Close";
import type { Building } from "../../types.ts";
import { buildingDisplayName } from "../../lib/buildingDisplay.ts";
import IconAction from "../IconAction.tsx";
import SeriesEnergy from "../../pages/SeriesEnergy.tsx";
import { useT } from "../../context/I18nProvider.tsx";

/**
 * Explore's **time drill** (`?series=`, `services/cube/observationsAxes.ts`): the
 * cube's finest time grain, reached from a building row of the over-time matrix or the
 * pivot without leaving the surface. Step 4 of
 * `plans/plan-explore-complete-cube.md`.
 *
 * It is a panel, not a seventh view — the grid stays on screen above it, so the descent
 * reads as one: the row you came from, and the sub-hourly series underneath it. The
 * body is `SeriesEnergy` verbatim (the same component `/observation` renders, with its
 * own header suppressed in favour of this one); crossing into `PT15M` therefore stays
 * the lazy, explicit fetch the cube model prescribes — mounting the panel IS the act,
 * and nothing is prefetched while the grid alone is up.
 *
 * The header restates the coordinate the panel sits at (which building, which grain),
 * so the figures below are never an unlabelled cell; the close action clears the param
 * (the finder owns the write — the panel just asks).
 */
export default function SeriesDrillPanel(
  { building, onClose }: { building: Building; onClose: () => void },
) {
  const t = useT();
  return (
    <Box sx={{ mt: 3 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
        <Typography variant="h6">
          {t("seriesDrillTitle", { building: buildingDisplayName(building) })}
        </Typography>
        <Box sx={{ flexGrow: 1 }} />
        <IconAction
          label={t("btnClose")}
          icon={<CloseIcon fontSize="small" />}
          onClick={onClose}
        />
      </Box>
      <SeriesEnergy building={building} hideTitle />
    </Box>
  );
}
