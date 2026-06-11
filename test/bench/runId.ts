/**
 * Run id for a benchmark run — names the per-run results directory
 * `test-results/bench/<run-id>/`, beside the e2e `test-results/<scope>/<RUN_ID>`
 * scopes. Defaults to the LOCAL calendar date (`YYYY-MM-DD`) so every process of
 * one run (the Tier-2 runner, the Tier-3 specs under Playwright, the plot step)
 * converges on ONE directory without env plumbing; set `BENCH_RUN_ID` to label a
 * run explicitly (e.g. `2026-06-11-jss` to keep a same-day server comparison apart).
 *
 * Imports `node:process` (not `Deno.env`) so the module loads under both runtimes.
 */
import process from "node:process";

export function benchRunId(now = new Date()): string {
  const env = process.env.BENCH_RUN_ID;
  if (env) return env;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}
