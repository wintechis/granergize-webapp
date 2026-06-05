import { type Browser, expect, type Page, test } from "@playwright/test";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { account, hasAccount, login, type SolidAccount } from "./helpers/login.ts";
import { watchAppErrors } from "./helpers/errorGuard.ts";
import { deleteAllOwnedRooms } from "./helpers/rooms.ts";

/**
 * Aggregated-VIEW sharing across TWO throwaway Pods (PROBLEMS.md #17). Mirrors
 * `sharing.spec.ts` (which shares a building): the data room is the WebID
 * directory, so no WebID is configured.
 *
 *   1. A hosts a data room + takes the User role.
 *   2. B joins that room + takes the User role.
 *   3. A creates an aggregated view and shares it with B via the dialog's
 *      "Data room members" list (ShareViewDialog has no "by role").
 *   4. B sees it under "Views shared with you" and opens the computed values.
 *
 * Needs E2E_{USERNAME,PASSWORD}_A and _B (throwaway Pods); skipped without them.
 * Split into 4 single-account parts (run in order, with cooldowns) to stay under
 * the live Pod's rate limit — same rationale as `sharing.spec.ts`:
 *   source .env.e2e.local && deno task e2e -g "view part 1"   # A hosts + role
 *   …wait…  deno task e2e -g "view part 2"                    # B joins + role
 *   …wait…  deno task e2e -g "view part 3"                    # A creates + shares
 *   …wait…  deno task e2e -g "view part 4"                    # B sees it
 */

const A = account("A");
const B = account("B");
const VIEW_NAME = "E2E Shared View";

// ── Room helpers (mirror sharing.spec.ts; the room is the WebID directory) ──

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

// Room URI handoff between parts (own state file — don't clobber sharing.spec's).
const STATE_FILE = new URL("./.view-sharing-state.local.json", import.meta.url);
const saveRoomUri = (roomUri: string) =>
  writeFileSync(STATE_FILE, JSON.stringify({ roomUri }, null, 2));
function loadRoomUri(): string {
  if (!existsSync(STATE_FILE)) {
    throw new Error('No saved room URI — run "view part 1" first.');
  }
  return JSON.parse(readFileSync(STATE_FILE, "utf8")).roomUri as string;
}

/** Create the shared view (idempotent: reuse an existing one with VIEW_NAME). */
async function ensureView(page: Page): Promise<void> {
  await page.getByRole("tab", { name: "Manage" }).click();
  await page.waitForLoadState("networkidle").catch(() => {});
  const existing = page.locator("li").filter({ hasText: VIEW_NAME });
  if (await existing.count()) return;

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
  await expect(page.getByText(/view created successfully/i)).toBeVisible({
    timeout: 60_000,
  });
}

test.describe("view sharing across two pods", () => {
  test.skip(
    !hasAccount(A) || !hasAccount(B),
    "Set E2E_{USERNAME,PASSWORD}_A and _B (throwaway Pods).",
  );

  test("view part 1: A hosts a room and takes the User role", async ({ browser }) => {
    test.setTimeout(300_000);
    const { ctx, page } = await freshPage(browser, A);
    try {
      const roomUri = await hostRoomAndGetUri(page);
      await assignUserRole(page);
      saveRoomUri(roomUri);
    } finally {
      await ctx.close();
    }
  });

  test("view part 2: B joins the room and takes the User role", async ({ browser }) => {
    test.setTimeout(300_000);
    const roomUri = loadRoomUri();
    const { ctx, page } = await freshPage(browser, B);
    try {
      await joinRoomAsUser(page, roomUri);
    } finally {
      await ctx.close();
    }
  });

  test("view part 3: A creates a view and shares it with B", async ({ browser }) => {
    test.setTimeout(300_000);
    const { ctx, page } = await freshPage(browser, A);
    try {
      await ensureView(page);

      const viewRow = page.locator("li").filter({ hasText: VIEW_NAME }).first();
      await viewRow.getByRole("button", { name: "Share view" }).click();

      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible({ timeout: 10_000 });
      // Add B from the room-members list (B joined + took a role in part 2).
      const add = dialog.getByRole("button", { name: /^add$/i });
      await expect(add.first()).toBeVisible({ timeout: 30_000 });
      await add.first().click();

      const confirm = dialog.getByRole("button", { name: /confirm share/i });
      await expect(async () => {
        await dialog.getByRole("button", { name: /review & share/i }).click();
        await expect(confirm).toBeVisible({ timeout: 10_000 });
      }).toPass({ timeout: 90_000 });
      await confirm.click();
      await expect(dialog.getByText(/shared successfully/i)).toBeVisible({
        timeout: 120_000,
      });
      await dialog.getByRole("button", { name: /close/i }).click();
    } finally {
      await ctx.close();
    }
  });

  test("view part 4: B sees the view under Views shared with you", async ({ browser }) => {
    test.setTimeout(300_000);
    // On login, readInbox archives the View grant into B's shared-in/ and
    // invalidates the receivedViews query, so it appears without a reload.
    const { ctx, page, guard } = await freshPage(browser, B);
    try {
      await page.getByRole("tab", { name: "Share" }).click();
      const section = page.getByRole("heading", {
        name: /views shared with you/i,
      }).locator("xpath=following-sibling::*[1]");
      try {
        await expect(section.getByText(VIEW_NAME)).toBeVisible({
          timeout: 120_000,
        });
        // Open the computed values — the SVG bar chart proves the snapshot loaded.
        await page.getByRole("button", { name: /show values/i }).first().click();
        await expect(page.locator("svg.recharts-surface").first()).toBeVisible({
          timeout: 60_000,
        });
      } catch (timeout) {
        guard.assertNoAppErrors();
        throw timeout;
      }
    } finally {
      await ctx.close();
    }
  });

  // Explicit final cleanup (only runs on a full sequential run or `-g "view part
  // 5"`, so the 4-part resume workflow is untouched): delete the view A created
  // and the room A hosted, else both leak on the Pod on every run.
  test("view part 5: clean up the view and room A hosted", async ({ browser }) => {
    test.setTimeout(300_000);
    const { ctx, page } = await freshPage(browser, A);
    // "Delete view"/"Delete data room" confirm via window.confirm — auto-accept.
    page.on("dialog", (d) => d.accept());
    try {
      // Best-effort: remove every view named VIEW_NAME so it doesn't accumulate.
      try {
        await page.getByRole("tab", { name: "Manage" }).click();
        await page.waitForLoadState("networkidle").catch(() => {});
        const del = page.locator("li").filter({ hasText: VIEW_NAME })
          .getByRole("button", { name: "Delete view" });
        for (let i = 0; i < 10; i++) {
          if (!(await del.count())) break;
          await del.first().click();
          await expect(page.getByText("View deleted").first())
            .toBeVisible({ timeout: 45_000 }).catch(() => {});
        }
      } catch {
        // cleanup is best-effort; never fail the run
      }
      await deleteAllOwnedRooms(page);
      if (existsSync(STATE_FILE)) unlinkSync(STATE_FILE);
    } finally {
      await ctx.close();
    }
  });
});
