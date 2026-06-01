import { expect, type Page, test } from "@playwright/test";
import { account, hasAccount, login } from "./helpers/login.ts";

/**
 * Captures the in-app guide screenshots (public/guide/*.png) by driving the
 * logged-in app. Requires a THROWAWAY Solid Pod — never a real account — passed
 * via env so no credentials live in the repo (see e2e/README.md):
 *
 *   E2E_USERNAME=...  E2E_PASSWORD=...  [E2E_ISSUER=https://solidcommunity.net] \
 *     npm run screenshots
 *
 * Skipped automatically when those env vars are absent (so CI / `npm run
 * test:e2e` never needs credentials). Run headed to debug:
 *   npm run screenshots -- --headed
 */

const A = account("A");
const OUT = "public/guide";

async function shot(page: Page, name: string) {
  await page.screenshot({ path: `${OUT}/${name}`, animations: "disabled" });
}

test.describe("guide screenshots", () => {
  test.skip(
    !hasAccount(A),
    "Set E2E_USERNAME and E2E_PASSWORD (a throwaway Solid Pod) to capture screenshots.",
  );

  test("capture", async ({ page }) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width: 1200, height: 900 });
    await login(page, A);

    // --- Meet: be in a room with a role (seeds an empty Pod so the rest of the
    //     app has something to show) ---
    await page.getByRole("tab", { name: "Meet" }).click();
    const leave = page.getByRole("button", { name: /leave data room/i });
    if (!(await leave.count())) {
      await page.getByRole("button", { name: /host a data room/i }).click();
      await expect(leave).toBeVisible({ timeout: 30_000 });
    }
    // Assign the User role (MUI multi-select: open, tick, close, save).
    const roleSelect = page.getByRole("combobox", { name: "My role(s)" });
    await roleSelect.click();
    await page.getByRole("option", { name: "User" }).click();
    await page.keyboard.press("Escape");
    await expect(roleSelect).toContainText("User", { timeout: 5_000 }).catch(
      () => {},
    );
    await page.getByRole("button", { name: /save roles/i }).click();
    await expect(page.getByText(/roles updated/i)).toBeVisible({ timeout: 15_000 })
      .catch(() => {});
    await page.waitForTimeout(1000);
    await page.evaluate(() => globalThis.scrollTo(0, 0));
    await shot(page, "room.png");

    // --- Seed one building (only if none yet) so Share/View/Views have data ---
    await page.getByRole("tab", { name: "Share" }).click();
    const dialog = page.getByRole("dialog");

    // Add Building dialog — capture it (role is now assigned, so it shows the form).
    await page.getByRole("button", { name: /add building/i }).click();
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(500);
    await shot(page, "add-building.png");

    if (await page.getByText(/you don't own any buildings yet/i).count()) {
      await dialog.getByLabel(/street address/i).fill("Musterstraße 1");
      await dialog.getByLabel(/locality/i).fill("Nürnberg");
      await dialog.getByLabel(/postal code/i).fill("90451");
      await dialog.getByLabel(/region/i).fill("Bayern");
      await dialog.getByLabel(/latitude/i).fill("49.45");
      await dialog.getByLabel(/longitude/i).fill("11.08");
      await dialog.getByRole("button", { name: /^add building$/i }).click();
      await expect(dialog).toBeHidden({ timeout: 30_000 });
      await page.waitForTimeout(2500); // let reloadData populate the building
    } else {
      await page.keyboard.press("Escape");
    }
    await shot(page, "sharing.png");

    // --- Create View dialog (a building is now selectable) ---
    await page.getByRole("button", { name: /create view/i }).click();
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(500);
    await shot(page, "create-view.png");
    await page.keyboard.press("Escape");

    // --- View: select a building marker → its Building/Energy/Weather tabs ---
    await page.getByRole("tab", { name: "View" }).click();
    const markers = page.locator(".leaflet-marker-icon");
    await markers.first().waitFor({ timeout: 20_000 }).catch(() => {});
    await page.waitForTimeout(1500); // let the map settle so clicks register
    const buildingTab = page.getByRole("tab", { name: "Building data" });
    // Overlapping pins can swallow a click — try each until the detail pane opens.
    const count = await markers.count();
    for (let i = 0; i < count; i++) {
      await markers.nth(i).click({ force: true }).catch(() => {});
      if (await buildingTab.isVisible().catch(() => false)) break;
      await page.waitForTimeout(400);
    }
    await page.evaluate(() => globalThis.scrollTo(0, 0));
    await page.waitForTimeout(800);
    await shot(page, "map-tabs.png");
  });
});
