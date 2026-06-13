import { expect, type Page, test } from "@playwright/test";
import { account, hasAccount, login } from "../helpers/login.ts";
import { confirmDialog } from "../helpers/confirm.ts";
import { addEnergyYear, buildingRoute } from "../helpers/manage.ts";
import { newCapturedPage } from "../helpers/consoleLog.ts";
import { assertCleanStart, verifyAndReset } from "../helpers/cleanSlate.ts";
import { T } from "../helpers/timeouts.ts";

/**
 * Temporal-resolution toggle e2e. A building may carry BOTH an annual
 * aggregate (`P1Y`) and a sub-hourly series (`PT15M`); the energy surfaces
 * (`/energy/:id` and the map's Energy tab) must then offer the
 * Annual | Time series toggle (`EnergyResolutionSwitch`) instead of silently
 * showing only the annual view — the regression this spec guards (the series
 * chart used to be unreachable whenever annual data existed).
 *
 * Self-cleaning: imports the Lastgang fixture as a throwaway building (the
 * only UI path that mints a series), adds an annual year to the same
 * building, asserts both surfaces, then deletes the building in afterAll —
 * which removes its whole energy subtree.
 *
 *   # tier 3 (local CSS, no creds):
 *   deno task e2e:local test/e2e/tasks/energy-resolutions.spec.ts
 *   # tier 4 (real Pods):
 *   source test/.env.e2e.local && deno task e2e:remote:spec test/e2e/tasks/energy-resolutions.spec.ts
 *
 * Runs against Alice (account A). Skipped without creds.
 */

const YEAR = "2095"; // fixed far-future year; re-runs overwrite it (idempotent)
const ADDR = "Energy Resolution E2E Strasse 1"; // unique address for the building

const ACC = account("A"); // Alice -- solo specs use one account

test.describe.configure({ mode: "serial" });

test.describe("energy resolution toggle", () => {
  test.skip(
    !hasAccount(ACC),
    `Set E2E_USERNAME_A / E2E_PASSWORD_A (a throwaway Solid Pod) to run the energy-resolutions e2e.`,
  );

  let page: Page;
  let id = "";

  test.beforeAll(async ({ browser }) => {
    // Import (building + a month of day-file PUTs) on top of login — give the
    // setup the long-operation budget, not just the login one.
    test.setTimeout(T.longOp);
    page = await newCapturedPage(browser, "energy-resolutions");
    // "Delete building" confirms via window.confirm — accept automatically.
    page.on("dialog", (d) => d.accept().catch(() => {}));
    // Keep the import independent of Nominatim's availability (the address is
    // filled manually below, but address edits trigger a geocode attempt).
    await page.route(/nominatim\.openstreetmap\.org/, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([{ lat: "49.45", lon: "11.08" }]),
      }));
    await login(page, ACC);
    await assertCleanStart(page);

    // Import the Lastgang fixture — the building arrives with a PT15M series.
    await page.getByRole("tab", { name: "Manage" }).click();
    const addBtn = page.getByRole("button", { name: "Add Building", exact: true })
      .first();
    await expect(addBtn).toBeVisible({ timeout: T.action });
    await addBtn.click();
    const dialog = page.getByRole("dialog");
    await dialog.locator('input[type="file"]').setInputFiles(
      "test/e2e/fixtures/lastgang-import.xlsx",
    );
    await expect(page.getByText(/readings.*days.*ready to upload/))
      .toBeVisible({ timeout: T.action });
    // The Lastgang file carries only a label + readings (no address) — fill the
    // required location fields manually to enable submit.
    await dialog.getByLabel(/street address/i).fill(ADDR);
    await dialog.getByLabel(/locality/i).fill("Nürnberg");
    await dialog.getByLabel(/postal code/i).fill("90451");
    await dialog.getByLabel(/region/i).fill("Bayern");
    await dialog.getByLabel(/latitude/i).fill("49.45");
    await dialog.getByLabel(/longitude/i).fill("11.08");
    await dialog.getByRole("button", { name: /^Add (Building|\d+ Buildings)$/ })
      .click();
    // The upload PUTs a building plus ~32 daily reading files — long on a real
    // Pod, so wait with the long-operation budget.
    await expect(page.getByText(/buildings? added/i).first())
      .toBeVisible({ timeout: T.longOp });

    // Capture its (generated) id from the Manage row's data attribute.
    const row = page.locator("li", { hasText: ADDR }).first();
    await expect(row).toBeVisible({ timeout: T.action });
    id = (await row.getAttribute("data-building-id")) ?? "";
    expect(id, "the imported building's id").toBeTruthy();

    // Add an annual figure to the SAME building → it now carries both kinds.
    await addEnergyYear(page, ADDR, YEAR, "77777");
  });

  test.afterAll(async () => {
    test.setTimeout(T.afterAll);
    // Delete the building → removes its energy subtree (series files included).
    try {
      if (!page.isClosed()) {
        // The first test left us on the standalone /energy/:id route (no app
        // shell, so no Manage tab) — return to the shell first.
        await page.goto("/#/");
        await page.getByRole("tab", { name: "Manage" }).click();
        const row = page.locator("li", { hasText: ADDR }).first();
        if (await row.count()) {
          await row.getByRole("button", { name: "Delete building" }).click();
          await confirmDialog(page, "Delete");
          await expect(page.getByText("Building deleted").first())
            .toBeVisible({ timeout: T.action });
        }
      }
    } catch {
      // best-effort cleanup; never fail teardown
    } finally {
      await verifyAndReset(page, "energy-resolutions");
      await page.close();
    }
  });

  test("/energy/:id offers the toggle and reaches the series chart", async () => {
    test.setTimeout(T.testSolo);
    await page.goto(buildingRoute("energy", id));
    // Annual is the default view — the entered figure shows (de-DE formatted).
    await expect(page.getByText("77.777,00").first())
      .toBeVisible({ timeout: T.action });
    // Both resolutions exist, so the toggle renders.
    const seriesBtn = page.getByRole("button", { name: "Time series" });
    await expect(seriesBtn).toBeVisible({ timeout: T.action });
    // Switching reaches the series chart — its Day-View tab strip renders
    // (this was unreachable while annual data existed).
    await seriesBtn.click();
    await expect(page.getByRole("tab", { name: "Day View" }))
      .toBeVisible({ timeout: T.action });
    await expect(page.getByText("77.777,00").first()).toBeHidden();
    // And back: the annual view returns.
    await page.getByRole("button", { name: "Annual" }).click();
    await expect(page.getByText("77.777,00").first())
      .toBeVisible({ timeout: T.action });
  });

  test("the map's Energy tab offers the same toggle", async () => {
    test.setTimeout(T.testSolo);
    // Select the (only) building marker — assumes a pristine collection,
    // guaranteed by the per-spec CSS reset (Tier 3) or the per-run
    // granergize-e2e-<uuid> collection (Tier 4).
    await page.goto("/#/");
    await page.getByRole("tab", { name: "Explore" }).click();
    const marker = page.locator(".leaflet-marker-icon").first();
    await expect(marker).toBeVisible({ timeout: T.action });
    await marker.click({ force: true });
    await page.getByRole("tab", { name: "Energy data" }).click();
    // Default = the annual view (AnnualEnergy lists the entered year).
    await expect(page.getByText(YEAR).first())
      .toBeVisible({ timeout: T.action });
    // Toggle to the series → the Day-View tab strip renders here too.
    await page.getByRole("button", { name: "Time series" }).click();
    await expect(page.getByRole("tab", { name: "Day View" }))
      .toBeVisible({ timeout: T.action });
  });
});
