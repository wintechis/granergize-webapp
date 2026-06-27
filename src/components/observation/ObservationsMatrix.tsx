import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { BuildingType } from "../../types.ts";
import { buildingDisplayName } from "../../lib/buildingDisplay.ts";
import { observationRoute } from "../../routes.ts";
import { useTrailState } from "../../hooks/navTrail.ts";
import { type EnergyMetricKey } from "../../services/energy/energyDataset.ts";
import { DEFAULT_METRIC } from "../../services/energy/energyMetric.ts";
import {
  buildEnergyMatrix,
  type MatrixCell,
} from "../../services/energy/energyMatrix.ts";
import { type EnergyByBuildingYear } from "../../services/energy/energyTimeCut.ts";
import {
  type EnergyTrend,
  trendForBuildings,
} from "../../services/energy/energyTrend.ts";
import { bandColor, bandLabelKey } from "../../constants/lensBand.ts";
import {
  MARKER_NO_DATA_COLOR,
  TREND_FLAT_COLOR,
  TREND_IMPROVING_COLOR,
  TREND_WORSENING_COLOR,
} from "../../constants/chartColors.ts";
import { ellipsis } from "../../constants/listStyles.ts";
import { type MessageId } from "../../lib/messages.ts";
import { RefLink } from "../detail/DetailView.tsx";
import { useT } from "../../context/I18nProvider.tsx";

/**
 * The Observations finder's **over-time** view: a buildings × years heatmap — rows
 * are buildings, columns are the reachable years, each cell coloured by that
 * building-year's efficiency tier — plus a trailing **Trend** column flagging each
 * building's year-over-year direction (improving / flat / worsening). Where the
 * finder's map shows the whole set at one year (the slider), this shows the whole
 * temporal evolution at once: the per-year state (cells) AND the overall direction
 * (trend) side by side — folding in what was a separate Trend view.
 *
 * A pure render over `buildEnergyMatrix` + `trendForBuildings` (both unit-tested) and
 * the same `EnergyByBuildingYear` cube the map's energy lens loads — so the panel and
 * the map colour identically at a shared (building, year). The building name and each
 * cell navigate to `/observation/:id` (the energy detail — the finder hands off to the
 * observation leaf, consistent with the map markers); the panel is a finder, it
 * doesn't own selection state. Tier + trend colours reuse the shared palettes.
 *
 * Loading is the header indicator's job (CLAUDE.md): the panel shows a plain
 * "Loading…" / empty-state line while the cube is in flight or empty — no
 * component spinner.
 */

const CELL = 28;
const NAME_COL = 200;
const TREND_COL = 130;

/** Trend → its colour (the colourblind-safe diverging palette) + i18n label key. */
const TREND_META: Record<EnergyTrend, { color: string; label: MessageId }> = {
  improving: { color: TREND_IMPROVING_COLOR, label: "trendImproving" },
  flat: { color: TREND_FLAT_COLOR, label: "trendFlat" },
  worsening: { color: TREND_WORSENING_COLOR, label: "trendWorsening" },
  unknown: { color: MARKER_NO_DATA_COLOR, label: "trendUnknown" },
};

interface ObservationsMatrixProps {
  buildings: BuildingType[];
  /** The per-building annual cube (from `useAnnualEnergyByYear`). */
  energyByYear: EnergyByBuildingYear | undefined;
  /** Ids the lens frames its per-year peer set against (the visible set). */
  visibleIds: ReadonlySet<string>;
  /** The selected observed property (the cube's measure axis). */
  metric?: EnergyMetricKey;
}

export default function ObservationsMatrix(
  { buildings, energyByYear, visibleIds, metric = DEFAULT_METRIC }: ObservationsMatrixProps,
) {
  const navigate = useNavigate();
  const trailState = useTrailState();
  // Drill into the observation page, recording the matrix as the back trail.
  const go = (route: string) => navigate(route, { state: trailState(route) });
  const t = useT();
  const matrix = useMemo(
    () =>
      energyByYear
        ? buildEnergyMatrix(buildings, energyByYear, visibleIds, metric)
        : null,
    [buildings, energyByYear, visibleIds, metric],
  );
  // The folded-in trend column: each building's year-over-year direction on the same
  // metric (the distiller is unit-tested; here it just colours a dot + label).
  const trends = useMemo(
    () =>
      energyByYear ? trendForBuildings(buildings, energyByYear, metric) : null,
    [buildings, energyByYear, metric],
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
          gridTemplateColumns:
            `${NAME_COL}px repeat(${years.length}, ${CELL}px) ${TREND_COL}px`,
          alignItems: "center",
          gap: 0.25,
          width: "max-content",
        }}
      >
        {/* Header row: a blank corner, the year columns, then the Trend column. */}
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
        <Typography
          variant="caption"
          sx={{ pl: 1, color: "text.secondary" }}
        >
          {t("obsViewTrend")}
        </Typography>

        {/* One row per building: the name, a cell per year, then the trend. */}
        {rows.map((row) => {
          const trendMeta = TREND_META[trends?.get(row.building.id) ?? "unknown"];
          return (
            <Box key={row.building.id} sx={{ display: "contents" }}>
              <Typography
                variant="body2"
                title={buildingDisplayName(row.building)}
                sx={{ ...ellipsis, pr: 1, maxWidth: NAME_COL }}
              >
                <RefLink to={observationRoute(row.building.id)}>
                  {buildingDisplayName(row.building)}
                </RefLink>
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
                      onClick={() => void go(observationRoute(row.building.id))}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          void go(observationRoute(row.building.id));
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
              {/* Trend: this building's year-over-year direction (the folded-in
                  Trend view) — a colour-coded dot + label. */}
              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 0.75,
                  pl: 1,
                  minWidth: 0,
                }}
              >
                <Box
                  sx={{
                    width: 10,
                    height: 10,
                    borderRadius: "50%",
                    backgroundColor: trendMeta.color,
                    flexShrink: 0,
                  }}
                />
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={ellipsis}
                >
                  {t(trendMeta.label)}
                </Typography>
              </Box>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
