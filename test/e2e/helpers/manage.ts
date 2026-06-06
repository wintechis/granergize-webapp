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

/** Share the building at `street` with the room's User-role members. */
export async function shareByRole(page: Page, street: string): Promise<void> {
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

/** The Share-tab "Views shared with you" section locator. */
export const receivedViews = (page: Page) =>
  page.getByRole("heading", { name: /views shared with you/i })
    .locator("xpath=following-sibling::*[1]");
