import { expect, type Page, test } from "@playwright/test";
import { account, hasAccount } from "../helpers/login.ts";
import { deleteAllOwnedRooms, removeAllBookmarkedRooms } from "../helpers/rooms.ts";
import { freshPage, freshPagesParallel } from "../helpers/twoPod.ts";

/**
 * End-to-end building sharing across TWO throwaway Solid Pods, in ONE test (the
 * data room is the WebID directory, so no WebID is configured):
 *
 *   • write part — A hosts a room + takes the User role; B joins + takes the User
 *     role; A adds a building and shares it "By role" → User (the room resolves the
 *     role to B's WebID);
 *   • a 2 s cooldown;
 *   • read part — B logs in fresh (so `readInbox` archives the grant into B's
 *     `shared-in/`) and sees the building under "Buildings shared with you".
 *
 * Previously split into 4 single-account parts to stay under solidcommunity.net's
 * Cloudflare burst limit; on the reliable Pods (solidweb.org) it runs as one test
 * driving two browser contexts, and cleans up after itself (A deletes its building
 * + room in `finally`). Needs E2E_{USERNAME,PASSWORD}_A and _B; skipped without.
 *   npm run sharing            (headed:  npm run sharing -- --headed)
 */

const A = account("A");
const B = account("B");
const STREET = "Teilenstraße 7";

/** On the Connect tab, ensure an ACTIVE room (host one if none) and return ITS
 * URI — the room A actually shares from. Must read the active-room section, not
 * any "/rooms/" link, since the bookmark list also renders room links. */
async function hostRoomAndGetUri(page: Page): Promise<string> {
  await page.getByRole("tab", { name: "Connect" }).click();
  const leave = page.getByRole("button", { name: /leave data room/i });
  if (!(await leave.count())) {
    await page.getByRole("button", { name: /host a data room/i }).click();
    await expect(leave).toBeVisible({ timeout: 60_000 });
  }
  const activeRow = page.locator("li").filter({ has: leave });
  const activeLink = activeRow.locator('a[href*="/rooms/"]').first();
  await expect(activeLink).toBeVisible({ timeout: 60_000 });
  const uri = (await activeLink.getAttribute("href"))?.trim();
  expect(uri, "active room URI").toBeTruthy();
  await expect(leave).toBeEnabled({ timeout: 60_000 }).catch(() => {});
  return uri!;
}

/**
 * Assign the User role in the current room (MUI multi-select: open, tick, close,
 * save). Both A and B need a role: A to share targeted at the User role, B to
 * receive it.
 */
async function assignUserRole(page: Page): Promise<void> {
  await page.getByRole("tab", { name: "Connect" }).click();
  await page.waitForLoadState("networkidle").catch(() => {});
  const select = page.getByRole("combobox", { name: "My role(s)" });
  await expect(select).toBeVisible({ timeout: 15_000 });
  await select.click();
  const userOption = page.getByRole("option", { name: "User" });
  await expect(userOption).toBeVisible({ timeout: 10_000 });
  const alreadyUser = (await userOption.getAttribute("aria-selected")) === "true";
  if (!alreadyUser) await userOption.click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("listbox")).toBeHidden({ timeout: 5_000 }).catch(
    () => {},
  );
  if (alreadyUser) return;
  await expect(async () => {
    await page.getByRole("button", { name: /save roles/i }).click();
    await expect(page.getByText(/roles updated/i)).toBeVisible({
      timeout: 10_000,
    });
  }).toPass({ timeout: 60_000 });
}

/** On the Connect tab, add+enter a room URI and assign the User role. */
async function joinRoomAsUser(page: Page, roomUri: string): Promise<void> {
  await page.getByRole("tab", { name: "Connect" }).click();
  const row = page.locator("li").filter({ hasText: roomUri });
  if (!(await row.count())) {
    const uriField = page.getByLabel(/data room uri/i);
    const add = page.getByRole("button", { name: /^add$/i });
    await expect(async () => {
      if (await row.count()) return;
      await uriField.fill(roomUri);
      await expect(add).toBeEnabled({ timeout: 5_000 });
      await add.click();
      await expect(row.first()).toBeVisible({ timeout: 10_000 });
    }).toPass({ timeout: 90_000 });
  }
  const enter = row.first().getByRole("button", { name: /enter data room/i });
  if (await enter.count()) await enter.click();
  await expect(page.getByRole("button", { name: /leave data room/i }))
    .toBeVisible({ timeout: 30_000 });
  await assignUserRole(page);
}

/** Add a building (User template — only the location fields) with a given street. */
async function addBuilding(page: Page, street: string): Promise<void> {
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
async function shareByRole(page: Page, street: string): Promise<void> {
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

test.describe("sharing across two pods", () => {
  test.skip(
    !hasAccount(A) || !hasAccount(B),
    "Set E2E_{USERNAME,PASSWORD}_A and _B (throwaway Pods).",
  );

  test("A shares a building by role; B sees it under Buildings shared with you", async ({ browser }) => {
    test.setTimeout(420_000);
    // A and B's first logins are independent (B only needs A's room URI to JOIN,
    // not to log in), so run both ~50 s OIDC flows concurrently — one login's
    // wall-clock instead of two.
    const [a, b1] = await freshPagesParallel(browser, [A, B]);
    a.page.on("dialog", (d) => d.accept()); // cleanup confirms (delete building/room)
    try {
      // ── Write part: A hosts a room + role, B joins + role, A adds + shares ──
      const roomUri = await hostRoomAndGetUri(a.page);
      await assignUserRole(a.page);

      try {
        await joinRoomAsUser(b1.page, roomUri);
      } finally {
        await b1.ctx.close();
      }

      await addBuilding(a.page, STREET);
      await shareByRole(a.page, STREET);

      // ── 2 s cooldown between the write part and the read part ──
      await a.page.waitForTimeout(2000);

      // ── Read part: B logs in fresh → readInbox archives the grant → verify ──
      const b2 = await freshPage(browser, B);
      try {
        await b2.page.getByRole("tab", { name: "Share" }).click();
        const received = b2.page.getByRole("heading", {
          name: /buildings shared with you/i,
        }).locator("xpath=following-sibling::*[1]");
        try {
          await expect(received.getByText(/^Building /))
            .toBeVisible({ timeout: 120_000 });
        } catch (timeout) {
          b2.guard.assertNoAppErrors();
          throw timeout;
        }
      } finally {
        // Drop B's bookmark of A's room so it doesn't leak on B's Pod.
        await removeAllBookmarkedRooms(b2.page);
        await b2.ctx.close();
      }
    } finally {
      // Self-cleaning: A deletes its building + the room it hosted (best-effort).
      try {
        if (!a.page.isClosed()) {
          await a.page.getByRole("tab", { name: "Manage" }).click();
          const row = a.page.locator("li", { hasText: STREET }).first();
          if (await row.count()) {
            await row.getByRole("button", { name: "Delete building" }).click();
            await expect(a.page.getByText("Building deleted").first())
              .toBeVisible({ timeout: 90_000 });
          }
          await deleteAllOwnedRooms(a.page);
        }
      } catch {
        // best-effort cleanup; never fail the run
      }
      await a.ctx.close();
    }
  });
});
