import { expect, type Page, test } from "@playwright/test";
import { t } from "../helpers/i18n.ts";
import { account, hasAccount, login } from "../helpers/login.ts";
import { newCapturedPage } from "../helpers/consoleLog.ts";
import { assertCleanStart, verifyAndReset } from "../helpers/cleanSlate.ts";
import { ensureDemoBuildings } from "../helpers/seed.ts";
import { openObservationsView } from "../helpers/manage.ts";
import { T } from "../helpers/timeouts.ts";

/**
 * Competency-question e2e for the Observations finder's **Trend** view
 * (`?view=trend`; `src/services/cube/observationsAxes.ts`): each building flagged by
 * its year-over-year direction (improving / little change / worsening) on the
 * selected metric. Energy lives in the Observations finder now; Buildings is
 * space/identity only.
 *
 * CQ "Which buildings are getting better or worse over time?" → the trend view lists
 * the buildings-with-energy, each with a direction; the multi-year investor demo
 * (2022-2024, distinct intensities) gives at least one building a computable
 * (non-"unknown") direction. The trend maths is proved exhaustively in the Tier-1
 * `energyTrend.test.ts`; this is the UI proof the view renders and the directions
 * reach the DOM.
 *
 *   # tier 3 (local CSS, no creds):
 *   deno task e2e:local test/e2e/tasks/cube-trend.spec.ts
 *   # tier 4 (real Pods):
 *   source test/.env.e2e.local && deno task e2e:remote:spec test/e2e/tasks/cube-trend.spec.ts
 *
 * Runs against Alice (account A). Skipped without creds.
 */

const ACC = account("A"); // Alice -- solo specs use one account

test.describe.configure({ mode: "serial" });

test.describe("cube trend (which buildings improve / worsen)", () => {
  test.skip(
    !hasAccount(ACC),
    `Set WEBID_A_USERNAME / WEBID_A_PASSWORD (a throwaway Solid Pod) to run the cube-trend e2e.`,
  );

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(T.setup);
    page = await newCapturedPage(browser, "cube-trend");
    await login(page, ACC);
    await assertCleanStart(page);
    await ensureDemoBuildings(page);
  });

  test.afterAll(async () => {
    await verifyAndReset(page, "cube-trend");
    await page.close();
  });

  test("the trend view flags each building's year-over-year direction", async () => {
    test.setTimeout(T.testSolo);
    await page.goto("/");
    await openObservationsView(page, "trend");

    // The trend rows render once the bulk energy cube loads; retry (the standard
    // Tier-3 write-read convergence pattern). At least one multi-year building gets a
    // real (non-"unknown") direction — improving, little change, or worsening — and
    // its `?view=trend` is reflected in the URI.
    await expect(page).toHaveURL(/view=trend/, { timeout: T.action });
    const realTrend = page.getByText(
      new RegExp(`${t("trendImproving")}|${t("trendFlat")}|${t("trendWorsening")}`),
    );
    await expect(async () => {
      expect(await realTrend.count()).toBeGreaterThan(0);
    }).toPass({ timeout: T.poll, intervals: [1_500] });
  });
});
