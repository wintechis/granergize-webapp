import type { AggregatedViewSnapshot } from "../../types.ts";

/**
 * The single place the energy-view's row-key space meets the benchmark snapshot's
 * metric-key space. The annual energy table (`loadEnergy` in TurtleParsingService)
 * keys its rows "Electricity" / "Heat" / "Water" / "Wastewater"; a BSP benchmark
 * snapshot keys its values "electricityConsumption" / … (the BSP metrics). Only
 * these four rows can carry a benchmark; every other energy row has none.
 */
export const ENERGY_KEY_TO_BENCHMARK_METRIC: Record<string, string> = {
  Electricity: "electricityConsumption",
  Heat: "heatConsumption",
  Water: "waterConsumption",
  Wastewater: "wastewaterConsumption",
};

/** A benchmark figure for one energy row, resolved from a received snapshot. */
export interface PickedBenchmark {
  value: number;
  computedBy?: string; // the BSP that computed it (for the AgentLabel link)
  metricPeriod?: string; // the year it covers
  computedAt: string;
}

/**
 * Resolve the benchmark figure to show for one energy row from the received
 * benchmark snapshots. Prefers the **newest** snapshot (by `computedAt`) that
 * carries the row's metric; returns null when no received benchmark covers it
 * (so the Benchmark cell stays blank). Pure — the hook supplies the snapshots.
 */
export function pickBenchmark(
  snapshots: AggregatedViewSnapshot[],
  energyKey: string,
): PickedBenchmark | null {
  const metric = ENERGY_KEY_TO_BENCHMARK_METRIC[energyKey];
  if (!metric) return null;

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
