import { expect, type Page, test } from "@playwright/test";
import { t } from "../helpers/i18n.ts";
import { account, hasAccount, login } from "../helpers/login.ts";
import { newCapturedPage } from "../helpers/consoleLog.ts";
import { assertCleanStart, verifyAndReset } from "../helpers/cleanSlate.ts";
import { ensureDemoBuildings } from "../helpers/seed.ts";
import { openObservationsView } from "../helpers/manage.ts";
import { T } from "../helpers/timeouts.ts";

/**
 * Competency-question e2e for the cross-building over-time guise of the cube: the
 * **efficiency-over-time heatmap** — the Observations finder's "Over time" view
 * (`?view=overtime`; `src/services/cube/observationsAxes.ts`). Energy lives in the
 * Observations finder now; Buildings is space/identity only.
 *
 * CQ "How does the whole portfolio compare over time?" → the heatmap renders a
 * buildings × years grid, one cell per (building, year), plus a trailing Trend column
 * (the year-over-year direction — the formerly separate Trend view, now folded in);
 * a cell navigates to that building's `/observation` (energy) page, consistent with
 * the map markers. (Compare-years was dropped.)
 *
 * Seed: the standard investor demo (`ensureDemoBuildings`) — multi-year annual buildings
 * (2022-2024) plus the office (2023-2024), so the matrix has several rows × ≥2 year
 * columns. The matrix maths is proved in `energyMatrix.test.ts`; this is the UI proof the
 * grid renders and the cells reach the DOM.
 *
 *   # tier 3 (local CSS, no creds):
 *   deno task e2e:local test/e2e/tasks/cube-space-cut.spec.ts
 *   # tier 4 (real Pods):
 *   source test/.env.e2e.local && deno task e2e:remote:spec test/e2e/tasks/cube-space-cut.spec.ts
 *
 * Runs against Alice (account A). Skipped without creds.
 *
 * NOTE: authored-but-unrun (a live e2e session held the slot). Needs a
 * `deno task e2e:local` run when one is free.
 */

const ACC = account("A"); // Alice -- solo specs use one account

test.describe.configure({ mode: "serial" });

test.describe("cube over-time heatmap (portfolio over time)", () => {
  test.skip(
    !hasAccount(ACC),
    `Set WEBID_A_USERNAME / WEBID_A_PASSWORD (a throwaway Solid Pod) to run the cube-space-cut e2e.`,
  );

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(T.setup);
    page = await newCapturedPage(browser, "cube-space-cut");
    await login(page, ACC);
    await assertCleanStart(page);
    await ensureDemoBuildings(page);
  });

  test.afterAll(async () => {
    await verifyAndReset(page, "cube-space-cut");
    await page.close();
  });

  test("the over-time heatmap renders a grid + trend column, and a cell drills into the observation", async () => {
    test.setTimeout(T.testSolo);
    await page.goto("/");

    // The over-time heatmap is the Observations finder's "Over time" view (energy
    // moved out of Buildings). The buildings × years matrix renders over the
    // filtered set of buildings-with-energy.
    await openObservationsView(page, "overtime");

    // The matrix cells are role=button (each (building, year) cell, with an
    // aria-label "<name> — <year>: …"). The bulk energy cube loads through the
    // buildings query, so retry until at least one cell has rendered.
    const cells = page.getByRole("button", { name: /—\s*\d{4}\s*:/ });
    await expect(async () => {
      expect(await cells.count()).toBeGreaterThan(0);
    }).toPass({ timeout: T.poll, intervals: [1_500] });

    // The demo's multi-year buildings give the set ≥2 distinct years across the
    // matrix → at least one populated cell carrying a numeric value (kWh/m²/a). The
    // "no data" cells carry the lensBandNoData label; assert a real value cell.
    const valueCells = page.getByRole("button", {
      name: new RegExp(`—\\s*\\d{4}\\s*:.*(?!${t("lensBandNoData")})\\d`),
    });
    await expect(valueCells.first()).toBeVisible({ timeout: T.action });

    // The heatmap carries a trailing Trend column (the folded-in Trend view): each
    // building shows its year-over-year direction. The multi-year demo yields ≥1
    // building with a real (non-"unknown") trend.
    const trendLabel = page.getByText(
      new RegExp(
        `${t("trendImproving")}|${t("trendFlat")}|${t("trendWorsening")}`,
      ),
    );
    await expect(trendLabel.first()).toBeVisible({ timeout: T.action });

    // Clicking a cell hands off to that building's OBSERVATION (energy) detail — the
    // finder drills to the observation leaf, consistent with the map markers.
    await valueCells.first().click();
    // A real path route (`/observation?ref=…`), not the old hash route — match the
    // current grammar (cf. uri-state).
    await expect(page).toHaveURL(/\/observation\?/, { timeout: T.action });
  });
});
