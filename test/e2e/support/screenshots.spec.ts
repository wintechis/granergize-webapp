import { expect, type Locator, type Page, test } from "@playwright/test";
import {
  account,
  hasAccount,
  login,
  LOGIN_HEADING,
  webIdOf,
} from "../helpers/login.ts";
import { freshPage } from "../helpers/twoPod.ts";

/**
 * Captures the Praxishandbuch figures (docs/figures/*.png) by driving the
 * logged-in app. Uses account **A** (a solidcommunity.net Pod — the sharing pair)
 * so the handbuch shows canonical solidcommunity.net WebIDs/URIs. THROWAWAY Pod
 * only — never a real account — passed via env so no credentials live in the repo:
 *
 *   E2E_USERNAME_A=...  E2E_PASSWORD_A=...  [E2E_PROVIDER_A=solidcommunity] \
 *   E2E_USERNAME_B=...  E2E_PASSWORD_B=...  [E2E_PROVIDER_B=...] \
 *     deno task e2e:remote:spec test/e2e/support/screenshots.spec.ts
 *
 * Most figures need only account A. The last figure (shared-with-you.png — the
 * recipient's "Buildings shared with you" list) needs account **B** too: A shares
 * a building with B by WebID, then B logs in and we capture B's Share tab. When B
 * is unconfigured that one shot is skipped (the committed figure is kept); the
 * whole run is skipped when A is absent (so CI / a no-cred run needs no creds).
 * Run headed to debug:
 *   deno task e2e:remote:spec test/e2e/support/screenshots.spec.ts -- --headed
 */

const ACC = account("A");
// A WebID to seed the Contacts address book before its screenshot. Prefer a
// configured account's WebID (resolves to a real name/avatar); fall back to the
// handbuch's example WebID so the figure still shows a populated list.
const CONTACT_WEBID = account("B").webId || ACC.webId ||
  "https://maxmustermann.solidcommunity.net/profile/card#me";
const OUT = "docs/figures";
// Cooldown after every screenshot. Its only purpose is to let a Cloudflare-fronted
// provider's rate limit relax between request bursts, so it's only long when A's
// provider is throttled (e.g. solidcommunity.net); on a plain CSS (e.g. redpencil)
// a short settle is enough and keeps the whole run a few minutes.
const COOLDOWN_MS = ACC.provider.throttled ? 16_000 : 2_000;

async function shot(page: Page, name: string) {
  await page.screenshot({ path: `${OUT}/${name}`, animations: "disabled" });
  await page.waitForTimeout(COOLDOWN_MS);
}

/** Screenshot a single element (a focused figure), then the same cooldown. */
async function shotOf(locator: Locator, name: string) {
  await locator.screenshot({ path: `${OUT}/${name}`, animations: "disabled" });
  await locator.page().waitForTimeout(COOLDOWN_MS);
}

/**
 * Best-effort dismiss of any open snackbar toast. TIME-BOXED on purpose: this
 * project's default action timeout is 0 (wait forever), so an unbounded click on
 * a non-existent close button would hang the whole run. Scoped to a "Close"
 * button (the snackbar's), never the role=alert banners (the fresh-Pod onboarding
 * Alert has no close button, so an alert-scoped close-click would never resolve).
 */
async function dismissToasts(page: Page) {
  await page.getByRole("button", { name: /^close$/i }).first()
    .click({ timeout: 4_000 }).catch(() => {});
}

