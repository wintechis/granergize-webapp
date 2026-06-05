import { expect, type Page, test } from "@playwright/test";
import { account, hasAccount, login } from "./helpers/login.ts";

/**
 * Energy per-year entry + planned/actual (Soll-Ist) e2e. MUTATES the Pod: writes
 * a fixed far-future year (2099) actual + planned `gran:EnergyDataset` for a
 * seeded building — re-running overwrites the same resources (idempotent). Proves
 * the new entry form writes both scenarios, and that the *actual* figure flows
 * back through `loadEnergy` into the energy view (where the chart is now a
 * Recharts SVG, so we also assert the chart surface draws). The Soll-Ist *planned*
 * overlay legend renders on the Explore detail's annual chart — covered
 * deterministically by the `MetricBarChart` unit test (actual + "(planned)").
 *
 *   source .env.e2e.local && deno task e2e energy-entry
 *
 * Defaults to account B (solidweb.org); E2E_SMOKE_ACCOUNT=A to switch. Skipped
 * without creds. Needs a Pod seeded by the current code (wipe + reseed first).
 */

const WHICH = (process.env.E2E_SMOKE_ACCOUNT === "A" ? "A" : "B") as "A" | "B";
const ACC = account(WHICH);
const YEAR = "2099"; // fixed far-future year; re-runs overwrite it (idempotent)

test.describe.configure({ mode: "serial" });

test.describe("energy entry + Soll-Ist", () => {
  test.skip(
    !hasAccount(ACC),
    `Set E2E_USERNAME_${WHICH} / E2E_PASSWORD_${WHICH} (a throwaway Solid Pod) to run the energy-entry e2e.`,
  );

  let page: Page;
  let id = "";

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(240_000);
    page = await browser.newPage();
    await login(page, ACC);
    // An own building's id from Manage ("Building <id> — …").
    await page.getByRole("tab", { name: "Manage" }).click();
    const row = page.getByText(/^Building \d+/).first();
    await expect(row).toBeVisible({ timeout: 120_000 });
    id = (await row.textContent())?.match(/Building (\d+)/)?.[1] ?? "";
    expect(id, "a seeded building id").toBeTruthy();
  });

  test.afterAll(async () => {
    await page.close();
  });

  async function addEnergyYear(scenario: RegExp, electricity: string) {
    // The "Add / edit energy year" trigger is a per-building row action on the
    // Manage tab (write actions live there; the map's detail pane is view-only).
    await page.getByRole("tab", { name: "Manage" }).click();
    const row = page.locator("li", {
      hasText: new RegExp(`Building ${id}(?!\\d)`),
    }).first();
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
    // 2099 is now the latest actual year, so loadEnergy surfaces our electricity
    // figure (de-DE formatted "88.888,00") in the energy-need table.
    await page.goto(`/#/energy/${id}`);
    await expect(page.getByText("88.888,00").first())
      .toBeVisible({ timeout: 90_000 });
    // The migrated chart is a Recharts SVG (not a canvas) — assert it draws.
    await expect(page.locator("svg.recharts-surface").first())
      .toBeVisible({ timeout: 90_000 });
  });
});
