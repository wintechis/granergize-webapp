import { expect, type Page, test } from "@playwright/test";
import { account, hasAccount, login } from "../helpers/login.ts";
import { newCapturedPage } from "../helpers/consoleLog.ts";
import { assertCleanStart, verifyAndReset } from "../helpers/cleanSlate.ts";
import { ensureDemoBuildings } from "../helpers/seed.ts";
import { openBuildingsMap } from "../helpers/manage.ts";
import { T } from "../helpers/timeouts.ts";

/**
 * Competency-question e2e for the map's **trend lens** (Step 3 of
 * `plans/plan-cube-ui.md`): a content transformation that flattens the time axis
 * into a single year-over-year **trend** colour per building — improving / flat /
 * worsening / unknown — instead of the absolute efficiency tier.
 *
 * CQ "Is building X's consumption getting better or worse?" → Buildings → Map → lens =
 * Trend; assert the markers recolour by trend, the trend legend reads, and at least one
 * building shows a real (non-unknown) direction. The direction is read off each
 * building's own two most recent comparable years (no peer set). The trend maths is
 * proved in `energyTrend.test.ts`; this is the UI proof the lens recolours the markers
 * and the trend categories reach the DOM via the `trend-marker trend-<trend>` className
 * (the energy-marker precedent).
 *
 * The demo's multi-year intensities sit close to the ±5 % flat band, so the spec does
 * NOT pin which building reads improving vs flat (a fragile exact assertion); it asserts
 * the lens is *active and legible* and that a real direction is present somewhere. The
 * generation-flip of the trend meaning ("more PV = improving") is covered by the metric
 * selector in `cube-metric-selector.spec.ts` — and is `fixme`'d there because the demo
 * seed carries no generation energy.
 *
 *   # tier 3 (local CSS, no creds):
 *   deno task e2e:local test/e2e/tasks/cube-trend-lens.spec.ts
 *   # tier 4 (real Pods):
 *   source test/.env.e2e.local && deno task e2e:remote:spec test/e2e/tasks/cube-trend-lens.spec.ts
 *
 * Runs against Alice (account A). Skipped without creds.
 *
 * NOTE: authored-but-unrun (a live e2e session held the slot). Needs a
 * `deno task e2e:local` run when one is free.
 */

const ACC = account("A"); // Alice -- solo specs use one account

test.describe.configure({ mode: "serial" });

test.describe("cube trend lens (getting better or worse)", () => {
  test.skip(
    !hasAccount(ACC),
    `Set E2E_USERNAME_A / E2E_PASSWORD_A (a throwaway Solid Pod) to run the cube-trend-lens e2e.`,
  );

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(T.setup);
    page = await newCapturedPage(browser, "cube-trend-lens");
    await login(page, ACC);
    await assertCleanStart(page);
    await ensureDemoBuildings(page);
  });

  test.afterAll(async () => {
    await verifyAndReset(page, "cube-trend-lens");
    await page.close();
  });

  test("the Trend lens recolours markers by year-over-year direction", async () => {
    test.setTimeout(T.testSolo);
    // The trend cube loads through the buildings query, so retry the whole open
    // until the trend markers paint (the Tier-3 write-read convergence pattern).
    await expect(async () => {
      await page.goto("/");
      await openBuildingsMap(page);
      await expect(page.locator(".leaflet-marker-icon").first())
        .toBeVisible({ timeout: T.action });
      // Switch the colour lens to Trend.
      await page.getByRole("button", { name: "Trend", exact: true }).click();
      // The markers recolour into trend markers (the trend is baked into the
      // className — `trend-marker trend-<trend>`).
      await expect(page.locator(".trend-marker").first())
        .toBeAttached({ timeout: T.action });
      // At least one building has two comparable years → a REAL direction (not the
      // neutral "unknown"). The demo's multi-year buildings supply it.
      await expect(
        page.locator(
          ".trend-marker.trend-improving, .trend-marker.trend-flat, .trend-marker.trend-worsening",
        ).first(),
      ).toBeAttached({ timeout: T.action });
    }).toPass({ timeout: T.setup, intervals: [2_000] });

    // The legend followed the active lens — the diverging trend swatches read.
    await expect(page.getByText("Improving")).toBeVisible({ timeout: T.action });
    await expect(page.getByText("Worsening")).toBeVisible({ timeout: T.action });
  });
});