test.describe("handbuch screenshots", () => {
  test.skip(
    !hasAccount(ACC),
    "Set E2E_USERNAME_A and E2E_PASSWORD_A (a throwaway solidcommunity.net Pod) to capture screenshots.",
  );

  test("capture", async ({ page, browser }) => {
    // Bounded by the cooldown cost: ~11 shots × COOLDOWN_MS plus two logins and
    // the cross-pod share. On a throttled provider that's many minutes; on a plain
    // CSS it's ~3–4 min. Every best-effort interaction is itself time-boxed (the
    // default action timeout is 0 = wait forever), so a stuck locator fails in
    // seconds rather than eating this cap.
    test.setTimeout(ACC.provider.throttled ? 720_000 : 300_000);
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

    // --- Seed account A's organisation (name + logo) so the producer's building
    //     marker shows the logo on the map (the "Daten ansehen" figure,
    //     map-tabs.png, demonstrates the logo-marker feature). A building added
    //     below attributes its provenance to A, so its marker resolves this logo. ---
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("menuitem", { name: /organisation/i }).click();
    const orgDialog = page.getByRole("dialog");
    await expect(orgDialog).toBeVisible({ timeout: 30_000 });
    await orgDialog.getByLabel("Company name")
      .fill("Friedrich-Alexander-Universität Erlangen-Nürnberg");
    // Set a company kind too: buildings A adds get a PROV attribution to A only
    // when the profile has a producer role, and that attribution is what makes the
    // map marker resolve A's org logo (no kind → no provenance → default pin).
    await orgDialog.getByLabel("Kind of company").click();
    await page.getByRole("option", { name: "User", exact: true }).click();
    await orgDialog.locator('input[type="file"]')
      .setInputFiles("test/e2e/fixtures/fau-logo.png");
    await expect(orgDialog.getByAltText("Organisation logo"))
      .toBeVisible({ timeout: 15_000 });
    await orgDialog.getByRole("button", { name: /^save$/i }).click();
    await expect(page.getByText(/organisation saved/i))
      .toBeVisible({ timeout: 60_000 });
    // Dismiss the toast so it doesn't linger into the next (room) screenshot.
    await dismissToasts(page);
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

    // Dismiss the "Roles updated" toast, then the fresh-Pod "No buildings yet"
    // onboarding banner (an Alert with "Add examples"/"No thanks" and NO close
    // button — declining it persists and clears its role=alert so it can't shadow
    // later dismisses or the Contacts field). Both are time-boxed.
    await dismissToasts(page);
    await page.getByRole("button", { name: "No thanks" })
      .click({ timeout: 8_000 }).catch(() => {});

    // --- Contacts: seed one address-book entry, then capture the Contacts
    //     section at the top of the Connect tab. The list is otherwise empty on
    //     a fresh Pod, so the figure would read "No contacts yet". ---
    // Let the room-creation/role-save network burst settle so the Contacts field
    // is stable before we fill it (an unstable element stalls fill).
    await page.waitForLoadState("networkidle").catch(() => {});
    const webIdField = page.getByRole("textbox", { name: "WebID" });
    await webIdField.waitFor({ state: "visible", timeout: 30_000 });
    await webIdField.fill(CONTACT_WEBID, { timeout: 15_000 });
    const addContact = page.getByRole("button", { name: "Add contact" });
    await expect(addContact).toBeEnabled({ timeout: 10_000 });
    await addContact.click();
    await expect(page.getByRole("list", { name: "Contacts" }))
      .toBeVisible({ timeout: 30_000 }).catch(() => {});
    await dismissToasts(page);
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

    // --- Energy-year dialog: the per-year consumption form plus the "Stored
    //     years" read-back table, opened from a building's "Add or edit energy
    //     year" row action. Seed a year first so the table isn't empty — saving
    //     keeps the dialog open, so the shot shows both the table (with its
    //     edit/delete row actions) and the form below. ---
    const energyYearBtn = page.getByRole("button", {
      name: "Add or edit energy year",
    }).first();
    if (await energyYearBtn.count()) {
      await energyYearBtn.click();
      await expect(page.getByRole("dialog")).toBeVisible({ timeout: 10_000 });
      // Only seed if this building has no stored years yet (idempotent re-runs).
      const stored = page.getByRole("dialog").getByRole("row", {
        name: /\b2023\b/,
      });
      if (!(await stored.count())) {
        await page.getByRole("spinbutton", { name: "Year", exact: true })
          .fill("2023");
        await page.getByRole("spinbutton", { name: "Electricity (kWh)" })
          .fill("125000");
        await page.getByRole("spinbutton", { name: "Heat (kWh)" }).fill("48000");
        await page.getByRole("spinbutton", { name: "Water (m³)", exact: true })
          .fill("310");
        await page.getByRole("button", { name: "Save" }).click();
        await expect(page.getByText("Energy data saved").first())
          .toBeVisible({ timeout: 30_000 });
      }
      await page.waitForTimeout(500);
      await shot(page, "energy-year.png");
      await page.getByRole("button", { name: "Close" }).click();
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

    // --- Recipient side of sharing (shared-with-you.png): A shares its building
    //     with B by WebID, then B logs in fresh and we capture B's "Buildings
    //     shared with you" list — the payoff figure for the sharing chapter.
    //     Needs account B; when unset we keep the committed figure and skip. ---
    const B = account("B");
    if (!hasAccount(B)) {
      console.warn(
        "Account B not configured (E2E_USERNAME_B/PASSWORD_B); keeping the " +
          "committed shared-with-you.png and skipping its recapture.",
      );
      return;
    }
    const b = await freshPage(browser, B);
    try {
      // B's authoritative WebID is discovered after login (not built from creds).
      const bWebId = await webIdOf(b.page);

      // A shares its first building by B's WebID (mirrors manage.ts shareByWebId,
      // but targets the first row so it doesn't depend on a known street).
      await page.getByRole("tab", { name: "Manage" }).click();
      const aRow = page.locator("li").filter({
        has: page.getByRole("button", { name: "Share building data" }),
      }).first();
      await aRow.getByRole("button", { name: "Share building data" }).click();
      const shareDialog = page.getByRole("dialog");
      await expect(shareDialog).toBeVisible({ timeout: 10_000 });
      await shareDialog.getByRole("button", { name: /by webid/i }).click();
      const recipientInput = shareDialog.getByLabel(/Recipient WebID/i);
      await recipientInput.fill(bWebId);
      await recipientInput.press("Enter");
      const confirm = shareDialog.getByRole("button", { name: /confirm share/i });
      await expect(async () => {
        await shareDialog.getByRole("button", { name: /review & share/i }).click();
        await expect(confirm).toBeVisible({ timeout: 10_000 });
      }).toPass({ timeout: 90_000 });
      await confirm.click();
      await expect(shareDialog.getByText(/shared successfully/i))
        .toBeVisible({ timeout: 120_000 });
      await shareDialog.getByRole("button", { name: /done/i }).click();

      // Cooldown, then B drains its inbox by reloading (Login restores the
      // session → drainInbox archives the grant into shared-in/).
      await page.waitForTimeout(COOLDOWN_MS);
      await b.page.reload();
      await b.page.getByRole("tab", { name: "Share" }).click();
      await expect(
        b.page.getByRole("list", { name: /buildings shared with you/i })
          .getByText(/^Building /),
      ).toBeVisible({ timeout: 120_000 });
      // B owns no buildings, so dismiss B's own fresh-Pod "No buildings yet"
      // banner (bounded) and let the inbox-drain network settle, so the figure
      // shows only the received-buildings list.
      await b.page.getByRole("button", { name: "No thanks" })
        .click({ timeout: 8_000 }).catch(() => {});
      await b.page.waitForLoadState("networkidle").catch(() => {});
      await b.page.evaluate(() => globalThis.scrollTo(0, 0));
      await b.page.waitForTimeout(800);
      await shot(b.page, "shared-with-you.png");
    } finally {
      await b.ctx.close();
    }
  });
});
