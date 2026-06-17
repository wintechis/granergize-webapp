import { CHART_COLOR_PALETTE } from "../../constants/chartColors.ts";

/**
 * Pure binning behind the **calendar heatmap** (Step 5 of `plans/plan-cube-ui.md`):
 * collapse a `PT15M` series — a month of day files, each a list of 15-minute
 * `{ begin, value }` readings — into a **day × hour** grid. The line chart shows a
 * load profile *within* a day; flattening the time axis onto a (day, hour) grid
 * reveals the recurring patterns *across* days (a daily peak hour, a weekend dip)
 * that a line hides. Everything here is React/Recharts-free so the binning and the
 * colour scale are unit-testable in isolation; the grid render lives in
 * `CalendarHeatmap.tsx`.
 *
 * One cell = the **summed** kWh of the (up to four) 15-minute readings whose
 * `begin` timestamp falls in that hour of that day — the hour's energy, the same
 * additive proxy the daily-totals chart uses. A day/hour with no reading is a hole
 * (`value: null`, rendered neutral), so the grid honestly shows coverage gaps.
 *
 * Reading timestamps are taken at FACE VALUE (the local wall-clock substring), not
 * converted across time zones — the series files already store local timestamps and
 * the daily/profile charts slice the same `begin.substring(11, 16)` slot, so the
 * heatmap stays in step with them.
 */

/** One reading: an ISO-ish `begin` timestamp and a kWh value (mirrors
 * `parseTtlReadings`' output). */
export interface Reading {
  begin: string;
  value: number;
}

/** A month of day files keyed by `YYYY-MM-DD` day → that day's readings (the
 * shape `useMonthReadings` returns). */
export type ReadingsByDay = Map<string, Reading[]>;

/** One grid cell: the day, the hour-of-day (0–23), and the summed kWh — `null`
 * when no reading fell in that hour (a coverage hole). */
export interface CalendarCell {
  day: string;
  hour: number;
  value: number | null;
}

/** One grid row: a day and its 24 hour cells (ascending hour). */
export interface CalendarRow {
  day: string;
  cells: CalendarCell[];
}

/** The binned grid: the day rows (ascending), the value range across non-empty
 * cells (for the colour scale), and a flag for the all-empty case. */
export interface CalendarGrid {
  rows: CalendarRow[];
  /** Smallest non-null cell value, or `null` when the grid is empty. */
  min: number | null;
  /** Largest non-null cell value, or `null` when the grid is empty. */
  max: number | null;
}

const HOURS = 24;

/** Hour-of-day (0–23) of a reading, read from the local wall-clock substring
 * (`...T13:45...` → 13). Returns `null` for a timestamp that has no parseable
 * hour, so a malformed reading is dropped rather than mis-binned. */
function hourOf(begin: string): number | null {
  // The hour lives at offset 11–12 in an ISO `YYYY-MM-DDTHH:mm` timestamp.
  const hh = begin.substring(11, 13);
  if (!/^\d{2}$/.test(hh)) return null;
  const h = Number(hh);
  return h >= 0 && h < HOURS ? h : null;
}

/**
 * Bin a month of day files into a day × hour grid. Days come out ascending
 * (lexicographic on `YYYY-MM-DD` = chronological); each row carries exactly 24
 * cells (hour 0–23), every reading summed into its (day, hour) cell, and any hour
 * with no reading left `null`. Pure — same input, same grid.
 */
export function buildCalendarGrid(readingsByDay: ReadingsByDay): CalendarGrid {
  const days = [...readingsByDay.keys()].sort((a, b) => a.localeCompare(b));

  let min: number | null = null;
  let max: number | null = null;

  const rows: CalendarRow[] = days.map((day) => {
    // Per-hour accumulator: sum + a seen flag so an hour with readings summing to
    // exactly 0 stays a real cell, distinct from an untouched (null) hour.
    const sums = new Array<number>(HOURS).fill(0);
    const seen = new Array<boolean>(HOURS).fill(false);

    for (const r of readingsByDay.get(day) ?? []) {
      const h = hourOf(r.begin);
      if (h == null) continue;
      sums[h] += r.value;
      seen[h] = true;
    }

    const cells: CalendarCell[] = [];
    for (let h = 0; h < HOURS; h++) {
      const value = seen[h] ? sums[h] : null;
      if (value != null) {
        if (min == null || value < min) min = value;
        if (max == null || value > max) max = value;
      }
      cells.push({ day, hour: h, value });
    }
    return { day, cells };
  });

  return { rows, min, max };
}

/**
 * A **sequential colour scale** over `[min, max]`: a low-to-high ramp from a pale
 * tint of the chart's primary blue up to the full-saturation blue, so a darker
 * cell reads as a higher hour. Reuses the shared chart palette's blue
 * (`CHART_COLOR_PALETTE[1]`) rather than minting a new hue, keeping the heatmap in
 * the app's chart family. `null`/out-of-range values get a neutral transparent
 * (the caller renders coverage holes that way).
 *
 * Returned as a `(value) => cssColor` closure so the render maps each cell in one
 * call; degenerate ranges (a single value, or `min === max`) map everything to the
 * full colour.
 */
export function calendarColorScale(
  min: number | null,
  max: number | null,
): (value: number | null) => string {
  // The ramp endpoints: the chart blue at low alpha (sparse) → full (dense).
  const LOW_ALPHA = 0.08;
  const HIGH_ALPHA = 1;
  // CHART_COLOR_PALETTE[1] is "rgba(31, 120, 180, 1)" — the chart family's blue.
  const blue = "31, 120, 180";

  const span = min != null && max != null ? max - min : 0;

  return (value: number | null): string => {
    if (value == null || min == null || max == null) return "transparent";
    // Normalise into [0, 1]; a degenerate (zero-span) range → 1 (full colour).
    const t = span > 0 ? (value - min) / span : 1;
    const alpha = LOW_ALPHA + (HIGH_ALPHA - LOW_ALPHA) * t;
    return `rgba(${blue}, ${alpha.toFixed(3)})`;
  };
}

/** The full chart-blue, exported so a legend/scale swatch can reuse the exact ramp
 * endpoint (keeps the legend and the cells in step). */
export const CALENDAR_RAMP_COLOR = CHART_COLOR_PALETTE[1];
