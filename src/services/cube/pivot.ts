import { Building } from "../../types.ts";
import { buildingDisplayName } from "../../lib/buildingDisplay.ts";
import { type EnergyMetricKey } from "../energy/energyDataset.ts";
import { categoriserFor } from "../energy/energyCategory.ts";
import {
  DEFAULT_METRIC,
  magnitudeCategoriserFor,
  type MetricFraming,
  metricFraming,
} from "../energy/energyMetric.ts";
import {
  type EnergyByBuildingYear,
  type LensBand,
  selectableYears,
  yearLens,
} from "../energy/energyTimeCut.ts";

/**
 * Pure logic behind the Observations finder's **pivot** view — the parameterized
 * sibling of the over-time matrix (`energy/energyMatrix.ts`, rows fixed to buildings).
 * Here the row axis is a *chosen* level of the cube's feature ladder (building ⊂
 * Gemeinde ⊂ Kreis ⊂ Land ⊂ Bund — see `notes/observation-cube-sketch.md`), columns
 * stay the year axis, and the cell is the selected metric. Moving the row level up the
 * ladder IS the OLAP roll-up: a region cell is the **mean (Ø)** over that region's
 * buildings, carrying `n` so the reader sees how many figures it stands for. The
 * inverse gesture — drilling a region row down one level, scoped to that region — is
 * `finerLevel` + `withinRegion` (the `?in=` axis, `observationsAxes.ts`).
 *
 * React/MUI-free so the shaping is unit-testable; the grid, the colours and the row-level
 * selector live in `components/observation/ObservationsPivot.tsx`. The per-(building,
 * year) value and band come from the SAME `energyTimeCut` primitives the map and the
 * over-time matrix use (`yearLens`), so a building-level pivot cell agrees with them
 * cell-for-cell.
 *
 * The cube is sparse (metrics are pick-and-choose at a user-chosen depth), so the grid is
 * **sparse-pruned**: a row or column whose cells are all gaps is dropped rather than
 * padding the view with empties.
 */

/** The feature level the rows sit at: the finest grain (one building) or an AGS
 *  hierarchy level up to the national roll-up. Doubles as the `?rows=` vocabulary
 *  (`observationsAxes.ts`). */
export type PivotRowLevel = "building" | "gemeinde" | "kreis" | "land" | "bund";

/** The ladder, finest first — the order drilling walks down and rolling up walks up. */
const LADDER: readonly PivotRowLevel[] = [
  "building",
  "gemeinde",
  "kreis",
  "land",
  "bund",
];

/** A region row level — every level but the finest. */
type RegionLevel = Exclude<PivotRowLevel, "building">;

/** AGS prefix length per region level: the German AGS IS the hierarchy (8-digit
 *  Gemeinde ⊂ 5-digit Kreis ⊂ 2-digit Land — `aggregation/regionRollup.ts`; Bund =
 *  the empty prefix, i.e. every building with an AGS at all). */
const AGS_LEN: Record<RegionLevel, number> = {
  gemeinde: 8,
  kreis: 5,
  land: 2,
  bund: 0,
};

/**
 * The building field a region level takes its human-readable name from. A Kreis has no
 * counterpart in the building record, so it stays labelled by its AGS prefix rather than
 * guessing a name from a member's address; the Bund row is a fixed name the renderer
 * supplies.
 */
const NAME_FIELD: Record<RegionLevel, "locality" | "region" | null> = {
  gemeinde: "locality",
  kreis: null,
  land: "region",
  bund: null,
};

/** Row key of the bucket collecting buildings without a usable `regionAgs`; they are
 *  shown as their own row (never silently dropped), named by the renderer. */
export const UNASSIGNED_KEY = "unassigned";

/** Row key of the single national roll-up row at the `bund` level, named by the
 *  renderer (its "AGS prefix" is empty, so the key can't be the prefix itself). */
export const BUND_KEY = "bund";

/** The next level DOWN the ladder (towards buildings) — the drill-down target of a row
 *  at `level`; `null` at the finest grain. */
export function finerLevel(level: PivotRowLevel): PivotRowLevel | null {
  const idx = LADDER.indexOf(level);
  return idx > 0 ? LADDER[idx - 1] : null;
}

