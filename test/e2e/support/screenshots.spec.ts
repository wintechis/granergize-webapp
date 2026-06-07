import { expect, type Locator, type Page, test } from "@playwright/test";
import { account, hasAccount, login, LOGIN_HEADING } from "../helpers/login.ts";

/**
 * Captures the Praxishandbuch figures (docs/figures/*.png) by driving the
 * logged-in app. Uses account **A** (a solidcommunity.net Pod — the sharing pair)
 * so the handbuch shows canonical solidcommunity.net WebIDs/URIs. THROWAWAY Pod
 * only — never a real account — passed via env so no credentials live in the repo:
 *
 *   E2E_USERNAME_A=...  E2E_PASSWORD_A=...  [E2E_PROVIDER_A=solidcommunity] \
 *     deno task e2e:remote:spec test/e2e/support/screenshots.spec.ts
 *
 * Skipped automatically when those env vars are absent (so CI / a no-cred run
 * never needs credentials). Run headed to debug:
 *   deno task e2e:remote:spec test/e2e/support/screenshots.spec.ts -- --headed
 */

const ACC = account("A");
// A WebID to seed the Contacts address book before its screenshot. Prefer a
// configured account's WebID (resolves to a real name/avatar); fall back to the
// handbuch's example WebID so the figure still shows a populated list.
const CONTACT_WEBID = account("B").webId || ACC.webId ||
  "https://maxmustermann.solidcommunity.net/profile/card#me";
const OUT = "docs/figures";
// Account A is solidcommunity.net (behind Cloudflare). Each step here is a burst
// of Pod requests; a cooldown after every screenshot lets the rate limit relax
// before the next segment, so a full capture run doesn't trip 429s.
const COOLDOWN_MS = 16_000;

async function shot(page: Page, name: string) {
  await page.screenshot({ path: `${OUT}/${name}`, animations: "disabled" });
  await page.waitForTimeout(COOLDOWN_MS);
}

/** Screenshot a single element (a focused figure), then the same cooldown. */
async function shotOf(locator: Locator, name: string) {
  await locator.screenshot({ path: `${OUT}/${name}`, animations: "disabled" });
  await locator.page().waitForTimeout(COOLDOWN_MS);
}

