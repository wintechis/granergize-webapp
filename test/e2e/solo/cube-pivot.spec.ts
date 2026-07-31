import { expect, type Page, test } from "@playwright/test";
import { t } from "../helpers/i18n.ts";
import { account, hasAccount, login } from "../helpers/login.ts";
import { newCapturedPage } from "../helpers/consoleLog.ts";
import { assertCleanStart, verifyAndReset } from "../helpers/cleanSlate.ts";
import { ensureDemoBuildings } from "../helpers/seed.ts";
import { openObservationsView } from "../helpers/manage.ts";
import { T } from "../helpers/timeouts.ts";

/**
 * Competency-question e2e for the cube's **pivot** guise — the Observations finder's
 * "Pivot" view (`?view=pivot`, row level `?rows=`, drill scope `?in=`;
 * `src/services/cube/pivot.ts` + `observationsAxes.ts`).
 *
 * CQ "How do my figures compare, rolled up a feature level?" → the pivot renders a
 * rows × years grid whose row level the user picks: buildings (the finest grain), or
 * their Gemeinde/Kreis/Land/Bund roll-up (Ø over the region's buildings). A
 * building-level cell drills into that building's `/observation` page, like the
 * over-time matrix's cells.
 *
 * Seed: the standard investor demo (`ensureDemoBuildings`) — multi-year annual
 * buildings, so the grid has rows × ≥2 year columns. Whether the demo buildings carry
 * a `regionAgs` depends on the geocoder at seed time, so at a region level this spec
 * accepts named region rows AND the "Without a region" bucket — both render region
 * (role=img) cells. The grid maths and the drill/scope axes are proved in
 * `pivot.test.ts`; this is the UI proof the grid renders, re-levels, and drills.
 *
 *   # tier 3 (local CSS, no creds):
 *   deno task e2e:local test/e2e/solo/cube-pivot.spec.ts
 *   # tier 4 (real Pods):
 *   source test/.env.e2e.local && deno task e2e:remote:spec test/e2e/solo/cube-pivot.spec.ts
 *
 * Runs against Alice (account A). Skipped without creds.
 */

const ACC = account("A"); // Alice -- solo specs use one account

test.describe.configure({ mode: "serial" });

test.describe("cube pivot (feature-ladder roll-up)", () => {
  test.skip(
    !hasAccount(ACC),
    `Set WEBID_A_USERNAME / WEBID_A_PASSWORD (a throwaway Solid Pod) to run the cube-pivot e2e.`,
  );

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(T.setup);
    page = await newCapturedPage(browser, "cube-pivot");
    await login(page, ACC);
    await assertCleanStart(page);
    await ensureDemoBuildings(page);
  });

  test.afterAll(async () => {
    await verifyAndReset(page, "cube-pivot");
    await page.close();
  });

  test("the pivot renders building rows, rolls up to a region level, and a cell drills into the observation", async () => {
    test.setTimeout(T.testSolo);
    await page.goto("/");

    await openObservationsView(page, "pivot");

    // Building level (the default): each (building, year) cell is a role=button with
    // an aria-label "<name> — <metric> <year>: …". The bulk energy cube loads through
    // the buildings query, so retry until at least one cell has rendered.
    const cells = page.getByRole("button", { name: /—\s.*\d{4}\s*:/ });
    await expect(async () => {
      expect(await cells.count()).toBeGreaterThan(0);
    }).toPass({ timeout: T.poll, intervals: [1_500] });

    // The multi-year demo yields ≥1 populated cell (a numeric value, not the
    // no-data label).
    const valueCells = page.getByRole("button", {
      name: new RegExp(`—\\s.*\\d{4}\\s*:.*(?!${t("lensBandNoData")})\\d`),
    });
    await expect(valueCells.first()).toBeVisible({ timeout: T.action });

    // Roll up: pick the Land level. Region cells are labelled graphics (role=img),
    // not buttons — a roll-up is not a resource to open. The demo set appears either
    // under its geocoded Länder or in the "Without a region" bucket; both are rows.
    await page
      .getByRole("combobox", { name: t("pivotRowsLabel") })
      .click();
    await page
      .getByRole("option", { name: t("choroplethLevelLand"), exact: true })
      .click();
    await expect(page).toHaveURL(/rows=land/, { timeout: T.action });
    const regionCells = page.getByRole("img", { name: /—\s.*\d{4}\s*:/ });
    await expect(async () => {
      expect(await regionCells.count()).toBeGreaterThan(0);
    }).toPass({ timeout: T.poll, intervals: [1_500] });

    // Back at the finest grain, a populated cell hands off to that building's
    // OBSERVATION (energy) page — the same drill the over-time matrix does.
    await page
      .getByRole("combobox", { name: t("pivotRowsLabel") })
      .click();
    await page
      .getByRole("option", { name: t("pivotRowsBuilding"), exact: true })
      .click();
    await expect(valueCells.first()).toBeVisible({ timeout: T.action });
    await valueCells.first().click();
    await expect(page).toHaveURL(/\/observation\?/, { timeout: T.action });
  });
});