/** The buildings inside one region: `regionAgs` starts with the AGS prefix. Buildings
 *  without an AGS are outside every region scope. */
export function withinRegion(buildings: Building[], prefix: string): Building[] {
  return buildings.filter((b) => b.regionAgs?.startsWith(prefix));
}

/** Whether an `?in=` scope prefix is coherent with the row level: it must be COARSER
 *  than the rows (a Kreis scope over Gemeinde rows), else the grid would show one
 *  region row fed by only a sub-region's buildings, mislabelled as the whole region.
 *  Building rows accept any scope; the Bund level none. */
export function prefixValidAt(prefix: string, level: PivotRowLevel): boolean {
  return level === "building" || prefix.length < AGS_LEN[level];
}

/**
 * A scope prefix's display label, read off the scoped buildings the way region rows
 * are labelled: the level's name field on a member that carries it, else the prefix
 * itself (a Kreis has no name field, so it always shows its AGS).
 */
export function scopeLabel(buildings: Building[], prefix: string): string {
  const level = (Object.keys(AGS_LEN) as RegionLevel[])
    .find((l) => AGS_LEN[l] === prefix.length);
  const field = level ? NAME_FIELD[level] : null;
  if (!field) return prefix;
  const named = withinRegion(buildings, prefix).find((b) => b[field]?.trim());
  return named ? named[field]!.trim() : prefix;
}

/** One (feature, year) cell. A year the row has no figure for is a GAP. */
export interface PivotCell {
  year: number;
  /** The selected metric at that year: the building's own value at the finest level,
   * the mean over the region's members above it. `null` for a gap. */
  value: number | null;
  /** How many member buildings contributed a figure (0 for a gap, 1 at building level). */
  n: number;
  /** The band the value falls in — an efficiency tier (consumption) or a neutral
   * magnitude bucket (generation); `"none"` for a gap. */
  band: LensBand;
}

/** One feature member's row: its identity plus a cell per ordered year column. */
export interface PivotRow {
  /** Stable key: the building id at the finest level, else the AGS prefix (or
   * {@link UNASSIGNED_KEY}). */
  key: string;
  /** The label read off the data — the building's display name, the region's name, or
   * its AGS prefix. Empty ONLY for the unassigned bucket and the Bund row, which the
   * renderer names. */
  label: string;
  /** Set only at building level: the building the row stands for (the drill target). */
  building?: Building;
  /** Buildings the row covers (1 at building level) — the Ø's denominator ceiling. */
  members: number;
  cells: PivotCell[];
}

/** The pivot: the row level it was cut at, the year columns, the rows, the framing. */
export interface PivotGrid {
  level: PivotRowLevel;
  /** The year columns, ascending, after sparse pruning. */
  years: number[];
  rows: PivotRow[];
  /** Which framing coloured the cells (tier vs magnitude palette/legend). */
  framing: MetricFraming;
}

/** A row before its cells are computed: the members it rolls up. */
interface RowGroup {
  key: string;
  label: string;
  members: Building[];
}

/** The categoriser for a framing over one peer set — the same tercile machinery the
 *  map's lens uses, reachable for a peer set that isn't per-building. */
function categoriserForFraming(
  peers: number[],
  framing: MetricFraming,
): (value: number | null) => LensBand {
  return framing === "magnitude"
    ? magnitudeCategoriserFor(peers)
    : categoriserFor(peers);
}

/**
 * The rows at a level: one per building (supplied order preserved), or one per AGS
 * prefix. Region rows sort by AGS — geographic order, and stable — with the unassigned
 * bucket last.
 */
