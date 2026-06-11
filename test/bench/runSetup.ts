/**
 * Per-run setup record — `setup.json` in the run directory. Each writer (the
 * Tier-2 runner, each Tier-3 spec) records the setup IT knows (pod server,
 * sweep sizes, samples); entries MERGE, so several writers into one run dir
 * each contribute their lines. The run's `index.html` renders it (report.ts),
 * so a figure is never separated from what it was measured against.
 *
 * Uses `node:fs` so the module loads under both the Deno runner and
 * Playwright's Node loader.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

export function recordSetup(
  dir: string,
  entries: Record<string, string>,
): Record<string, string> {
  mkdirSync(dir, { recursive: true });
  const path = `${dir}/setup.json`;
  let existing: Record<string, string> = {};
  try {
    existing = JSON.parse(readFileSync(path, "utf8")) as Record<string, string>;
  } catch {
    // no setup recorded yet — this writer starts the file
  }
  const merged = { ...existing, ...entries };
  writeFileSync(path, JSON.stringify(merged, null, 2) + "\n");
  return merged;
}
