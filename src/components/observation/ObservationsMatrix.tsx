import { useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import Box from "@mui/material/Box";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import TimelineIcon from "@mui/icons-material/Timeline";
import { Building } from "../../types.ts";
import { buildingDisplayName } from "../../lib/buildingDisplay.ts";
import { splitEnergyDatasets } from "../../lib/energyResolution.ts";
import { observationRoute } from "../../routes.ts";
import { useTrailState } from "../../hooks/navTrail.ts";
import IconAction from "../IconAction.tsx";
import { seriesToParams } from "../../services/cube/observationsAxes.ts";
import {
  DEFAULT_METRIC,
  metricValueUnit,
  type SelectableMetricKey,
} from "../../services/energy/energyMetric.ts";
import {
  buildEnergyMatrix,
  type MatrixCell,
} from "../../services/energy/energyMatrix.ts";
import {
  type EnergyByBuildingYear,
  selectableYears,
} from "../../services/energy/energyTimeCut.ts";
import { resolveYear } from "../../services/cube/coordinate.ts";
import {
  type BuildingTrend,
  trendForBuildings,
} from "../../services/energy/energyTrend.ts";
import { bandColor, bandLabelKey } from "../../constants/lensBand.ts";
import { LEGEND_TRENDS, TREND_COLOR, TREND_LABEL } from "../../constants/trends.ts";
import { ellipsis } from "../../constants/listStyles.ts";
import { formatNumberMax, formatSignedPercent } from "../../lib/formatNumber.ts";
import { BandKeys, LegendKeys } from "../Legend.tsx";
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
 * The two colours on screen mean **opposite things**, which is why the panel carries
 * its own legend and two hints rather than leaving them to be guessed: a CELL is
 * peer-relative (this building against the others shown *in that year*, so filtering
 * re-frames it), a TREND dot is self-relative (this building against its own prior
 * year, so filtering does not). The trend dot's tooltip states the two years and the
 * actual change; the Handbuch carries the full explanation (terciles, the ±5 % flat
 * band, why intensity rather than absolute).
 *
 * A pure render over `buildEnergyMatrix` + `trendForBuildings` (both unit-tested) and
 * the same `EnergyByBuildingYear` cube the map's energy lens loads — so the panel and
 * the map colour identically at a shared (building, year). The building name and each
 * cell navigate to `/observation/:id` (the energy detail — the finder hands off to the
 * observation leaf, consistent with the map markers); the panel is a finder, it
 * doesn't own selection state. Tier + trend colours reuse the shared palettes
 * (`lensBand.ts` / `trends.ts`) and the legend reuses the shared `Legend` keys.
 *
 * A row whose building carries sub-hourly datasets also offers the **time drill**
 * (`?series=`): the finer grain under the year columns, opened as a panel below the
 * grid by the finder. Sparse, like the cube — a building with only annual data has no
 * finer grain, so it gets no affordance.
 *
 * Loading is the header indicator's job (CLAUDE.md): the panel shows a plain
 * "Loading…" / empty-state line while the cube is in flight or empty — no
 * component spinner.
 */

const CELL = 28;
const NAME_COL = 200;
const TREND_COL = 130;

interface ObservationsMatrixProps {
  buildings: Building[];
  /** The per-building annual cube (from `useAnnualEnergyByYear`). */
  energyByYear: EnergyByBuildingYear | undefined;
  /** Ids the lens frames its per-year peer set against (the visible set). */
  visibleIds: ReadonlySet<string>;
  /** The selected observed property (the cube's measure axis). */
  metric?: SelectableMetricKey;
}

export default function ObservationsMatrix(
  { buildings, energyByYear, visibleIds, metric = DEFAULT_METRIC }: ObservationsMatrixProps,
) {
  const navigate = useNavigate();
  const trailState = useTrailState();
  // Drill into the observation page, recording the matrix as the back trail.
  const go = (route: string) => navigate(route, { state: trailState(route) });
  const t = useT();
  const [searchParams, setSearchParams] = useSearchParams();
  // The time DRILL (`?series=`): descend from this row to the building's sub-hourly
  // series, which the finder renders as a panel below the grid. Offered only where such
  // cells exist (the cube is sparse — a building with no `PT15M` dataset has no finer
  // grain to descend to), and written like every other axis: replace, own key only.
  const openSeries = (b: Building) =>
    setSearchParams((prev) => seriesToParams(b.id, prev), { replace: true });
  // The held time cut of the cube coordinate (`services/cube/coordinate.ts`) — the same
  // `?y=` the map slider writes (absent → the latest reachable year). This view spans
  // every year, so it only MARKS that column; it never writes the year.
  const heldYear = useMemo(
    () =>
      resolveYear(searchParams, energyByYear ? selectableYears(energyByYear) : []),
    [searchParams, energyByYear],
  );
  const matrix = useMemo(
    () =>
      energyByYear
        ? buildEnergyMatrix(buildings, energyByYear, visibleIds, metric)
        : null,
    [buildings, energyByYear, visibleIds, metric],
  );
  // The folded-in trend column: each building's year-over-year direction on the same
  // metric, with the two years + the change behind it (the distiller is unit-tested;
  // here they colour a dot and fill the tooltip).
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
    const magnitude = matrix!.framing === "magnitude";
    const value = formatNumberMax(cell.value, magnitude ? 0 : 1);
    return `${name} — ${cell.year}: ${value} ${metricValueUnit(metric)} (${band})`;
  };

  // The trend's facts, not a restatement of its label: which two years were compared
  // and by how much the figure moved. A building without two comparable years says so.
  const trendTitle = (name: string, d: BuildingTrend | undefined): string =>
    d?.delta == null || d.priorYear == null || d.currentYear == null
      ? t("obsTrendTooltipUnknown")
      : t("obsTrendTooltip", {
        name,
        from: d.priorYear,
        to: d.currentYear,
        change: formatSignedPercent(d.delta),
        unit: metricValueUnit(metric),
      });

  if (!matrix) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
        {t("loadingEllipsis")}
      </Typography>
    );
  }
  if (matrix.years.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
        {t("obsMatrixEmpty")}
      </Typography>
    );
  }

  const { years, rows, framing } = matrix;
  const trendItems = LEGEND_TRENDS.map((tr) => ({
    color: TREND_COLOR[tr],
    label: t(TREND_LABEL[tr]),
  }));

  return (
    <Box>
      {/* The grid can be wider than the panel, so it scrolls horizontally on its own —
          the legend below must sit OUTSIDE this box or it slides away with the years. */}
      <Box sx={{ overflow: "auto" }}>
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
          {/* Header row: a blank corner, the year columns, then the Trend column. The
              held `?y=` column (the map slider's time cut) carries the coordinate's
              emphasis, exactly as the pivot marks it. */}
          <Box />
          {years.map((y) => {
            const held = y === heldYear;
            return (
              <Typography
                key={y}
                variant="caption"
                title={held ? t("cubeHeldYear") : undefined}
                sx={{
                  textAlign: "center",
                  color: held ? "text.primary" : "text.secondary",
                  borderBottom: "2px solid",
                  // Transparent off the held column, so marking it shifts no layout.
                  borderColor: held ? "primary.main" : "transparent",
                }}
              >
                {String(y).slice(-2)}
              </Typography>
            );
          })}
          <Typography
            variant="caption"
            sx={{ pl: 1, color: "text.secondary" }}
          >
            {t("obsViewTrend")}
          </Typography>

          {/* One row per building: the name, a cell per year, then the trend. */}
          {rows.map((row) => {
            const name = buildingDisplayName(row.building);
            const detail = trends?.get(row.building.id);
            const trendColor = TREND_COLOR[detail?.trend ?? "unknown"];
            const trendLabel = t(TREND_LABEL[detail?.trend ?? "unknown"]);
            const hasSeries =
              splitEnergyDatasets(row.building.energyDatasets).series.length > 0;
            return (
              <Box key={row.building.id} sx={{ display: "contents" }}>
                <Box
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 0.5,
                    pr: 1,
                    maxWidth: NAME_COL,
                    minWidth: 0,
                  }}
                >
                  <Typography
                    variant="body2"
                    title={name}
                    sx={{ ...ellipsis, minWidth: 0 }}
                  >
                    <RefLink to={observationRoute(row.building.id)}>{name}</RefLink>
                  </Typography>
                  {hasSeries && (
                    <IconAction
                      label={t("seriesDrillAria", { building: name })}
                      icon={<TimelineIcon fontSize="small" />}
                      onClick={() => openSeries(row.building)}
                    />
                  )}
                </Box>
                {row.cells.map((cell) => {
                  const has = cell.value != null;
                  const title = cellTitle(name, cell);
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
                {/* Trend: this building's year-over-year direction — a colour-coded dot
                    + label, with the compared years and the change in the tooltip.
                    Deliberately NOT a button: the cells own the drill-down, and giving
                    this a role would put it in their locator. */}
                <Tooltip title={trendTitle(name, detail)} arrow>
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
                        backgroundColor: trendColor,
                        flexShrink: 0,
                      }}
                    />
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={ellipsis}
                    >
                      {trendLabel}
                    </Typography>
                  </Box>
                </Tooltip>
              </Box>
            );
          })}
        </Box>
      </Box>

      {/* Two colour keys, because two colour systems are on screen: what a CELL's
          colour means, and what the trend dot means. */}
      <Box
        sx={{
          mt: 1.5,
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          columnGap: 3,
          rowGap: 1,
        }}
      >
        <BandKeys framing={framing} row title={t("obsLegendCells")} />
        <LegendKeys items={trendItems} shape="dot" row title={t("obsViewTrend")} />
      </Box>

      {/* …and the one thing the swatches can't show: the cells are peer-relative and
          re-frame as you filter, the trend is self-relative and doesn't. */}
      <Box sx={{ mt: 0.5 }}>
        <Typography variant="body2" color="text.secondary">
          {t("obsLegendCellsHint")}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {t("obsLegendTrendHint")}
        </Typography>
      </Box>
    </Box>
  );
}
