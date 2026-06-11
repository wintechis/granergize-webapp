/**
 * Run id for a benchmark run — names the per-run results directory
 * `test-results/bench/<run-id>/`, beside the e2e `test-results/<scope>/<RUN_ID>`
 * scopes and in the same format: a second-resolution ISO 8601 UTC timestamp, so
 * runs sort chronologically and never overwrite each other.
 *
 * One logical run spans several processes, which converge on ONE id like so:
 * the Tier-2 runner mints the timestamp once (single process); the Tier-3 bench
 * specs reuse the `E2E_RUN_ID` that playwright.config.ts stamps onto the env
 * (stable across its workers); the plot step falls back to the LATEST run
 * directory (see `latestRunDir` in report.ts). To combine a Tier-2 and a Tier-3
 * run into one figure set — or to label a run — set `BENCH_RUN_ID` explicitly
 * for both.
 *
 * Imports `node:process` (not `Deno.env`) so the module loads under both runtimes.
 */
import process from "node:process";

export function benchRunId(now = new Date()): string {
  const env = process.env.BENCH_RUN_ID || process.env.E2E_RUN_ID;
  if (env) return env;
  return now.toISOString().replace(/\.\d+Z$/, "Z");
}
