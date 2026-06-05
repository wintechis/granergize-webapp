import { type Browser, expect, type Page, test } from "@playwright/test";
import { account, hasAccount, login, type SolidAccount } from "./helpers/login.ts";
import { watchAppErrors } from "./helpers/errorGuard.ts";
import { deleteAllOwnedRooms, removeAllBookmarkedRooms } from "./helpers/rooms.ts";

/**
 * Aggregated-VIEW sharing across TWO throwaway Pods (PROBLEMS.md #17 + #21), in
 * ONE test (the data room is the WebID directory, so no WebID is configured):
 *
 *   • A hosts a room + role; B joins + role; A creates a view and shares it with B
 *     via the dialog's room-members "Add" (ShareViewDialog has no "by role");
 *   • 2 s cooldown → B sees it under "Views shared with you" and the values render;
 *   • A deletes the view (revokes + notifies B via `revokeAllViewRecipients`);
 *   • 2 s cooldown → B no longer sees it (the revocation folded it out).
 *
 * Was 6 single-account parts to stay under solidcommunity.net's Cloudflare burst
 * limit; on reliable Pods it runs as one test driving two contexts, self-cleaning
 * (the view is deleted as part of the flow; A's room in `finally`). Needs
 * E2E_{USERNAME,PASSWORD}_A and _B; skipped without them.
 */

const A = account("A");
const B = account("B");
const VIEW_NAME = "E2E Shared View";

/** On the Connect tab, ensure an ACTIVE room (host one if none) and return ITS URI. */
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

/** Assign the User role in the current room (MUI multi-select: open, tick, save). */
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

/** A fresh isolated context logged into one account. */
async function freshPage(browser: Browser, acc: SolidAccount): Promise<{
  ctx: Awaited<ReturnType<Browser["newContext"]>>;
  page: Page;
  guard: ReturnType<typeof watchAppErrors>;
}> {
  const ctx = await browser.newContext({
    viewport: { width: 1200, height: 900 },
  });
  const page = await ctx.newPage();
  const guard = watchAppErrors(page);
  await login(page, acc);
  return { ctx, page, guard };
}

/** Create the shared view (idempotent: reuse an existing one with VIEW_NAME). */
async function ensureView(page: Page): Promise<void> {
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
  await page.getByRole("option").first().click();
  await page.keyboard.press("Escape");
  await dialog.getByRole("button", { name: /create view/i }).click();
  await expect(page.getByText(/view created successfully/i))
    .toBeVisible({ timeout: 60_000 });
}

/** The Share-tab "Views shared with you" section locator. */
const receivedViews = (page: Page) =>
  page.getByRole("heading", { name: /views shared with you/i })
    .locator("xpath=following-sibling::*[1]");

test.describe("view sharing across two pods", () => {
  test.skip(
    !hasAccount(A) || !hasAccount(B),
    "Set E2E_{USERNAME,PASSWORD}_A and _B (throwaway Pods).",
  );

  test("A shares a view; B sees it, then A deletes it and B no longer sees it", async ({ browser }) => {
    test.setTimeout(540_000);
    const a = await freshPage(browser, A);
    a.page.on("dialog", (d) => d.accept()); // Delete view / room confirms
    try {
      // ── A hosts a room + role; B joins + role; A creates + shares the view ──
      const roomUri = await hostRoomAndGetUri(a.page);
      await assignUserRole(a.page);

      const b1 = await freshPage(browser, B);
      try {
        await joinRoomAsUser(b1.page, roomUri);
      } finally {
        await b1.ctx.close();
      }

      await ensureView(a.page);
      const viewRow = a.page.locator("li").filter({ hasText: VIEW_NAME }).first();
      await viewRow.getByRole("button", { name: "Share view" }).click();
      const shareDlg = a.page.getByRole("dialog");
      await expect(shareDlg).toBeVisible({ timeout: 10_000 });
      // Add B from the room-members list (B joined + took a role above).
      const add = shareDlg.getByRole("button", { name: /^add$/i });
      await expect(add.first()).toBeVisible({ timeout: 30_000 });
      await add.first().click();
      const confirm = shareDlg.getByRole("button", { name: /confirm share/i });
      await expect(async () => {
        await shareDlg.getByRole("button", { name: /review & share/i }).click();
        await expect(confirm).toBeVisible({ timeout: 10_000 });
      }).toPass({ timeout: 90_000 });
      await confirm.click();
      await expect(shareDlg.getByText(/shared successfully/i))
        .toBeVisible({ timeout: 120_000 });
      await shareDlg.getByRole("button", { name: /close/i }).click();

      // ── 2 s cooldown → B sees the view + its values ──
      await a.page.waitForTimeout(2000);
      const b2 = await freshPage(browser, B);
      try {
        await b2.page.getByRole("tab", { name: "Share" }).click();
        try {
          await expect(receivedViews(b2.page).getByText(VIEW_NAME))
            .toBeVisible({ timeout: 120_000 });
          await b2.page.getByRole("button", { name: /show values/i }).first()
            .click();
          await expect(b2.page.locator("svg.recharts-surface").first())
            .toBeVisible({ timeout: 60_000 });
        } catch (timeout) {
          b2.guard.assertNoAppErrors();
          throw timeout;
        }
      } finally {
        await b2.ctx.close();
      }

      // ── A deletes the view (revokes + notifies B) ──
      await a.page.getByRole("tab", { name: "Manage" }).click();
      await a.page.waitForLoadState("networkidle").catch(() => {});
      const del = a.page.locator("li").filter({ hasText: VIEW_NAME })
        .getByRole("button", { name: "Delete view" });
      for (let i = 0; i < 10; i++) {
        if (!(await del.count())) break;
        await del.first().click();
        await expect(a.page.getByText("View deleted").first())
          .toBeVisible({ timeout: 45_000 }).catch(() => {});
      }

      // ── 2 s cooldown → B no longer sees the view ──
      await a.page.waitForTimeout(2000);
      const b3 = await freshPage(browser, B);
      try {
        await b3.page.getByRole("tab", { name: "Share" }).click();
        try {
          // Positive empty-state assertion: the list loaded AND the view is gone.
          await expect(
            receivedViews(b3.page).getByText(
              /no aggregated views have been shared with you/i,
            ),
          ).toBeVisible({ timeout: 120_000 });
          await expect(receivedViews(b3.page).getByText(VIEW_NAME)).toHaveCount(0);
        } catch (timeout) {
          b3.guard.assertNoAppErrors();
          throw timeout;
        }
      } finally {
        // Drop B's bookmark of A's room so it doesn't leak on B's Pod.
        await removeAllBookmarkedRooms(b3.page);
        await b3.ctx.close();
      }
    } finally {
      // Self-cleaning: the view was deleted above; tear down A's room.
      try {
        if (!a.page.isClosed()) await deleteAllOwnedRooms(a.page);
      } catch {
        // best-effort cleanup; never fail the run
      }
      await a.ctx.close();
    }
  });
});
