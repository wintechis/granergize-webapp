/**
 * **Materialized cells** — the aggregation snapshots (own, received, benchmark) shaped
 * as extra pivot rows so they render *beside* the live cells they summarise (Step 2 of
 * `plans/plan-cube-centered-ui.md`).
 *
 * A live pivot cell is computed on the fly from the per-building annual cube; a snapshot
 * is the SAME kind of figure already computed and persisted (`notes/aggregations.md`) —
 * an aggregate over a private member set, at a declared period. Both are cells of one
 * cube, so the grid shows them together; what differs is provenance, and a materialized
 * cell carries it (the producing agent for a benchmark, the Ø's member count for every
 * snapshot — principle 4, "every figure is a labelled cell").
 *
 * They are **labelled cells only**: no drill target (a snapshot deliberately hides its
 * members) and no banding — a snapshot must never enter the live rows' tercile peer sets,
 * which are per-column peer comparisons among *buildings/regions*; folding a pre-averaged
 * figure in would shift the thresholds the live cells are scored against. Hence the
 * one-way rule of `notes/detail-vs-statistics.md` applied to our own aggregates.
 *
 * Pure + React-free → Tier-1 testable, like `pivot.ts` whose row shape this mirrors.
 */

/**
 * The snapshot fields a materialized row needs — a structural shape, so an
 * `AggregationSnapshot` (own or received, benchmark or not) is assignable without this
 * module depending on the aggregation domain types.
 */
export interface SnapshotSource {
  /** Stable identity (the aggregation id, or the snapshot IRI for a received one). */
  readonly id: string;
  /** The saved view's name — the row label. */
  readonly name: string;
  /** The computed figure per metric key. */
  readonly values: Record<string, number>;
  /** How many buildings the aggregate stands for (the Ø's n). */
  readonly buildingCount?: number;
  /** The period a benchmark result covers: `YYYY` or `YYYY-MM`. */
  readonly metricPeriod?: string;
  /** The definition's period for a monthly aggregation: `YYYY-MM`. */
  readonly period?: string;
  /** The agent that computed it (a BSP benchmark) — the producer label. */
  readonly computedBy?: string;
}

/** One materialized cell: the snapshot's figure at a year column, or a gap. */
export interface MaterializedCell {
  readonly year: number;
  /** The snapshot's value when this column is a year its period covers, else `null`. */
  readonly value: number | null;
}

/** One snapshot as a pivot row: aligned to the live grid's year columns. */
export interface MaterializedRow {
  /** Stable React key — the snapshot's id. */
  readonly key: string;
  /** The row label: the saved view's name. */
  readonly label: string;
  /** The buildings the aggregate covers (0 when the snapshot didn't record it). */
  readonly members: number;
  /** The producing agent's WebID, set only for a benchmark result. */
  readonly computedBy?: string;
  /** One cell per supplied year column, in the same order. */
  readonly cells: MaterializedCell[];
}

/** The leading `YYYY` of a `YYYY` / `YYYY-MM` period literal, or `null`. */
function periodYear(period: string | undefined): number | null {
  if (!period) return null;
  const match = /^(\d{4})(-\d{2})?$/.exec(period.trim());
  return match ? Number(match[1]) : null;
}

/**
 * The year(s) a snapshot's cells sit at: the benchmark's `metricPeriod` when it declares
 * one, else the definition's monthly `period`. A snapshot that declares NEITHER has no
 * resolvable time coordinate — it is not placed on the year axis at all (rather than
 * guessed from `computedAt`, which is when it was computed, not what it covers).
 */
export function snapshotYears(snapshot: SnapshotSource): number[] {
  const year = periodYear(snapshot.metricPeriod) ?? periodYear(snapshot.period);
  return year === null ? [] : [year];
}

/**
 * Shape the snapshots as extra rows for a pivot cut at `metric` over the `years`
 * columns already on screen.
 *
 * **Sparse-pruned twice over**, mirroring `buildPivot`: a snapshot that doesn't carry
 * the selected metric is omitted (it aggregates a different measure), and so is one
 * whose covered year lies outside the live grid's columns — a row of pure gaps carries
 * no information, and widening the grid for it would move the live cells' columns.
 * The row order is the input order (the caller's tier order: own, then received).
 */
export function materializedRows(
  snapshots: readonly SnapshotSource[],
  metric: string,
  years: readonly number[],
): MaterializedRow[] {
  const rows: MaterializedRow[] = [];
  for (const snapshot of snapshots) {
    const value = snapshot.values?.[metric];
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    const covered = new Set(snapshotYears(snapshot));
    if (covered.size === 0) continue;
    const cells = years.map((year) => ({
      year,
      value: covered.has(year) ? value : null,
    }));
    if (!cells.some((c) => c.value != null)) continue;
    rows.push({
      key: snapshot.id,
      label: snapshot.name,
      members: snapshot.buildingCount ?? 0,
      ...(snapshot.computedBy ? { computedBy: snapshot.computedBy } : {}),
      cells,
    });
  }
  return rows;
}
