import { expect, type Page, test } from "@playwright/test";
import { account, hasAccount, login, logout } from "./helpers/login.ts";

/**
 * End-to-end sharing across TWO throwaway Solid Pods, using the data room to
 * discover WebIDs (so no WebID needs to be configured):
 *
 *   1. A hosts a data room and reads its URI.
 *   2. B joins that room and assigns the "User" role.
 *   3. A seeds a building and shares it "By role" → User; the room resolves the
 *      role to B's WebID.
 *   4. B sees the building under "Buildings shared with you".
 *
 * Requires two disposable accounts (never real ones) — see e2e/helpers/login.ts
 * and e2e/README.md:
 *
 *   E2E_USERNAME_A / E2E_PASSWORD_A / [E2E_ISSUER_A]
 *   E2E_USERNAME_B / E2E_PASSWORD_B / [E2E_ISSUER_B]
 *
 * Skipped automatically when those are absent. Run:
 *   npm run sharing            (headed:  npm run sharing -- --headed)
 *
 * NOTE: drives the live login/consent UI; selectors are best-effort for
 * solidcommunity.net and may need adjusting per provider.
 */

const A = account("A");
const B = account("B");
const STREET = "Teilenstraße 7";

/** On the Meet tab, host a room if none is active, and return its URI. */
async function hostRoomAndGetUri(page: Page): Promise<string> {
  await page.getByRole("tab", { name: "Meet" }).click();
  const roomLink = page.getByRole("link", { name: /https?:\/\/.*\/rooms\// });
  // Host a room only if not already in one (a "Current data room" link is shown).
  if (!(await roomLink.count())) {
    await page.getByRole("button", { name: /host a data room/i }).click();
  }
  // The room (existing or freshly hosted) shows as the "Current data room" link.
  await expect(roomLink.first()).toBeVisible({ timeout: 60_000 });
  const uri = (await roomLink.first().textContent())?.trim();
  expect(uri, "active room URI").toBeTruthy();
  // Settle: wait until no action is in flight (the Leave button is enabled) so a
  // following logout doesn't fire mid-operation. Tolerant — proceeds anyway.
  await expect(page.getByRole("button", { name: /leave data room/i }))
    .toBeEnabled({ timeout: 60_000 }).catch(() => {});
  return uri!;
}

/**
 * Assign the User role in the current room (MUI multi-select: open, tick, close,
 * save). Both A and B need a role: A to unlock "Add Building" (which is gated on
 * holding a room role), B to receive the share targeted at the User role.
 */
async function assignUserRole(page: Page): Promise<void> {
  await page.getByRole("tab", { name: "Meet" }).click();
  // Skip if User is already selected (idempotent across reruns).
  const select = page.getByRole("combobox", { name: "My role(s)" });
  if (!/User/.test((await select.textContent()) ?? "")) {
    await select.click();
    await page.getByRole("option", { name: "User" }).click();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: /save roles/i }).click();
    await expect(page.getByText(/roles updated/i))
      .toBeVisible({ timeout: 15_000 }).catch(() => {});
  }
}

/** On the Meet tab, add+enter a room URI and assign the User role. */
async function joinRoomAsUser(page: Page, roomUri: string): Promise<void> {
  await page.getByRole("tab", { name: "Meet" }).click();
  await page.getByLabel(/data room uri/i).fill(roomUri);
  await page.getByRole("button", { name: /^add$/i }).click();
  // The bookmark appears under "Your data rooms"; click it to enter.
  await page.getByRole("button", { name: new RegExp(escapeRe(roomUri)) })
    .first().click();
  await expect(page.getByRole("button", { name: /leave data room/i }))
    .toBeVisible({ timeout: 30_000 });
  await assignUserRole(page);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

test.describe("sharing across two pods", () => {
  test.skip(
    !hasAccount(A) || !hasAccount(B),
    "Set E2E_{USERNAME,PASSWORD}_A and _B (throwaway Pods).",
  );

  test("A shares a building by role → B sees it", async ({ page }) => {
    test.setTimeout(360_000);
    await page.setViewportSize({ width: 1200, height: 900 });

    // ── A: host a room, take the User role (unlocks Add Building) ──
    await login(page, A);
    const roomUri = await hostRoomAndGetUri(page);
    await assignUserRole(page);

    // ── B: join the room, take the User role ──
    await logout(page);
    await login(page, B);
    await joinRoomAsUser(page, roomUri);

    // ── A: seed a building if none yet (Share tab → Add Building) ──
    await logout(page);
    await login(page, A);

    await page.getByRole("tab", { name: "Share" }).click();
    const dialog = page.getByRole("dialog");
    if (
      await page.getByText(/you haven't added any buildings yet/i).count()
    ) {
      await page.getByRole("button", { name: /^add building$/i }).click();
      await expect(dialog).toBeVisible({ timeout: 10_000 });
      // Pick the User role explicitly: A may hold several roles (e.g. investor
      // from prior runs), and the dialog would otherwise default to an
      // investor-shaped form whose extra required fields (buildingCode) block
      // submit. User needs only the address + coordinates filled below.
      await dialog.getByLabel("Role").click();
      await page.getByRole("option", { name: "User" }).click();
      await dialog.getByLabel(/street address/i).fill(STREET);
      await dialog.getByLabel(/locality/i).fill("Nürnberg");
      await dialog.getByLabel(/postal code/i).fill("90451");
      await dialog.getByLabel(/region/i).fill("Bayern");
      await dialog.getByLabel(/latitude/i).fill("49.45");
      await dialog.getByLabel(/longitude/i).fill("11.08");
      await dialog.getByRole("button", { name: /^add building$/i }).click();
      await expect(dialog).toBeHidden({ timeout: 30_000 });
      await page.waitForTimeout(2500); // let reloadData populate the building
    }

    // Share is triggered from the View tab: click the building's map marker, then
    // the Share button in its detail pane.
    await page.getByRole("tab", { name: "View" }).click();
    const marker = page.locator(".leaflet-marker-icon");
    await marker.first().waitFor({ timeout: 30_000 });
    await page.waitForTimeout(1500); // let the map settle so clicks register
    const shareBtn = page.getByRole("button", { name: "Share building data" });
    const count = await marker.count();
    for (let i = 0; i < count; i++) {
      await marker.nth(i).click({ force: true }).catch(() => {});
      if (await shareBtn.isVisible().catch(() => false)) break;
      await page.waitForTimeout(400);
    }
    await shareBtn.click();

    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await dialog.getByRole("button", { name: /by role/i }).click();
    await dialog.getByLabel("Role").click();
    await page.getByRole("option", { name: "User" }).click();
    await dialog.getByRole("button", { name: /review & share/i }).click();
    await dialog.getByRole("button", { name: /confirm share/i }).click();
    await expect(dialog.getByText(/shared successfully/i)).toBeVisible({
      timeout: 60_000,
    });
    await dialog.getByRole("button", { name: /done/i }).click();

    // ── B: confirm receipt under "Buildings shared with you" ──
    await logout(page);
    await login(page, B);
    await page.getByRole("tab", { name: "Share" }).click();
    const received = page.getByRole("heading", {
      name: /buildings shared with you/i,
    }).locator("xpath=following-sibling::*[1]");
    // The grant lands in B's registry on load; a reload may be needed.
    await expect(async () => {
      await page.reload();
      await page.getByRole("tab", { name: "Share" }).click();
      await expect(received.getByText(/^Building /)).toBeVisible({
        timeout: 5_000,
      });
    }).toPass({ timeout: 90_000 });
  });
});
