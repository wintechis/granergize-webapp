import { expect, type Page, test } from "@playwright/test";
import { t } from "../helpers/i18n.ts";
import { account, hasAccount, login } from "../helpers/login.ts";
import { newCapturedPage } from "../helpers/consoleLog.ts";
import { assertCleanStart, verifyAndReset } from "../helpers/cleanSlate.ts";
import { ensureDemoBuildings } from "../helpers/seed.ts";
import { openBuildingsMap } from "../helpers/manage.ts";
import { T } from "../helpers/timeouts.ts";

/**
 * Competency-question e2e for the two cross-building temporal collection guises of
 * the space-time cube (`plans/plan-cube-ui.md`): the **space-cut "Over time" matrix**
 * (Step 2) and the **"Compare years" small multiples** (Step 4). Both live on the
 * in-shell Buildings → Map surface's Explore-view toggle.
 *
 * CQ "How does the whole portfolio compare over time?" → the Over-time matrix renders a
 * buildings × years heatmap, one cell per (building, year), and a cell navigates to that
 * building's page (the navigation loop). CQ companion: the Compare-years small multiples
 * render one mini-panel per year side by side, on a shared scale.
 *
 * Seed: the standard investor demo (`ensureDemoBuildings`) — multi-year annual buildings
 * (2022-2024) plus the office (2023-2024), so the matrix has several rows × ≥2 year
 * columns and the small multiples have ≥2 year panels. The matrix/scale maths is proved
 * in `energyMatrix.test.ts` / `energySmallMultiples.test.ts`; this is the UI proof the
 * panels render and the cells/bars reach the DOM.
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

test.describe("cube space-cut + compare-years (portfolio over time)", () => {
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

  /** Open Map view and wait for markers (the building set the panels read over). */
  async function openMap(page: Page): Promise<void> {
    await page.goto("/");
    await openBuildingsMap(page);
    await expect(page.locator(".leaflet-marker-icon").first())
      .toBeVisible({ timeout: T.action });
  }

  test("the Over-time matrix renders a buildings × years heatmap and a cell drills in", async () => {
    test.setTimeout(T.testSolo);
    await openMap(page);

    // Switch the Explore view to the cross-building over-time matrix. The toggle
    // label comes from the i18n catalog (t("exploreViewOverTime") = "Over time").
    await page.getByRole("button", { name: t("exploreViewOverTime") }).click();

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

    // Clicking a cell hands off to that building's detail page (the navigation
    // loop — the finder drills to the leaf).
    await valueCells.first().click();
    // The redesign navigates to a real path route (`/building?ref=…`), not the
    // old hash route (`#/building`) — match the current grammar (cf. uri-state).
    await expect(page).toHaveURL(/\/building\?/, { timeout: T.action });
  });

  test("the Compare-years multiples render one panel per year on a shared scale", async () => {
    test.setTimeout(T.testSolo);
    await openMap(page);

    // Switch to the year-juxtaposing small multiples.
    await page.getByRole("button", { name: t("exploreViewCompareYears") }).click();

    // Each panel's heading is the year (a Typography h6). The demo set has ≥2
    // years with annual data → ≥2 year-panel headings; retry until the cube loads.
    const yearHeadings = page.getByRole("heading", { name: /^\d{4}$/ });
    await expect(async () => {
      expect(await yearHeadings.count()).toBeGreaterThanOrEqual(2);
    }).toPass({ timeout: T.poll, intervals: [1_500] });

    // Distinct years (2022..2024) appear as separate panels — assert two of them.
    await expect(page.getByRole("heading", { name: "2024", exact: true }))
      .toBeVisible({ timeout: T.action });
    await expect(page.getByRole("heading", { name: "2023", exact: true }))
      .toBeVisible({ timeout: T.action });

    // Each panel's per-building bars are role=button (aria-label "<name> — <year>:
    // <kWh…>") and a bar click drills to the building — the same finder→detail loop.
    const bar = page.getByRole("button", { name: /—\s*\d{4}\s*:/ }).first();
    await expect(bar).toBeVisible({ timeout: T.action });
    await bar.click();
    // Real path route (`/building?ref=…`), not the old hash route (cf. :98).
    await expect(page).toHaveURL(/\/building\?/, { timeout: T.action });
  });
});
