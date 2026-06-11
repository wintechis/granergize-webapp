import { expect, type Page, test } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { account, login } from "../helpers/login.ts";
import { buildingRows } from "../helpers/manage.ts";
import { LOCAL_CSS_CONTROL_PORT } from "../../config/localSeed.ts";
import { benchRunId } from "../../bench/runId.ts";

/**
 * Tier-3 scalability BENCHMARK (`deno task bench:ui`): end-to-end browser
 * time-to-render of the Manage building list as the number of buildings grows.
 * Measure-and-report — it records timings to `test-results/bench/<run-id>/manage-render.dat`
 * (the Deno `plots.ts` step then draws the PNG); no time-based assertions.
 *
 * Seeding goes through the local-CSS control server (`POST /seed?n=`), which runs
 * in DENO and uses the real data layer — the spec can't seed itself because the
 * data layer needs Deno-only deps (npm:jose) that don't load under Playwright's
 * Node loader. Per size we seed N into pod A, then COLD-load the app (full
 * navigation clears the in-memory React Query cache) and time until the list shows
 * all N — by the Pager's "of N" summary (page size is 20), or the row count when
 * N ≤ one page.
 *
 * Local tier only (needs the control server). Runs as the `bench` Playwright
 * project, gated by E2E_BENCH so the normal e2e runs don't pick it up.
 */
const LOCAL = !!process.env.E2E_LOCAL;
const CONTROL = `http://localhost:${LOCAL_CSS_CONTROL_PORT}`;
// Same dated run directory as the Deno side (test-results/bench/<run-id>/), so
// the follow-up plots.ts step picks this .dat up with the rest of the run.
const RESULTS_DIR = fileURLToPath(
  new URL(`../../../test-results/bench/${benchRunId()}`, import.meta.url),
);
const PAGE_SIZE = 20; // DEFAULT_PAGE_SIZE in usePaging.ts

function sizes(): number[] {
  const raw = process.env.BENCH_SIZES;
  const def = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
  if (!raw) return def;
  return raw.split(",").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n));
}

const ACC = account("A");

test.describe.configure({ mode: "serial" });

test.describe("manage-render benchmark", () => {
  test.skip(!LOCAL, "Tier-3 render bench runs only on the local CSS (deno task bench:ui).");

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(240_000);
    page = await browser.newPage();
    await login(page, ACC); // bench skips the CSS reset; logs into the warm CSS
  });

  test.afterAll(async () => {
    await page?.close();
  });

  test("time-to-render the Manage list across building counts", async () => {
    const SIZES = sizes();
    test.setTimeout(60_000 + SIZES.length * 130_000);
    const rows: Array<[number, number, number]> = [];

    for (const n of SIZES) {
      // Seed exactly N buildings into A's pod (Deno side; no browser cost).
      const res = await fetch(`${CONTROL}/seed?n=${n}`, { method: "POST" });
      expect(res.ok, `seed n=${n} (HTTP ${res.status})`).toBeTruthy();

      // Cold load: a full navigation drops the in-memory query cache, so the app
      // refetches + reparses + re-renders from scratch. Time from navigation to
      // the list reflecting all N buildings.
      const t0 = Date.now();
      await page.goto("/");
      await page.getByRole("tab", { name: "Manage" }).click();
      await expect(
        page.getByRole("button", { name: "Add Building", exact: true }).first(),
      ).toBeVisible({ timeout: 120_000 });
      if (n > PAGE_SIZE) {
        // Pager summary "x–y of N" appears only when there's more than one page;
        // it confirms all N were loaded + parsed (not just the rendered page).
        await expect(page.getByText(new RegExp(`\\bof ${n}\\b`)).first())
          .toBeVisible({ timeout: 120_000 });
      } else {
        await expect(buildingRows(page)).toHaveCount(n, { timeout: 120_000 });
      }
      const ms = Date.now() - t0;

      rows.push([n, ms, n > 0 ? ms / n : 0]);
      console.log(`  n=${n}  ${ms} ms`);
    }

    // Write the gnuplot data file; the `bench:ui` task then runs the Deno plot
    // step (plots.ts) which renders manage-render.png alongside the Tier-2 graphs.
    mkdirSync(RESULTS_DIR, { recursive: true });
    const header = "# n_buildings  total_ms  ms_per_building";
    const body = rows
      .map(([n, ms, per]) => `${n}  ${ms}  ${per.toFixed(3)}`)
      .join("\n");
    writeFileSync(`${RESULTS_DIR}/manage-render.dat`, `${header}\n${body}\n`);
    console.log(`wrote ${RESULTS_DIR}/manage-render.dat`);
  });
});
