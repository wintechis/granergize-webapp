import type React from "react";
import { useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Link from "@mui/material/Link";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { Building } from "../../types.ts";
import { observationRoute } from "../../routes.ts";
import { useTrailState } from "../../hooks/navTrail.ts";
import { type EnergyMetricKey } from "../../services/energy/energyDataset.ts";
import {
  DEFAULT_METRIC,
  metricLabelKey,
  type MetricFraming,
} from "../../services/energy/energyMetric.ts";
import {
  type EnergyByBuildingYear,
  type LensBand,
  selectableYears,
} from "../../services/energy/energyTimeCut.ts";
import {
  buildPivot,
  BUND_KEY,
  finerLevel,
  type PivotCell,
  type PivotRow,
  type PivotRowLevel,
  scopeLabel,
  UNASSIGNED_KEY,
  withinRegion,
} from "../../services/cube/pivot.ts";
import {
  inToParams,
  resolveCoordinate,
  rowsToParams,
} from "../../services/cube/coordinate.ts";
import { bandColor, bandLabelKey } from "../../constants/lensBand.ts";
import { ellipsis } from "../../constants/listStyles.ts";
import { type MessageId } from "../../lib/messages.ts";
import { RefLink } from "../detail/DetailView.tsx";
import { useT } from "../../context/I18nProvider.tsx";

/**
 * The Observations finder's **pivot** view: the rows × years grid whose ROW LEVEL the
 * user picks — one row per building (the cube's finest feature grain), or per Gemeinde /
 * Kreis / Land, where the cell is the **Ø** over that region's buildings. Where the
 * over-time matrix fixes rows to buildings, this makes the feature axis's roll-up ladder
 * (`notes/observation-cube-sketch.md`) directly navigable; the columns stay years and the
 * cell stays the selected `?m=` metric.
 *
 * A pure render over `buildPivot` (unit-tested) and the same `EnergyByBuildingYear` cube
 * the map's lens loads, so a building-level cell colours identically to the map and the
 * over-time matrix. Building rows drill into `/observation` (as the matrix cells do);
 * a region row's LABEL drills down the ladder instead — one level finer, scoped to that
 * region (`?in=`), with the scope shown as a clearable chip. Picking a level by hand
 * clears the scope: a drill's scope belongs to the row it came from, and keeping it
 * would mislabel coarser rows (fed by only a sub-region's members).
 *
 * Loading is the header indicator's job (CLAUDE.md): a plain "Loading…" / empty-state
 * line while the cube is in flight or empty — no component spinner.
 */

const CELL_H = 28;
const CELL_W = 64;
const NAME_COL = 220;

/** The row-level options, in ladder order (finest first). */
const ROW_LEVELS: { value: PivotRowLevel; label: MessageId }[] = [
  { value: "building", label: "pivotRowsBuilding" },
  { value: "gemeinde", label: "choroplethLevelGemeinde" },
  { value: "kreis", label: "choroplethLevelKreis" },
  { value: "land", label: "choroplethLevelLand" },
  { value: "bund", label: "pivotRowsBund" },
];

/** The cell figure, compacted so a kWh magnitude fits the same column as a per-m²
 *  intensity; the tooltip carries the full number. */
const compact = (v: number) =>
  v.toLocaleString(undefined, { notation: "compact", maximumFractionDigits: 1 });

/** Readable label on the tint: every band swatch is pale except the high-magnitude
 *  dark blue. */
const textOn = (band: LensBand, framing: MetricFraming) =>
  framing === "magnitude" && band === "high" ? "common.white" : "common.black";

interface ObservationsPivotProps {
  buildings: Building[];
  /** The per-building annual cube (from `useAnnualEnergyByYear`). */
  energyByYear: EnergyByBuildingYear | undefined;
  /** The selected observed property (the cube's measure axis). */
  metric?: EnergyMetricKey;
}

export default function ObservationsPivot(
  { buildings, energyByYear, metric = DEFAULT_METRIC }: ObservationsPivotProps,
) {
  const navigate = useNavigate();
  const trailState = useTrailState();
  const t = useT();
  const [searchParams, setSearchParams] = useSearchParams();
  // The held cube coordinate (`services/cube/coordinate.ts`): this grid owns the row
  // level and the drill scope, and MARKS the year column the map's slider holds — the
  // same coordinate, read the same way, so it reads identically across projections.
  const reachableYears = useMemo(
    () => (energyByYear ? selectableYears(energyByYear) : []),
    [energyByYear],
  );
  const { rows: level, scope, year: heldYear } = resolveCoordinate(
    searchParams,
    reachableYears,
  );
  // A hand-picked level clears the scope (see the docblock); a drill sets both.
  const setLevel = (next: PivotRowLevel) =>
    setSearchParams(
      (prev) => inToParams(null, rowsToParams(next, prev)),
      { replace: true },
    );
  const drillInto = (row: PivotRow, finer: PivotRowLevel) =>
    setSearchParams(
      (prev) =>
        inToParams(
          row.key === BUND_KEY ? null : row.key,
          rowsToParams(finer, prev),
        ),
      { replace: true },
    );
  const clearScope = () =>
    setSearchParams((prev) => inToParams(null, prev), { replace: true });

  const grid = useMemo(
    () =>
      energyByYear
        ? buildPivot(
          scope ? withinRegion(buildings, scope) : buildings,
          energyByYear,
          metric,
          level,
        )
        : null,
    [buildings, scope, energyByYear, metric, level],
  );

  // Region rows are unnamed only for the no-AGS bucket and the national row, which are
  // named here (the shaping module stays i18n-free).
  const rowLabel = (row: PivotRow) =>
    row.key === UNASSIGNED_KEY
      ? t("pivotRowUnassigned")
      : row.key === BUND_KEY
      ? t("pivotRowBund")
      : row.label;

  // The cell unit follows the framing: consumption is a per-m² intensity, a generation
  // magnitude is the absolute figure (as in the over-time matrix).
  const cellTitle = (row: PivotRow, cell: PivotCell): string => {
    const shared = {
      feature: rowLabel(row),
      metric: t(metricLabelKey(metric)),
      year: cell.year,
    };
    if (cell.value == null) return t("pivotCellGap", shared);
    const title = t("pivotCellTooltip", {
      ...shared,
      value: Math.round(cell.value).toLocaleString(),
      unit: grid!.framing === "magnitude" ? "kWh" : "kWh/m²/a",
      band: t(bandLabelKey(cell.band, grid!.framing)),
    });
    // A rolled-up cell says what it stands for: the Ø and its member count.
    return level === "building" ? title : `${title} · ${t("pivotCellAverage", { count: cell.n })}`;
  };

  const selector = (
    <Box sx={{ display: "flex", alignItems: "center", gap: 2, mb: 2 }}>
      <TextField
        select
        size="small"
        value={level}
        onChange={(e) => setLevel(e.target.value as PivotRowLevel)}
        label={t("pivotRowsLabel")}
        sx={{ minWidth: 160 }}
      >
        {ROW_LEVELS.map((o) => (
          <MenuItem key={o.value} value={o.value}>{t(o.label)}</MenuItem>
        ))}
      </TextField>
      {/* The drill-down scope: which region the grid is confined to; deleting it
          rolls back out to the unscoped grid at the same level. */}
      {scope && (
        <Chip
          size="small"
          label={t("pivotScope", { region: scopeLabel(buildings, scope) })}
          onDelete={clearScope}
        />
      )}
    </Box>
  );

  if (!grid || grid.years.length === 0) {
    return (
      <Box>
        {selector}
        <Typography variant="body2" color="text.secondary">
          {grid ? t("pivotEmpty") : t("loadingEllipsis")}
        </Typography>
      </Box>
    );
  }

  const { years, rows, framing } = grid;

  return (
    <Box>
      {selector}
      <Box sx={{ overflow: "auto", maxHeight: "100%" }}>
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: `${NAME_COL}px repeat(${years.length}, ${CELL_W}px)`,
            alignItems: "center",
            gap: 0.25,
            width: "max-content",
          }}
        >
          {/* Header row: a blank corner, then the year columns. The held `?y=` column
              (the map slider's time cut) carries the coordinate's emphasis. */}
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
                {y}
              </Typography>
            );
          })}

          {/* One row per feature member: its label, then a cell per year. */}
          {rows.map((row) => {
            const label = rowLabel(row);
            const route = row.building ? observationRoute(row.building.id) : null;
            // A region row's drill target: one level finer, scoped to the row (the
            // no-AGS bucket has no region to scope to, so it doesn't drill).
            const finer = finerLevel(level);
            const drill = !route && row.key !== UNASSIGNED_KEY && finer
              ? () => drillInto(row, finer)
              : null;
            return (
              <Box key={row.key} sx={{ display: "contents" }}>
                <Typography
                  variant="body2"
                  title={label}
                  sx={{ ...ellipsis, pr: 1, maxWidth: NAME_COL }}
                >
                  {route
                    ? <RefLink to={route}>{label}</RefLink>
                    : drill
                    ? (
                      <Link
                        component="button"
                        variant="body2"
                        onClick={drill}
                        aria-label={t("pivotDrillInto", { feature: label })}
                        title={t("pivotDrillInto", { feature: label })}
                      >
                        {label}
                      </Link>
                    )
                    : label}
                </Typography>
                {row.cells.map((cell) => {
                  const has = cell.value != null;
                  const title = cellTitle(row, cell);
                  const go = route
                    // Drill into the observation page, recording the pivot as the back
                    // trail. A region row is a roll-up, not a resource — no target.
                    ? () => void navigate(route, { state: trailState(route) })
                    : undefined;
                  // A region cell has nowhere to drill, so it is a labelled graphic
                  // rather than a dead button.
                  const interactive = go
                    ? {
                      role: "button",
                      tabIndex: has ? 0 : -1,
                      onClick: go,
                      onKeyDown: (e: React.KeyboardEvent) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          go();
                        }
                      },
                    }
                    : { role: "img" };
                  return (
                    <Tooltip key={cell.year} title={title} arrow>
                      <Box
                        {...interactive}
                        aria-label={title}
                        sx={{
                          height: CELL_H,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          borderRadius: 0.5,
                          cursor: go ? "pointer" : "default",
                          backgroundColor: bandColor(cell.band, framing),
                          border: has ? "none" : "1px dashed",
                          borderColor: "divider",
                          "&:focus-visible": {
                            outline: "2px solid",
                            outlineColor: "primary.main",
                            outlineOffset: 1,
                          },
                        }}
                      >
                        <Typography
                          variant="caption"
                          sx={{ color: has ? textOn(cell.band, framing) : "text.secondary" }}
                        >
                          {has ? compact(cell.value!) : "—"}
                        </Typography>
                      </Box>
                    </Tooltip>
                  );
                })}
              </Box>
            );
          })}
        </Box>
      </Box>
    </Box>
  );
}
