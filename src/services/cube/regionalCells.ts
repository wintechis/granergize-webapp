/**
 * **External cells** — the official regional statistics (`linked-regionalstatistik`,
 * an RDF Data Cube) shaped as extra pivot rows so they render *beside* the live grid
 * (Step 2 of `plans/plan-explore-complete-cube.md`).
 *
 * This is the cube's **drill-across**: a second cube that shares the feature axis
 * (German AGS regions) and the time axis (years) with ours, but NOT the property
 * axis — its measures are indicators of their own (renewable share %, primary energy
 * TJ, heat-pump permits), each in its own unit. So they are **labelled rows with
 * their own unit**, never same-metric cells: no drill target, no banding, and never
 * part of the live rows' tercile peer sets — the one-way rule of
 * `notes/detail-vs-statistics.md`, the same discipline `snapshotCells.ts` applies to
 * our own aggregates.
 *
 * Rows only exist where the two cubes actually meet: the row level must be a grain
 * the source publishes (`land` / `kreis` — the wrapper has nothing below Kreis), the
 * region must be one the live grid shows, and the figures are **sparse-pruned to the
 * grid's year columns** — an all-gap row is dropped and the grid is NEVER widened
 * (widening it for an external series would move the live cells' columns).
 *
 * Pure + React-free → Tier-1 testable: it carries the indicator's catalog `labelId`
 * rather than resolved text, so the renderer does the translating.
 */
import {
  REGIONAL_UNIT_DISPLAY,
  type RegionalObservation,
} from "../sources/regionalCube.ts";
import type { MessageId } from "../../lib/messages.ts";
import { BUND_KEY, type PivotRowLevel, UNASSIGNED_KEY } from "./pivot.ts";

/** The AGS grains the external cube publishes (`RegionalTable.grain`). */
export type RegionalGrain = "land" | "kreis";

/**
 * The pivot row level a table grain must match for the two cubes to meet: `land`
 * rows join Land tables, `kreis` rows join Kreis tables. Every other level —
 * building, Gemeinde (finer than the source publishes) and Bund (coarser) — has no
 * counterpart, so the section is absent there rather than approximated.
 */
export function regionalGrainFor(level: PivotRowLevel): RegionalGrain | null {
  return level === "land" || level === "kreis" ? level : null;
}

/**
 * One fetched table: its identity + every region's full year series, keyed by bare
 * AGS (the shape `fetchRegionalSeries` returns — one GET per table).
 */
export interface RegionalTableSeries {
  /** GENESIS table id — the row identity's second half, and the source link. */
  readonly tableId: string;
  /** Catalog id for the indicator label (resolved by the renderer). */
  readonly labelId: MessageId;
  /** The AGS grain its geo dimension uses. */
  readonly grain: RegionalGrain;
  /** AGS → the region's observations, ascending by year. */
  readonly byRegion: ReadonlyMap<string, readonly RegionalObservation[]>;
}

/** A live grid row the section may join: its AGS key and its rendered label. */
export interface RegionalRegion {
  /** The pivot row's key — at a region level the AGS prefix itself. */
  readonly key: string;
  /** The row's label as the grid shows it (the region name, or its AGS). */
  readonly label: string;
}

/** One external cell: the indicator's figure at a year column, or a gap. */
export interface RegionalCell {
  readonly year: number;
  readonly value: number | null;
}

/** One (region, indicator) pair as a pivot row, aligned to the grid's columns. */
export interface RegionalRow {
  /** Stable React key: region key + table id (a region shows one row per table). */
  readonly key: string;
  /** The live grid row's label this row sits beside. */
  readonly regionLabel: string;
  /** The source table — its data IRI is the Developer-mode source link. */
  readonly tableId: string;
  /** Catalog id of the indicator name (the row's "metric" half). */
  readonly labelId: MessageId;
  /** The figures' unit, in display form (`REGIONAL_UNIT_DISPLAY`, else as served). */
  readonly unit: string;
  /** One cell per supplied year column, in the same order. */
  readonly cells: RegionalCell[];
}

/**
 * Shape the fetched tables as extra rows for a pivot cut at `level` over the `years`
 * columns already on screen, one row per (region, table).
 *
 * Order is region-major (the grid's row order), then the tables' input order, so an
 * indicator sits directly under the region it is about. The unassigned bucket and
 * the Bund row are skipped: neither is an AGS region the external cube knows.
 */
export function regionalRows(
  tables: readonly RegionalTableSeries[],
  regions: readonly RegionalRegion[],
  years: readonly number[],
  level: PivotRowLevel,
): RegionalRow[] {
  const grain = regionalGrainFor(level);
  if (!grain || years.length === 0) return [];

  const rows: RegionalRow[] = [];
  for (const region of regions) {
    if (region.key === UNASSIGNED_KEY || region.key === BUND_KEY) continue;
    for (const table of tables) {
      if (table.grain !== grain) continue;
      const series = table.byRegion.get(region.key);
      if (!series || series.length === 0) continue;
      const byYear = new Map(series.map((o) => [o.year, o]));
      const cells = years.map((year) => ({
        year,
        value: byYear.get(year)?.value ?? null,
      }));
      // Sparse pruning: a row of pure gaps carries no information, and the grid's
      // columns are the live cells' — never widened to fit an external series.
      if (!cells.every((c) => c.value == null)) {
        // The unit of a figure actually on screen, else the series' own (a table
        // reports one unit throughout, but a gap-only column must not decide it).
        const unit = years.map((y) => byYear.get(y)).find((o) => o?.unit)?.unit ??
          series.find((o) => o.unit)?.unit ?? "";
        rows.push({
          key: `${region.key}:${table.tableId}`,
          regionLabel: region.label,
          tableId: table.tableId,
          labelId: table.labelId,
          unit: REGIONAL_UNIT_DISPLAY[unit] ?? unit,
          cells,
        });
      }
    }
  }
  return rows;
}
