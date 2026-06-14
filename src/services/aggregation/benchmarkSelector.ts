import type { AggregatedViewSnapshot } from "../../types.ts";

/** A benchmark figure for one energy row, resolved from a received snapshot. */
export interface PickedBenchmark {
  value: number;
  computedBy?: string; // the BSP that computed it (for the AgentLabel link)
  metricPeriod?: string; // the year it covers
  computedAt: string;
}

/**
 * Resolve the benchmark figure to show for one energy row from the received
 * benchmark snapshots. The energy table now keys its rows by the canonical metric
 * key (`electricityConsumption`, …) — the SAME key space a benchmark snapshot
 * stores its values under — so no translation is needed; a non-consumption metric
 * simply has no benchmark value and returns null. Prefers the **newest** snapshot
 * (by `computedAt`) that carries the metric. Pure — the hook supplies the snapshots.
 */
export function pickBenchmark(
  snapshots: AggregatedViewSnapshot[],
  metric: string,
): PickedBenchmark | null {
  const candidates = snapshots.filter(
    (s) => s.isBenchmark && typeof s.values[metric] === "number",
  );
  if (candidates.length === 0) return null;

  const newest = candidates.reduce((a, b) =>
    a.computedAt >= b.computedAt ? a : b
  );
  return {
    value: newest.values[metric],
    computedBy: newest.computedBy,
    metricPeriod: newest.metricPeriod,
    computedAt: newest.computedAt,
  };
}
