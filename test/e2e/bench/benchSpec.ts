import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { benchRunId } from "../../bench/runId.ts";
import { recordSetup } from "../../bench/runSetup.ts";

/**
 * Shared harness for the Tier-3 BENCHMARK specs (manage-render, room-render,
 * share-render, view-roundtrip): the per-run results directory, the sweep-size
 * env parsing, and the `.dat` + setup.json writing — so every spec emits the
 * same gnuplot-ready shape into the same run directory the Deno side
 * (runner.ts / plots.ts) uses. Runs under Playwright's Node loader, hence
 * `node:fs` and no Deno APIs.
 */

/** This run's figures directory — `test-results/bench/<run-id>/` (see runId.ts). */
export const RESULTS_DIR = fileURLToPath(
  new URL(`../../../test-results/bench/${benchRunId()}`, import.meta.url),
);

const POD_SERVER = process.env.LOCAL_POD_SERVER === "jss" ? "JSS" : "CSS";

/** Parse a `BENCH_*` size list ("10,20,50"), falling back to `def`. */
export function sweepSizes(envVar: string, def: number[]): number[] {
  const raw = process.env[envVar];
  if (!raw) return def;
  return raw.split(",").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n));
}

/**
 * Write `<name>.dat` (whitespace columns, `#` header, floats to 3 decimals) and
 * record this spec's setup lines — merged into the run's `setup.json` alongside
 * the other writers', so the run index ties the figure to what it measured.
 */
export function writeBenchDat(
  name: string,
  header: string,
  rows: number[][],
  setup: Record<string, string>,
): void {
  mkdirSync(RESULTS_DIR, { recursive: true });
  const body = rows
    .map((r) => r.map((v) => (Number.isInteger(v) ? String(v) : v.toFixed(3))).join("  "))
    .join("\n");
  writeFileSync(`${RESULTS_DIR}/${name}.dat`, `# ${header}\n${body}\n`);
  console.log(`wrote ${RESULTS_DIR}/${name}.dat`);
  recordSetup(RESULTS_DIR, {
    "pod server": POD_SERVER,
    "browser (Tier 3)": "Chromium cold load of the production build (vite preview)",
    ...setup,
  });
}
