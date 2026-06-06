import { expect, type Page } from "@playwright/test";

/**
 * Manage-tab building/view helpers shared across the building/excel/sharing specs
 * (extracted from per-spec copies). Building rows render as "Building <id> — …".
 */

/** Locator for the building rows on Manage. */
export const buildingRows = (page: Page) =>
  page.locator("li", { hasText: /Building \S+/ });

/** The numeric/hash ids of all building rows currently listed on Manage. */
export async function buildingIds(page: Page): Promise<string[]> {
  const rows = buildingRows(page);
  const n = await rows.count();
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const id = (await rows.nth(i).textContent())?.match(/Building (\S+)/)?.[1];
    if (id) ids.push(id);
  }
  return ids;
}

/** Add a building (User template — only the location fields) with a given street. */
export async function addBuilding(page: Page, street: string): Promise<void> {
  await page.getByRole("tab", { name: "Manage" }).click();
  await page.getByRole("button", { name: /^add building$/i }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Template")).toBeVisible({ timeout: 15_000 });
  await dialog.getByLabel("Template").click();
  await page.getByRole("option", { name: "User" }).click();
  await dialog.getByLabel(/street address/i).fill(street);
  await dialog.getByLabel(/locality/i).fill("Nürnberg");
  await dialog.getByLabel(/postal code/i).fill("90451");
  await dialog.getByLabel(/region/i).fill("Bayern");
  await dialog.getByLabel(/latitude/i).fill("49.45");
  await dialog.getByLabel(/longitude/i).fill("11.08");
  await dialog.getByRole("button", { name: /^add building$/i }).click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });
}

/**
 * Add (or overwrite) an annual energy figure for `street` via the per-building
 * "Add or edit energy year" row action. `scenario` matches the Scenario option
 * (e.g. /^Actual$/, /^Planned/). Lifted from energy-entry.spec.ts so the sharing
 * specs can seed energy too.
 */
export async function addEnergyYear(
  page: Page,
  street: string,
  year: string,
  electricity: string,
  scenario: RegExp = /^Actual$/,
): Promise<void> {
  await page.getByRole("tab", { name: "Manage" }).click();
  const row = page.locator("li", { hasText: street }).first();
  await expect(row).toBeVisible({ timeout: 120_000 });
  await row.getByRole("button", { name: "Add or edit energy year" }).click();
  // The dialog's accessible name contains "year", so target inputs by exact
  // label / role to avoid matching the dialog itself.
  await page.getByRole("spinbutton", { name: "Year", exact: true }).fill(year);
  await page.getByLabel("Scenario", { exact: true }).click();
  await page.getByRole("option", { name: scenario }).click();
  await page.getByRole("spinbutton", { name: "Electricity (kWh)" })
    .fill(electricity);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Energy data saved").first())
    .toBeVisible({ timeout: 45_000 });
}

/**
 * Share the building at `street` with the room's User-role members, choosing the
 * "What to share" scope. With `years`, picks "energy for specific year(s)" and
 * ticks exactly those years; without, shares static + all energy (the default).
 */
export async function shareByRole(
  page: Page,
  street: string,
  years?: number[],
): Promise<void> {
  await page.getByRole("tab", { name: "Manage" }).click();
  await page.waitForLoadState("networkidle").catch(() => {});
  const row = page.locator("li", { hasText: street }).first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.getByRole("button", { name: "Share building data" }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await dialog.getByRole("button", { name: /by role/i }).click();
  await dialog.getByLabel("Role").click();
  await page.getByRole("option", { name: "User" }).click();

  if (years) {
    // Switch the energy scope to per-year and tick the requested year(s).
    await dialog.getByRole("radio", { name: /specific year/i }).check();
    for (const year of years) {
      await dialog.getByRole("checkbox", { name: String(year), exact: true })
        .check();
    }
  }

  // "Review & Share" resolves the role to member WebIDs over the network; retry
  // until the review step's Confirm appears.
  const confirm = dialog.getByRole("button", { name: /confirm share/i });
  await expect(async () => {
    await dialog.getByRole("button", { name: /review & share/i }).click();
    await expect(confirm).toBeVisible({ timeout: 10_000 });
  }).toPass({ timeout: 90_000 });
  await confirm.click();
  await expect(dialog.getByText(/shared successfully/i))
    .toBeVisible({ timeout: 120_000 });
  await dialog.getByRole("button", { name: /done/i }).click();
}

/** The aggregated view name the share-view spec creates and shares. */
export const VIEW_NAME = "E2E Shared View";

/** Create the shared view (idempotent: reuse an existing one with VIEW_NAME). */
export async function ensureView(page: Page): Promise<void> {
  await page.getByRole("tab", { name: "Manage" }).click();
  await page.waitForLoadState("networkidle").catch(() => {});
  if (await page.locator("li").filter({ hasText: VIEW_NAME }).count()) return;

  await page.getByRole("button", { name: /create view/i }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  // Investor template → annual buildings, metrics pre-selected, no month picker.
  await dialog.getByLabel("Role").click();
  await page.getByRole("option", { name: "Investor" }).click();
  await dialog.getByLabel("View Name").fill(VIEW_NAME);
  await dialog.getByLabel("Select Buildings").click();
  // Fail fast with a clear message if the picker is empty (no Investor buildings),
  // rather than hanging on a click that waits out the whole test timeout.
  const firstBuilding = page.getByRole("option").first();
  await expect(firstBuilding, "an Investor building to add to the view")
    .toBeVisible({ timeout: 15_000 });
  await firstBuilding.click();
  await page.keyboard.press("Escape");
  await dialog.getByRole("button", { name: /create view/i }).click();
  await expect(page.getByText(/view created successfully/i))
    .toBeVisible({ timeout: 60_000 });
}

/**
 * The Share-tab "Views shared with you" list (named via the `<ul>`'s aria-label).
 * Present only when at least one view is shared; for the empty state assert the
 * section's "no aggregated views…" text on the page directly.
 */
export const receivedViews = (page: Page) =>
  page.getByRole("list", { name: /views shared with you/i });
