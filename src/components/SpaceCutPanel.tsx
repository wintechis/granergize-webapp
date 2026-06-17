import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { BuildingType } from "../types.ts";
import { buildingDisplayName } from "../lib/buildingDisplay.ts";
import { buildingRoute } from "../routes.ts";
import { type EnergyMetricKey } from "../services/rdf/energyDataset.ts";
import { DEFAULT_METRIC } from "../services/energy/energyMetric.ts";
import {
  buildEnergyMatrix,
  type MatrixCell,
} from "../services/energy/energyMatrix.ts";
import { type EnergyByBuildingYear } from "../services/energy/energyTimeCut.ts";
import { bandColor, bandLabelKey } from "../constants/lensBand.ts";
import { ellipsis } from "../constants/listStyles.ts";
import { useT } from "../context/I18nProvider.tsx";

/**
 * The **cross-building space-cut panel** (Step 2 of `plans/plan-cube-ui.md`): a
 * buildings × years heatmap — rows are buildings, columns are the reachable
 * years, each cell coloured by that building-year's efficiency tier. Where the
 * map's time-cut slider shows the whole set at one year, this shows the whole
 * temporal evolution of the set at once (the "cross-building temporal finder").
 *
 * It is a pure render over `buildEnergyMatrix` (the unit-tested shaping fn) and
 * the same `EnergyByBuildingYear` cube the map's energy lens loads — so the panel
 * and the map colour identically at a shared (building, year). A cell click
 * leaves for `/building/:id` (the map's navigation loop — the finder hands off to
 * the detail page); the panel is a finder, it doesn't own selection state. The
 * tier colours reuse the map energy-lens palette so the two surfaces read in step.
 *
 * Loading is the header indicator's job (CLAUDE.md): the panel shows a plain
 * "Loading…" / empty-state line while the cube is in flight or empty — no
 * component spinner.
 */

const CELL = 28;
const NAME_COL = 200;

interface SpaceCutPanelProps {
  buildings: BuildingType[];
  /** The per-building annual cube (from `useAnnualEnergyByYear`). */
  energyByYear: EnergyByBuildingYear | undefined;
  /** Ids the lens frames its per-year peer set against (the visible set). */
  visibleIds: ReadonlySet<string>;
  /** The selected observed property (the cube's measure axis). */
  metric?: EnergyMetricKey;
}

export default function SpaceCutPanel(
  { buildings, energyByYear, visibleIds, metric = DEFAULT_METRIC }: SpaceCutPanelProps,
) {
  const navigate = useNavigate();
  const t = useT();
  const matrix = useMemo(
    () =>
      energyByYear
        ? buildEnergyMatrix(buildings, energyByYear, visibleIds, metric)
        : null,
    [buildings, energyByYear, visibleIds, metric],
  );

  // The cell value unit follows the framing: consumption is a per-m² intensity, a
  // generation magnitude is the absolute figure.
  const cellTitle = (name: string, cell: MatrixCell): string => {
    if (cell.value == null) return `${name} — ${cell.year}: ${t("lensBandNoData")}`;
    const band = t(bandLabelKey(cell.band, matrix!.framing));
    const unit = matrix!.framing === "magnitude" ? "kWh" : "kWh/m²/a";
    return `${name} — ${cell.year}: ${Math.round(cell.value)} ${unit} (${band})`;
  };

  if (!matrix) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
        Loading…
      </Typography>
    );
  }
  if (matrix.years.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
        No annual energy data yet. Add energy years to your buildings to compare
        them over time here.
      </Typography>
    );
  }

  const { years, rows, framing } = matrix;

  return (
    <Box sx={{ overflow: "auto", maxHeight: "100%" }}>
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: `${NAME_COL}px repeat(${years.length}, ${CELL}px)`,
          alignItems: "center",
          gap: 0.25,
          width: "max-content",
        }}
      >
        {/* Header row: a blank corner, then the year columns. */}
        <Box />
        {years.map((y) => (
          <Typography
            key={y}
            variant="caption"
            sx={{ textAlign: "center", color: "text.secondary" }}
          >
            {String(y).slice(-2)}
          </Typography>
        ))}

        {/* One row per building: the name, then a cell per year. */}
        {rows.map((row) => (
          <Box key={row.building.id} sx={{ display: "contents" }}>
            <Typography
              variant="body2"
              title={buildingDisplayName(row.building)}
              sx={{ ...ellipsis, pr: 1, maxWidth: NAME_COL }}
            >
              {buildingDisplayName(row.building)}
            </Typography>
            {row.cells.map((cell) => {
              const has = cell.value != null;
              const title = cellTitle(buildingDisplayName(row.building), cell);
              return (
                <Tooltip key={cell.year} title={title} arrow>
                  <Box
                    role="button"
                    tabIndex={has ? 0 : -1}
                    aria-label={title}
                    onClick={() => void navigate(buildingRoute(row.building.id))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        void navigate(buildingRoute(row.building.id));
                      }
                    }}
                    sx={{
                      height: CELL,
                      borderRadius: 0.5,
                      cursor: "pointer",
                      backgroundColor: bandColor(cell.band, framing),
                      border: has ? "none" : "1px dashed",
                      borderColor: "divider",
                      "&:focus-visible": {
                        outline: "2px solid",
                        outlineColor: "primary.main",
                        outlineOffset: 1,
                      },
                    }}
                  />
                </Tooltip>
              );
            })}
          </Box>
        ))}
      </Box>
    </Box>
  );
}
