import { expect, type Page, test } from "@playwright/test";
import { account, hasAccount, login } from "../helpers/login.ts";

/**
 * Energy per-year entry + planned/actual (Soll-Ist) e2e. Self-cleaning: it adds
 * its own throwaway building, writes a fixed year (2099) actual + planned
 * `gran:EnergyDataset` to it, proves the *actual* figure flows back through
 * `loadEnergy` into the energy view (with the Recharts SVG chart), then deletes
 * the building in afterAll — which removes its whole energy subtree, so nothing
 * leaks. The Soll-Ist *planned* overlay legend is covered deterministically by the
 * `MetricBarChart` unit test (actual + "(planned)").
 *
 *   # tier 3 (local CSS, no creds):
 *   deno task e2e:local test/e2e/tasks/energy-entry.spec.ts
 *   # tier 4 (real Pods):
 *   source test/.env.e2e.local && deno task e2e:remote:spec test/e2e/tasks/energy-entry.spec.ts
 *
 * Runs against Alice (account A). Skipped
 * without creds.
 */

const YEAR = "2099"; // fixed far-future year; re-runs overwrite it (idempotent)
const ADDR = "Energy Entry E2E Strasse 1"; // unique address for the building

const ACC = account("A"); // Alice -- solo specs use one account

test.describe.configure({ mode: "serial" });

test.describe("energy entry + Soll-Ist", () => {
  test.skip(
    !hasAccount(ACC),
    `Set E2E_USERNAME_A / E2E_PASSWORD_A (a throwaway Solid Pod) to run the energy-entry e2e.`,
  );

  let page: Page;
  let id = "";

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(240_000);
    page = await browser.newPage();
    // "Delete building" confirms via window.confirm — accept automatically.
    page.on("dialog", (d) => d.accept().catch(() => {}));
    await login(page, ACC);

    // Add a throwaway building to write the year to (deleted in afterAll).
    await page.getByRole("tab", { name: "Manage" }).click();
    const addBtn = page.getByRole("button", { name: "Add Building", exact: true })
      .first();
    await expect(addBtn).toBeVisible({ timeout: 120_000 });
    await addBtn.click();
    const add = page.getByRole("dialog");
    await add.getByLabel("Template").click();
    await page.getByRole("option", { name: "User", exact: true }).click();
    await add.getByLabel(/street address/i).fill(ADDR);
    await add.getByLabel(/locality/i).fill("Nürnberg");
    await add.getByLabel(/postal code/i).fill("90451");
    await add.getByLabel(/region/i).fill("Bayern");
    await add.getByLabel(/latitude/i).fill("49.45");
    await add.getByLabel(/longitude/i).fill("11.08");
    await add.getByRole("button", { name: /^Add Building$/ }).click();
    await expect(page.getByText(/building added/i))
      .toBeVisible({ timeout: 120_000 });

    // Capture its (generated, non-numeric) id from the Manage row.
    const row = page.locator("li", { hasText: ADDR }).first();
    await expect(row).toBeVisible({ timeout: 60_000 });
    id = (await row.textContent())?.match(/Building (\S+)/)?.[1] ?? "";
    expect(id, "the added building's id").toBeTruthy();
  });

  test.afterAll(async () => {
    // The delete below waits up to 90 s for its toast, so the default 30 s hook
    // budget is too tight — give it room, else a slow delete fails teardown even
    // though the test body passed.
    test.setTimeout(120_000);
    // Delete the building → removes its energy subtree, so the year doesn't leak.
    try {
      if (!page.isClosed()) {
        // The last test left us on the standalone /energy/:id route (no app shell,
        // so no Manage tab) — return to the shell first, else the click below hangs
        // until the hook timeout. Mirrors building-details.spec.ts cleanup.
        await page.goto("/#/");
        await page.getByRole("tab", { name: "Manage" }).click();
        const row = page.locator("li", { hasText: ADDR }).first();
        if (await row.count()) {
          await row.getByRole("button", { name: "Delete building" }).click();
          await expect(page.getByText("Building deleted").first())
            .toBeVisible({ timeout: 90_000 });
        }
      }
    } catch {
      // best-effort cleanup; never fail teardown
    } finally {
      await page.close();
    }
  });

  async function addEnergyYear(scenario: RegExp, electricity: string) {
    // The "Add / edit energy year" trigger is a per-building row action on Manage.
    await page.getByRole("tab", { name: "Manage" }).click();
    const row = page.locator("li", { hasText: ADDR }).first();
    await expect(row).toBeVisible({ timeout: 120_000 });
    await row.getByRole("button", { name: "Add or edit energy year" }).click();
    // The dialog's accessible name contains "year", so target inputs by exact
    // label / role to avoid matching the dialog itself.
    await page.getByRole("spinbutton", { name: "Year", exact: true }).fill(YEAR);
    await page.getByLabel("Scenario", { exact: true }).click();
    await page.getByRole("option", { name: scenario }).click();
    await page.getByRole("spinbutton", { name: "Electricity (kWh)" })
      .fill(electricity);
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Energy data saved").first())
      .toBeVisible({ timeout: 45_000 });
  }

  test("enter both an actual and a planned figure for a year", async () => {
    test.setTimeout(180_000);
    await addEnergyYear(/^Actual$/, "88888");
    await addEnergyYear(/^Planned/, "70000"); // "Planned (Soll)"
  });

  test("the actual figure flows into the building's energy view", async () => {
    test.setTimeout(120_000);
    // 2099 is the building's only/latest actual year, so loadEnergy surfaces our
    // electricity figure (de-DE formatted "88.888,00") in the energy-need table.
    await page.goto(`/#/energy/${id}`);
    await expect(page.getByText("88.888,00").first())
      .toBeVisible({ timeout: 90_000 });
    // The migrated chart is a Recharts SVG (not a canvas) — assert it draws.
    await expect(page.locator("svg.recharts-surface").first())
      .toBeVisible({ timeout: 90_000 });
  });
});
