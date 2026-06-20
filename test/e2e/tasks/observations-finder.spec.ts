import { expect, type Page, test } from "@playwright/test";
import { t } from "../helpers/i18n.ts";
import { account, hasAccount, login } from "../helpers/login.ts";
import {
  addBuilding,
  addEnergyYear,
  buildingIdOf,
  deleteBuildingRow,
  openBuildingsList,
} from "../helpers/manage.ts";
import { newCapturedPage } from "../helpers/consoleLog.ts";
import { assertCleanStart, verifyAndReset } from "../helpers/cleanSlate.ts";
import { T } from "../helpers/timeouts.ts";

/**
 * Redesign e2e — the Observations finder (`/observations`), the 6th finder in the
 * top-nav. One observation collection per building today (`/observation/:id` is
 * keyed by the building id), so the finder lists every building carrying
 * `cons:hasEnergyDataset` data and each row opens that building's observation
 * (energy) page. Seeds a building + one energy year, asserts it appears under
 * Observations with a year read-out, and that the row opens `/observation/:id`.
 * Self-cleaning.
 *
 *   deno task e2e:local test/e2e/tasks/observations-finder.spec.ts
 *
 * Runs against Alice (account A); skipped when account env vars are absent.
 */
const ACC = account("A");
const ADDR = "Observations Finder Strasse 1";
const YEAR = "2024";

test.describe.configure({ mode: "serial" });

test.describe("redesign: observations finder", () => {
  test.skip(
    !hasAccount(ACC),
    `Set WEBID_A_USERNAME / WEBID_A_PASSWORD (a throwaway Solid Pod) to run the observations-finder e2e.`,
  );

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(T.setup);
    page = await newCapturedPage(browser, "observations-finder");
    page.on("dialog", (d) => d.accept().catch(() => {})); // delete-building confirm
    await login(page, ACC);
    await assertCleanStart(page);
  });

  test.afterAll(async () => {
    await verifyAndReset(page, "observations-finder");
    await page.close();
  });

  test("lists a building with observation data and opens its observation page", async () => {
    test.setTimeout(T.testSolo);

    // A building with one entered year is one observation collection.
    await addBuilding(page, ADDR);
    await addEnergyYear(page, ADDR, YEAR, "12345");

    // The Observations finder lists buildings that carry energy data.
    await page.getByRole("tab", { name: t("navObservations") }).click();
    const row = page.locator("li[data-building-id]", { hasText: ADDR }).first();
    await expect(row).toBeVisible({ timeout: T.action });
    const id = await buildingIdOf(row);
    if (!id) throw new Error("observations-finder: missing building id");

    // The row reads out the year(s) and opens the observation detail page.
    await expect(row.getByText(new RegExp(YEAR))).toBeVisible();
    await row.getByRole("link").first().click();
    await expect(page).toHaveURL(/\/observation\?/, { timeout: T.action });

    // Cleanup: delete the throwaway building from the Buildings list.
    await page.goto("/");
    await openBuildingsList(page);
    await deleteBuildingRow(page, id);
  });
});
