import type React from "react";
import { useCallback, useMemo } from "react";
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
import {
  DEFAULT_METRIC,
  metricLabelKey,
  type MetricFraming,
  type SelectableMetricKey,
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
import {
  materializedRows,
  type SnapshotSource,
} from "../../services/cube/snapshotCells.ts";
import {
  regionalGrainFor,
  type RegionalRow,
  regionalRows,
} from "../../services/cube/regionalCells.ts";
import {
  useAggregationDefinitions,
  useAggregationSnapshots,
} from "../../hooks/queries.ts";
import {
  useBuildingsWithRegionAgs,
  useRegionalPivotTables,
} from "../../hooks/regional.ts";
import { regionalTableDataUrl } from "../../services/sources/regionalCube.ts";
import { bandColor, bandLabelKey } from "../../constants/lensBand.ts";
import { ellipsis } from "../../constants/listStyles.ts";
import { type MessageId } from "../../lib/messages.ts";
import { RdfSourceLink, RefLink } from "../detail/DetailView.tsx";
import { useT } from "../../context/I18nProvider.tsx";

/**
 * The Observations finder's **pivot** view: the rows × years grid whose ROW LEVEL the
 * user picks — one row per building (the cube's finest feature grain), or per Gemeinde /
 * Kreis / Land, where the cell is the **Ø** over that region's buildings. Where the
 * over-time matrix fixes rows to buildings, this makes the feature axis's roll-up ladder
 * (`notes/observation-cube-sketch.md`) directly navigable; the columns stay years and the
 * cell stays the selected `?m=` metric.
 *
 * Below the live rows sits the **materialized** section: the aggregation snapshots the
 * user can read (own, received, benchmarks) shaped by `cube/snapshotCells.ts` — figures
 * someone already computed, placed at the year their period covers. They are labelled
 * cells only: no drill (a snapshot hides its members by design), no tint, and they never
 * enter the live rows' tercile peer sets. Their figure is the aggregate as stored (kWh),
 * not the per-m² intensity the live consumption cells show, so the tooltip says so.
 *
 * Below THAT, at a Land/Kreis row level, sits the **official statistics** section — the
 * external `qb:` cells of `linked-regionalstatistik` shaped by `cube/regionalCells.ts`:
 * the cube's drill-across. Same one-way rule as the snapshots (labelled, flat, never in
 * a peer set), except each row is a different *measure* — so it names its indicator and
 * its own unit, and cites the statistical offices as its source.
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
  metric?: SelectableMetricKey;
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

  // The region join key: a loaded building stores only its `dcterms:spatial` concept,
  // so the bare AGS the ladder groups by is resolved from it (the shared hook the map's
  // choropleth uses). Gated on the join being needed — a plain building-level grid with
  // no scope never asks.
  const located = useBuildingsWithRegionAgs(
    buildings,
    level !== "building" || Boolean(scope),
  );

  const grid = useMemo(
    () =>
      energyByYear
        ? buildPivot(
          scope ? withinRegion(located, scope) : located,
          energyByYear,
          metric,
          level,
        )
        : null,
    [located, scope, energyByYear, metric, level],
  );

  // Region rows are unnamed only for the no-AGS bucket and the national row, which are
  // named here (the shaping module stays i18n-free).
  const rowLabel = useCallback(
    (row: PivotRow) =>
      row.key === UNASSIGNED_KEY
        ? t("pivotRowUnassigned")
        : row.key === BUND_KEY
        ? t("pivotRowBund")
        : row.label,
    [t],
  );

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

  // The materialized cells: every readable snapshot (own + received + benchmarks),
  // joined with its definition's monthly period where it has one (a snapshot records
  // only a benchmark's `metricPeriod`), then shaped against this grid's year columns.
  // The fan-out is gated on this view being mounted — the pivot IS the explicit act.
  const snapshotsQuery = useAggregationSnapshots();
  const definitionsQuery = useAggregationDefinitions();
  const periodById = useMemo(() => {
    const map = new Map<string, string>();
    for (const d of definitionsQuery.data ?? []) if (d.period) map.set(d.id, d.period);
    return map;
  }, [definitionsQuery.data]);
  const snapshotSources: SnapshotSource[] = useMemo(
    () =>
      (snapshotsQuery.data ?? []).map((s) => ({
        id: s.id,
        name: s.name,
        values: s.values,
        buildingCount: s.buildingCount,
        metricPeriod: s.metricPeriod,
        period: periodById.get(s.id),
        computedBy: s.computedBy,
      })),
    [snapshotsQuery.data, periodById],
  );
  const materialized = useMemo(
    () => materializedRows(snapshotSources, metric, grid?.years ?? []),
    [snapshotSources, metric, grid],
  );

  // A materialized cell's label: the full coordinate, the Ø's member count, and — for a
  // benchmark — the agent that produced it (principle 4: every figure is labelled).
  const snapshotTitle = (
    row: (typeof materialized)[number],
    year: number,
    value: number | null,
  ): string => {
    const shared = { feature: row.label, metric: t(metricLabelKey(metric)), year };
    if (value == null) return t("pivotCellGap", shared);
    const parts = [
      t("pivotSnapshotTooltip", {
        name: row.label,
        metric: t(metricLabelKey(metric)),
        year,
        value: Math.round(value).toLocaleString(),
        unit: "kWh",
      }),
    ];
    if (row.members > 0) parts.push(t("pivotCellAverage", { count: row.members }));
    if (row.computedBy) parts.push(t("pivotSnapshotBy", { agent: row.computedBy }));
    return parts.join(" · ");
  };

  // The external cells: the official regional statistics (`qb:`) for the regions on
  // screen — the cube's DRILL-ACROSS (`services/cube/regionalCells.ts`). A second
  // cube sharing our feature + time axes but not the property axis, so its rows carry
  // their own indicator name and unit, and no tint/drill. Fetched only where the two
  // cubes meet (a Land/Kreis row level), one GET per table.
  const regionalTables = useRegionalPivotTables(regionalGrainFor(level));
  const regional = useMemo(
    () =>
      regionalRows(
        regionalTables,
        (grid?.rows ?? []).map((r) => ({ key: r.key, label: rowLabel(r) })),
        grid?.years ?? [],
        level,
      ),
    [regionalTables, grid, rowLabel, level],
  );
  // An external cell's label: region, indicator, year, figure and ITS unit — the
  // full coordinate, since this row's measure is not the grid's selected metric.
  const regionalTitle = (row: RegionalRow, year: number, value: number | null): string => {
    const shared = { feature: row.regionLabel, metric: t(row.labelId), year };
    return value == null ? t("pivotCellGap", shared) : t("pivotOfficialCell", {
      region: row.regionLabel,
      indicator: t(row.labelId),
      year,
      value: value.toLocaleString(undefined, { maximumFractionDigits: 2 }),
      unit: row.unit,
    });
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
          label={t("pivotScope", { region: scopeLabel(located, scope) })}
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

          {/* The materialized section: already-computed figures, set apart by a
              section label and rendered flat (no band tint, no drill target). */}
          {materialized.length > 0 && (
            <>
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ gridColumn: "1 / -1", mt: 2 }}
              >
                {t("pivotMaterialized")}
              </Typography>
              {materialized.map((row) => (
                <Box key={row.key} sx={{ display: "contents" }}>
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    title={row.label}
                    sx={{ ...ellipsis, pr: 1, maxWidth: NAME_COL }}
                  >
                    {row.label}
                  </Typography>
                  {row.cells.map((cell) => {
                    const has = cell.value != null;
                    const title = snapshotTitle(row, cell.year, cell.value);
                    return (
                      <Tooltip key={cell.year} title={title} arrow>
                        <Box
                          role="img"
                          aria-label={title}
                          sx={{
                            height: CELL_H,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            borderRadius: 0.5,
                            backgroundColor: has ? "action.hover" : undefined,
                            border: has ? "none" : "1px dashed",
                            borderColor: "divider",
                          }}
                        >
                          <Typography variant="caption" color="text.secondary">
                            {has ? compact(cell.value!) : "—"}
                          </Typography>
                        </Box>
                      </Tooltip>
                    );
                  })}
                </Box>
              ))}
            </>
          )}

          {/* The drill-across section: official statistics for the regions on
              screen — labelled rows in their own indicator + unit, flat (no band
              tint, no drill), with the statistics office cited as the source. */}
          {regional.length > 0 && (
            <>
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ gridColumn: "1 / -1", mt: 2 }}
              >
                {t("pivotOfficial")}
              </Typography>
              {regional.map((row) => {
                const label = t("pivotOfficialRow", {
                  region: row.regionLabel,
                  indicator: t(row.labelId),
                  unit: row.unit,
                });
                return (
                  <Box key={row.key} sx={{ display: "contents" }}>
                    <Typography
                      variant="body2"
                      color="text.secondary"
                      title={label}
                      sx={{ ...ellipsis, pr: 1, maxWidth: NAME_COL }}
                    >
                      {label}
                    </Typography>
                    {row.cells.map((cell) => {
                      const has = cell.value != null;
                      const title = regionalTitle(row, cell.year, cell.value);
                      return (
                        <Tooltip key={cell.year} title={title} arrow>
                          <Box
                            role="img"
                            aria-label={title}
                            sx={{
                              height: CELL_H,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              borderRadius: 0.5,
                              backgroundColor: has ? "action.hover" : undefined,
                              border: has ? "none" : "1px dashed",
                              borderColor: "divider",
                            }}
                          >
                            <Typography variant="caption" color="text.secondary">
                              {has ? compact(cell.value!) : "—"}
                            </Typography>
                          </Box>
                        </Tooltip>
                      );
                    })}
                  </Box>
                );
              })}
              {/* Provenance (the agent axis: the statistical offices), plus the
                  dereferenceable table documents in Developer mode. */}
              <Box sx={{ gridColumn: "1 / -1", mt: 1 }}>
                <Typography variant="body2" color="text.secondary">
                  {t("regDataSource")}
                </Typography>
                {[...new Set(regional.map((r) => r.tableId))].map((tableId) => (
                  <RdfSourceLink key={tableId} href={regionalTableDataUrl(tableId)} />
                ))}
              </Box>
            </>
          )}
        </Box>
      </Box>
    </Box>
  );
}
