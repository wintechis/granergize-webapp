import { expect, type Page, test } from "@playwright/test";

/**
 * Captures the in-app guide screenshots (public/guide/*.png) by driving the
 * logged-in app. Requires a THROWAWAY Solid Pod — never a real account — passed
 * via env so no credentials live in the repo:
 *
 *   E2E_USERNAME=...  E2E_PASSWORD=...  [E2E_ISSUER=https://solidcommunity.net] \
 *     npm run screenshots
 *
 * Skipped automatically when those env vars are absent (so CI / `npm run
 * test:e2e` never needs credentials).
 *
 * NOTE: the identity-provider login + consent pages are provider-specific and
 * change over time; the selectors below are best-effort for solidcommunity.net
 * and may need adjusting. Run headed to debug:  npm run screenshots -- --headed
 */

const ISSUER = process.env.E2E_ISSUER ?? "https://solidcommunity.net";
const USERNAME = process.env.E2E_USERNAME ?? "";
const PASSWORD = process.env.E2E_PASSWORD ?? "";
const OUT = "public/guide";

async function login(page: Page) {
  await page.goto("/");

  // Pick the matching recommended provider, or type a custom issuer.
  const host = new URL(ISSUER).host;
  const recommended = page.getByRole("button", {
    name: new RegExp(host.replace(/\./g, "\\."), "i"),
  });
  if (await recommended.count()) {
    await recommended.first().click();
  } else {
    await page.getByLabel(/Identity Provider/i).fill(ISSUER);
    await page.getByRole("button", { name: "+" }).click();
  }

  // Identity-provider login form (best-effort selectors).
  await page.waitForLoadState("domcontentloaded");
  const user = page.locator(
    'input[name="username"], input[name="email"], input[type="email"], input#username, input#email',
  ).first();
  await user.waitFor({ timeout: 30_000 });
  await user.fill(USERNAME);
  await page.locator('input[type="password"], input[name="password"]').first()
    .fill(PASSWORD);
  await page.getByRole("button", { name: /log ?in|sign ?in|anmelden/i }).first()
    .click();

  // CSS ("Pivot") consent page — "An application is requesting full access" with
  // an Authorize button. It can take a few redirects to appear.
  const authorize = page.getByRole("button", {
    name: /authorize|consent|allow|continue|zustimmen|erlauben/i,
  });
  await authorize.first().click({ timeout: 45_000 }).catch(() => {});

  // Back in the app, it may show "Loading…", then a first-login "remember this
  // identity provider?" prompt, then the tabs. Poll: dismiss the prompt if/when
  // it appears, and only finish once it's gone AND the tabs are present (so we
  // don't return on a transient flicker between the two screens).
  const remember = page.getByRole("button", {
    name: /save login info|no,? thanks/i,
  });
  await expect(async () => {
    if (await remember.count()) await remember.first().click().catch(() => {});
    await expect(remember).toHaveCount(0, { timeout: 1000 });
    await expect(page.getByRole("tab", { name: "Room" })).toBeVisible({
      timeout: 1000,
    });
  }).toPass({ timeout: 120_000 });
}

async function shot(page: Page, name: string) {
  await page.screenshot({ path: `${OUT}/${name}`, animations: "disabled" });
}

test.describe("guide screenshots", () => {
  test.skip(
    !USERNAME || !PASSWORD,
    "Set E2E_USERNAME and E2E_PASSWORD (a throwaway Solid Pod) to capture screenshots.",
  );

  test("capture", async ({ page }) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width: 1200, height: 900 });
    await login(page);

    // --- Room: be in a room with a role (seeds an empty Pod so the rest of the
    //     app has something to show) ---
    await page.getByRole("tab", { name: "Room" }).click();
    const leave = page.getByRole("button", { name: /leave room/i });
    if (!(await leave.count())) {
      await page.getByRole("button", { name: /create a room/i }).click();
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

    // --- Seed one building (only if none yet) so Sharing/Map/Views have data ---
    await page.getByRole("tab", { name: "Sharing" }).click();
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

    // --- Map: select a building marker → its Building/Energy/Weather tabs ---
    await page.getByRole("tab", { name: "Map" }).click();
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
