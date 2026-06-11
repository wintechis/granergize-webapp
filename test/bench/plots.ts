/// <reference lib="deno.ns" />
/**
 * The benchmark GRAPH CATALOG: which `.dat` becomes which gnuplot graph. Kept apart
 * from the generic machinery (`report.ts`) and the data producers (`runner.ts`
 * Tier-2; `manage-render.spec.ts` Tier-3) so the plots can be (re)generated from
 * existing `.dat` without re-running the benchmarks — e.g. after installing gnuplot.
 *
 *   deno task bench:plot     # = deno run -A test/bench/plots.ts
 */
import { RESULTS_DIR, type PlotSpec, renderGraphs, writeGp } from "./report.ts";

/** Every benchmark graph. Each `name` reads `<name>.dat`, writes `<name>.png`. */
export const ALL_PLOTS: PlotSpec[] = [
  {
    name: "buildings",
    title: "Load+parse time vs. number of owned buildings",
    xlabel: "# buildings",
    ylabel: "fetchAndParseData time (ms)",
    y2label: "per-building (ms)",
    series: [
      { col: 2, title: "total (ms)" },
      { col: 3, title: "per building (ms)", y2: true },
    ],
  },
  {
    name: "series",
    title: "List+parse time vs. size of 15-min energy series",
    xlabel: "# 15-min readings",
    ylabel: "list+parse time (ms)",
    y2label: "per-reading (ms)",
    xcol: 2,
    series: [
      { col: 3, title: "total (ms)" },
      { col: 4, title: "per reading (ms)", y2: true },
    ],
  },
  {
    name: "shared",
    title: "Sharing n buildings via a data room (B shares, A drains + loads)",
    xlabel: "# buildings shared",
    ylabel: "time (ms)",
    y2label: "share per-building (ms)",
    series: [
      { col: 2, title: "share (resolve role + share each)" },
      { col: 4, title: "drain inbox (A)" },
      { col: 5, title: "fold + load (A)" },
      { col: 3, title: "share per building (ms)", y2: true },
    ],
  },
  {
    name: "rooms",
    title: "Data-room operation time vs. number of members",
    xlabel: "# members",
    ylabel: "operation time (ms)",
    series: [
      { col: 2, title: "create" },
      { col: 3, title: "join" },
      { col: 4, title: "leave" },
      { col: 5, title: "fold (getMembers)" },
      { col: 6, title: "delete" },
    ],
  },
  {
    name: "room-churn",
    title: "Data-room read fold vs. role-event history (fixed membership)",
    xlabel: "# role events",
    ylabel: "time (ms)",
    series: [
      { col: 2, title: "setMyRole (append)" },
      { col: 3, title: "fold (getMembers)" },
    ],
  },
  {
    // Tier-3: end-to-end browser render (cold load → N rows on Manage).
    name: "manage-render",
    title: "Browser time-to-render vs. number of buildings (Manage list)",
    xlabel: "# buildings",
    ylabel: "time to N rows (ms)",
    y2label: "per-building (ms)",
    series: [
      { col: 2, title: "total (ms)" },
      { col: 3, title: "per building (ms)", y2: true },
    ],
  },
  {
    // Tier-3: end-to-end browser render (cold load → N member rows on Connect).
    name: "room-render",
    title: "Browser time-to-render vs. number of members (data room)",
    xlabel: "# members",
    ylabel: "time to N rows (ms)",
    y2label: "per-member (ms)",
    series: [
      { col: 2, title: "total (ms)" },
      { col: 3, title: "per member (ms)", y2: true },
    ],
  },
];

/** True if `<name>.dat` exists in RESULTS_DIR (so we only plot what was measured). */
async function datExists(name: string): Promise<boolean> {
  try {
    await Deno.stat(`${RESULTS_DIR}/${name}.dat`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Write a `.gp` for every plot whose `.dat` is present, then render them all
 * (gnuplot if available, else a hint). Called by the Tier-2 runner at the end and
 * as the `bench:plot` entry point.
 */
export async function regenerateAndRender(): Promise<void> {
  for (const spec of ALL_PLOTS) {
    if (await datExists(spec.name)) await writeGp(RESULTS_DIR, spec);
  }
  await renderGraphs(RESULTS_DIR);
}

if (import.meta.main) await regenerateAndRender();