test.describe("handbuch screenshots", () => {
  test.skip(
    !hasAccount(ACC),
    "Set E2E_USERNAME_A and E2E_PASSWORD_A (a throwaway solidcommunity.net Pod) to capture screenshots.",
  );

  test("capture", async ({ page }) => {
    // Very generous: the slow C Pod (login + role assignment) plus seven 16 s
    // cooldowns between shots can take well over five minutes end to end.
    test.setTimeout(900_000);
    await page.setViewportSize({ width: 1200, height: 900 });

    // --- Login screen (captured BEFORE logging in) (anmelden.png — handbuch figure).
    //     The Login component shows a ~2 s "Loading…" while it tries to restore a
    //     previous session; on a fresh context that resolves to the IdP picker. ---
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: LOGIN_HEADING }),
    ).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: /solidcommunity\.net/i }).first()
      .waitFor({ timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(500);
    await shot(page, "anmelden.png");

    await login(page, ACC);

    // --- Seed a company logo so the producer's building marker shows it on the
    //     map (the "Daten ansehen" figure, map-tabs.png, demonstrates the
    //     logo-marker feature). We upload the app's own mark (public/favicon.svg)
    //     as account A's org logo; a building added below attributes its
    //     provenance to A, so its marker resolves this logo. ---
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("menuitem", { name: /organisation/i }).click();
    const orgDialog = page.getByRole("dialog");
    await expect(orgDialog).toBeVisible({ timeout: 30_000 });
    await orgDialog.locator('input[type="file"]').setInputFiles("public/favicon.svg");
    await expect(orgDialog.getByAltText("Organisation logo"))
      .toBeVisible({ timeout: 15_000 });
    await orgDialog.getByRole("button", { name: /^save$/i }).click();
    await expect(page.getByText(/organisation saved/i))
      .toBeVisible({ timeout: 60_000 });
    // Dismiss the toast so it doesn't linger into the next (room) screenshot.
    await page.getByRole("alert").getByRole("button", { name: /close/i }).click()
      .catch(() => {});
    await page.waitForTimeout(1000);

    // --- Meet: be in a room with a role (seeds an empty Pod so the rest of the
    //     app has something to show) ---
    await page.getByRole("tab", { name: "Connect" }).click();
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

    // Dismiss the "Roles updated" toast so it doesn't linger into the later
    // (unrelated) Manage screenshots.
    await page.getByRole("alert").getByRole("button", { name: /close/i }).click()
      .catch(() => {});

    // --- Contacts: seed one address-book entry, then capture the Contacts
    //     section at the top of the Connect tab. The list is otherwise empty on
    //     a fresh Pod, so the figure would read "No contacts yet". ---
    await page.getByLabel("WebID").fill(CONTACT_WEBID);
    await page.getByRole("button", { name: "Add contact" }).click();
    await expect(page.getByRole("list", { name: "Contacts" }))
      .toBeVisible({ timeout: 30_000 }).catch(() => {});
    await page.getByRole("alert").getByRole("button", { name: /close/i }).click()
      .catch(() => {});
    await page.waitForTimeout(1000);
    await page.evaluate(() => globalThis.scrollTo(0, 0));
    await shot(page, "contacts.png");

    // --- Data: seed one building (only if none yet) so Share/View/Views have
    //     data; the Add Building dialog now lives on the Manage tab ---
    await page.getByRole("tab", { name: "Manage" }).click();
    const dialog = page.getByRole("dialog");
    // A per-building row action (only present once a building has loaded) and the
    // empty-state text. WAIT for the list to settle into one or the other before
    // reading state / screenshotting — on the slow C Pod it shows "Loading…" for
    // several seconds, during which the empty-state check would wrongly read
    // "no buildings" and share-building.png would capture a "Loading…" panel.
    const shareAction = page.getByRole("button", { name: "Share building data" })
      .first();
    const emptyState = page.getByText(/you haven't added any buildings yet/i);
    await Promise.race([
      shareAction.waitFor({ state: "visible", timeout: 60_000 }).catch(() => {}),
      emptyState.waitFor({ state: "visible", timeout: 60_000 }).catch(() => {}),
    ]);
    const noBuildings = (await emptyState.count()) > 0;

    // Add Building dialog — capture it (role is assigned, so it shows the form).
    await page.getByRole("button", { name: /^add building$/i }).click();
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(500);
    await shot(page, "add-building.png");

    if (noBuildings) {
      // Pick the User template so the form needs only address + coordinates.
      await dialog.getByLabel("Template").click();
      await page.getByRole("option", { name: "User" }).click();
      await dialog.getByLabel(/street address/i).fill("Musterstraße 1");
      await dialog.getByLabel(/locality/i).fill("Nürnberg");
      await dialog.getByLabel(/postal code/i).fill("90451");
      await dialog.getByLabel(/region/i).fill("Bayern");
      await dialog.getByLabel(/latitude/i).fill("49.45");
      await dialog.getByLabel(/longitude/i).fill("11.08");
      await dialog.getByRole("button", { name: /^add building$/i }).click();
      await expect(dialog).toBeHidden({ timeout: 30_000 });
    } else {
      await page.keyboard.press("Escape");
    }

    // Manage tab now lists the building with its per-row actions (edit / share /
    // download / delete) — the subject of the sharing section. Wait for a row's action
    // to be present so the screenshot isn't a "Loading…" panel.
    await expect(shareAction).toBeVisible({ timeout: 60_000 });
    await page.waitForTimeout(500);
    await page.evaluate(() => globalThis.scrollTo(0, 0));
    await shot(page, "share-building.png");

    // --- Manage row actions: a focused shot of one building row showing the
    //     per-building actions (edit / files / energy year / share / download /
    //     delete) — the subject of "Gebäude bearbeiten, Dateien … und löschen" ---
    const buildingRow = page.locator("li").filter({
      has: page.getByRole("button", { name: "Share building data" }),
    }).first();
    await buildingRow.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(300);
    await shotOf(buildingRow, "manage-actions.png");

    // --- Energy-year dialog: the per-year consumption form (Soll/Ist), opened
    //     from a building's "Add or edit energy year" row action ---
    const energyYearBtn = page.getByRole("button", {
      name: "Add or edit energy year",
    }).first();
    if (await energyYearBtn.count()) {
      await energyYearBtn.click();
      await expect(page.getByRole("dialog")).toBeVisible({ timeout: 10_000 });
      await page.waitForTimeout(500);
      await shot(page, "energy-year.png");
      await page.keyboard.press("Escape");
    }

    // --- Manage: aggregated views (Create View lives here, with buildings) ---
    await page.getByRole("tab", { name: "Manage" }).click();
    await page.waitForTimeout(500);

    // --- Create View dialog (a building is now selectable) ---
    await page.getByRole("button", { name: /create view/i }).click();
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(500);
    await shot(page, "create-view.png");
    await page.keyboard.press("Escape");

    // --- Explore: select a building marker → its Building/Energy/Weather tabs ---
    await page.getByRole("tab", { name: "Explore" }).click();
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
