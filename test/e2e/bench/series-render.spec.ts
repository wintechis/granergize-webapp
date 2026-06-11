import { expect, type Page, test } from "@playwright/test";
import { account, login } from "../helpers/login.ts";
import { LOCAL_CSS_CONTROL_PORT } from "../../config/localSeed.ts";
import { sweepSizes, writeBenchDat } from "./benchSpec.ts";

/**
 * Tier-3 scalability BENCHMARK (`deno task bench:ui`): time-to-chart for a
 * SHARED 15-minute series as its day-file count grows. Substrate: the pair
 * seeding (`/seed-shared`) with `seriesDays=D` — B's first building is a
 * series-only one (D daily files × 96 readings, on B's Pod), shared to A with
 * energy included, against a constant background of 20 annual-data buildings.
 *
 * The series is LAZY by design (the bulk load never fetches it), and the chart
 * is day/month-PAGED — so the burst a click costs is bounded by the page, not
 * by D. The sweep shows exactly that:
 *
 *   day_ms   — cold navigation to the series building's energy view → the Day
 *              View chart rendered (global phase-1 load + the series-container
 *              LISTING, which is what grows with D, + ONE day-file fetch).
 *   month_ms — switch to "Daily Totals" → the monthly chart rendered (a bulk
 *              fetch of the selected month's day-files — ~30 cross-Pod
 *              requests, roughly constant in D).
 *
 * Measure-and-report into `test-results/bench/<run-id>/series-render.dat`; no
 * time-based assertions. Local tier only; runs as the `bench` Playwright
 * project, gated by E2E_BENCH.
 */
const LOCAL = !!process.env.E2E_LOCAL;
const CONTROL = `http://localhost:${LOCAL_CSS_CONTROL_PORT}`;
// Constant shared-buildings background, so D is the only moving axis.
const N_SHARED = 20;
// The app folds a NON-NUMERIC building fragment into a numeric id
// (buildingParser.ts: the 31-multiplier string hash, unsigned) and the
// /energy/:id route matches on THAT — replicate the fold to deep-link the
// seeded series building (`bench-0`, the series-only click target).
const routeId = (fragment: string): number =>
  fragment
    .split("")
    .reduce((h, c) => (Math.imul(31, h) + c.charCodeAt(0)) | 0, 0) >>> 0;
const SERIES_ID = routeId("bench-0");

const ACC = account("A");

test.describe.configure({ mode: "serial" });

test.describe("series-render benchmark", () => {
  test.skip(!LOCAL, "Tier-3 render bench runs only on the local pod server (deno task bench:ui).");

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(240_000);
    page = await browser.newPage();
    await login(page, ACC);
  });

  test.afterAll(async () => {
    await page?.close();
  });

  test("time-to-chart for a shared series across day-file counts", async () => {
    const SIZES = sweepSizes("BENCH_SERIES_DAYS", [30, 60, 90, 180, 270, 365]);
    // Seeding writes D day-files per size (pooled); D=365 is a few thousand PUTs.
    test.setTimeout(60_000 + SIZES.length * 240_000);
    const rows: number[][] = [];

    for (const days of SIZES) {
      const res = await fetch(
        `${CONTROL}/seed-shared?n=${N_SHARED}&drained=1&seriesDays=${days}`,
        { method: "POST" },
      );
      expect(res.ok, `seed-shared seriesDays=${days} (HTTP ${res.status})`).toBeTruthy();

      // Cold navigation straight to the series building's energy view: loads
      // phase 1 (resolves the building), lists the series container (D
      // children), fetches the first day, renders the Day View chart.
      // Via about:blank — a hash-only navigation from "/" would NOT reload the
      // document, leaving the app on its stale in-memory (pre-seed) data.
      await page.goto("about:blank");
      let t0 = Date.now();
      await page.goto(`/#/energy/${SERIES_ID}`);
      await expect(page.locator(".recharts-wrapper").first())
        .toBeVisible({ timeout: 120_000 });
      const dayMs = Date.now() - t0;

      // The month view bulk-fetches the selected month's day-files.
      t0 = Date.now();
      await page.getByRole("tab", { name: "Daily Totals" }).click();
      await expect(page.getByText("Loading…")).toHaveCount(0, { timeout: 120_000 });
      await expect(page.locator(".recharts-wrapper").first())
        .toBeVisible({ timeout: 120_000 });
      const monthMs = Date.now() - t0;

      rows.push([days, days * 96, dayMs, monthMs]);
      console.log(`  days=${days}  day-view ${dayMs}  daily-totals ${monthMs} ms`);

      // Park the app before the next size's seed (see share-render: a live
      // page can write during the wipe window and contaminate the next seed).
      await page.goto("about:blank");
    }

    writeBenchDat(
      "series-render",
      "days  readings  day_ms  month_ms",
      rows,
      {
        "series-render sweep (day files)": SIZES.join(" "),
        "series-render background": `${N_SHARED} shared annual-data buildings`,
      },
    );
  });
});