function rowGroups(buildings: Building[], level: PivotRowLevel): RowGroup[] {
  if (level === "building") {
    return buildings.map((b) => ({
      key: b.id,
      label: buildingDisplayName(b),
      members: [b],
    }));
  }
  const len = AGS_LEN[level];
  const field = NAME_FIELD[level];
  const byKey = new Map<string, RowGroup>();
  for (const b of buildings) {
    const full = b.regionAgs;
    // Bund: one national row over every building that has an AGS at all (the empty
    // prefix is a real group, not a missing one — hence its own key).
    const ags = full && full.length >= len
      ? (level === "bund" ? BUND_KEY : full.slice(0, len))
      : null;
    const key = ags ?? UNASSIGNED_KEY;
    const group = byKey.get(key);
    if (group) group.members.push(b);
    else {
      const label = ags && level !== "bund" ? ags : "";
      byKey.set(key, { key, label, members: [b] });
    }
  }
  for (const group of byKey.values()) {
    if (group.key === UNASSIGNED_KEY || group.key === BUND_KEY || !field) continue;
    // First member that carries the level's name field; the AGS prefix stands in when
    // none does, so a row always identifies its region.
    const named = group.members.find((b) => b[field]?.trim());
    if (named) group.label = named[field]!.trim();
  }
  return [...byKey.values()].sort((a, b) =>
    a.key === UNASSIGNED_KEY ? 1 : b.key === UNASSIGNED_KEY ? -1 : a.key < b.key ? -1 : 1
  );
}

/** The row's figure in one column: the mean over the members that carry a value, and
 *  how many did. `null`/0 when none did. */
function meanAt(
  members: Building[],
  values: Map<string, number | null>,
): { value: number | null; n: number } {
  let sum = 0;
  let n = 0;
  for (const b of members) {
    const v = values.get(b.id);
    if (v != null) {
      sum += v;
      n++;
    }
  }
  return { value: n === 0 ? null : sum / n, n };
}

/** Drop the all-gap columns and rows (the cube is sparse — an empty band of the grid
 *  carries no information). */
function prune(
  years: number[],
  rows: PivotRow[],
): { years: number[]; rows: PivotRow[] } {
  const keep = years.map((_, c) => rows.some((r) => r.cells[c].value != null));
  return {
    years: years.filter((_, c) => keep[c]),
    rows: rows
      .map((r) => ({ ...r, cells: r.cells.filter((_, c) => keep[c]) }))
      .filter((r) => r.cells.some((c) => c.value != null)),
  };
}

/**
 * Shape `features × years → pivot`. The columns are the union of the reachable
 * buildings' dataset years (`selectableYears`, ascending); the rows are the members at
 * `level`, grouped by AGS prefix above the finest one.
 *
 * Banding differs by level, deliberately: at **building** level the cell takes the
 * map's own per-year lens band, so the pivot and the map agree at a shared (building,
 * year). At a **region** level the cell is a mean, and its peers are the OTHER regions
 * in that column — a mean scored against single-building terciles would collapse
 * towards "typical" and hide the spread between regions. The unassigned bucket is NOT
 * a region, so its mean is scored against the region peers but never shifts them.
 */
export function buildPivot(
  buildings: Building[],
  energyByBuilding: EnergyByBuildingYear,
  metric: EnergyMetricKey = DEFAULT_METRIC,
  level: PivotRowLevel = "building",
): PivotGrid {
  const years = selectableYears(energyByBuilding);
  const framing = metricFraming(metric);
  const ids = new Set(buildings.map((b) => b.id));
  // One lens per year column (thresholds computed once per column, not per cell).
  const lenses = years.map((year) =>
    yearLens(buildings, ids, energyByBuilding, year, metric)
  );

  const groups = rowGroups(buildings, level);
  // Values first: a region column's bands need the whole column of means.
  const figures = groups.map((g) => lenses.map((lens) => meanAt(g.members, lens.values)));
  const regionBands = level === "building" ? null : years.map((_, c) =>
    categoriserForFraming(
      figures
        .map((row, r) =>
          groups[r].key === UNASSIGNED_KEY ? null : row[c].value
        )
        .filter((v): v is number => v != null),
      framing,
    )
  );

  const rows: PivotRow[] = groups.map((group, r) => ({
    key: group.key,
    label: group.label,
    ...(level === "building" ? { building: group.members[0] } : {}),
    members: group.members.length,
    cells: years.map((year, c) => {
      const { value, n } = figures[r][c];
      const band: LensBand = value == null
        ? "none"
        : regionBands
        ? regionBands[c](value)
        : lenses[c].band(group.members[0].id);
      return { year, value, n, band };
    }),
  }));

  return { level, framing, ...prune(years, rows) };
}
