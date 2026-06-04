import { expect, type Page, test } from "@playwright/test";
import { account, hasAccount, login } from "./helpers/login.ts";

/**
 * Storage-redesign smoke test (single account, a THROWAWAY Solid Pod — never a
 * real account). A *smoke* test is deliberately shallow and broad: it doesn't
 * verify every feature, it proves the app boots and the critical paths the
 * container-native storage redesign touched still work end-to-end in a real
 * browser. One login, run serially to stay gentle on the Pod's rate limiter:
 *
 *   1. Own buildings are discovered by LISTING `buildings/` (a fresh Pod seeds
 *      the demo buildings) → the Manage tab lists at least one building.
 *   2. Aggregated views are container-native → the Manage "Aggregated views"
 *      section renders (folding `views/` without error).
 *   3. Sharing is folded from `shared-in/` → the Share tab renders.
 *   4. Room state lives in `prefs.ttl` + `bookmarks.ttl` + `rooms/` → host a
 *      room (it becomes active), then delete it (cleans up after itself).
 *
 * Run against account B (solidweb.org — more reliable than solidcommunity.net):
 *
 *   source .env.e2e.local && deno task e2e e2e/storage-smoke.spec.ts
 *
 * Expects a Pod that has been used or freshly wiped (so the demo buildings are
 * present/seeded). Skipped automatically when the account env vars are absent.
 */

// Default to account B (the more reliable Pod); override with E2E_SMOKE_ACCOUNT=A.
const WHICH = (process.env.E2E_SMOKE_ACCOUNT === "A" ? "A" : "B") as "A" | "B";
const ACC = account(WHICH);
// solidweb.org writes + a re-read can be slow; allow a generous settle window.
const SETTLE = 45_000;

test.describe.configure({ mode: "serial" });

test.describe("storage redesign smoke", () => {
  test.skip(
    !hasAccount(ACC),
    `Set E2E_USERNAME_${WHICH} / E2E_PASSWORD_${WHICH} (a throwaway Solid Pod) to run the storage smoke.`,
  );

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(240_000); // login (IdP + consent) can be slow / retried
    page = await browser.newPage();
    // "Delete data room" confirms via window.confirm — accept automatically.
    page.on("dialog", (d) => d.accept());
    await login(page, ACC);
  });

  test.afterAll(async () => {
    await page.close();
  });

  test("Manage lists own buildings discovered by listing the container", async () => {
    test.setTimeout(180_000);
    await page.getByRole("tab", { name: "Manage" }).click();

    await expect(page.getByRole("heading", { name: "Your buildings" }))
      .toBeVisible({ timeout: SETTLE });

    // At least one building row (a fresh Pod seeds the two demo buildings; a used
    // Pod already has them). Proves discoverOwnBuildings + listDirectChildren ran.
    await expect(page.getByText(/^Building /).first())
      .toBeVisible({ timeout: 120_000 });

    // The aggregated-views section renders — folding views/ without error.
    await expect(page.getByRole("heading", { name: "Aggregated views" }))
      .toBeVisible({ timeout: SETTLE });
  });

  test("Share tab renders (folds the shared-in/ log)", async () => {
    await page.getByRole("tab", { name: "Share" }).click();
    await expect(
      page.getByRole("heading", { name: "Buildings shared with you" }),
    ).toBeVisible({ timeout: SETTLE });
  });

  test("Connect: host a room (active), then delete it", async () => {
    test.setTimeout(240_000);
    await page.getByRole("tab", { name: "Connect" }).click();

    const roomHrefs = () =>
      page.locator('li a[href*="/rooms/"]').evaluateAll((els) =>
        els.map((e) => (e as HTMLAnchorElement).getAttribute("href") ?? "")
      );

    const before = new Set(await roomHrefs());
    await page.getByRole("button", { name: /host a data room/i }).click();
    await expect(page.getByText("Data room created").first())
      .toBeVisible({ timeout: SETTLE });

    let uri = "";
    await expect(async () => {
      uri = (await roomHrefs()).find((h) => h && !before.has(h)) ?? "";
      expect(uri, "the newly-hosted room should appear").toBeTruthy();
    }).toPass({ timeout: SETTLE });

    const row = page.locator("li").filter({ hasText: uri });
    // Hosting enters it → it's the active room (prefs.ttl currentRoom).
    await expect(row.getByRole("button", { name: "Leave data room" }))
      .toBeVisible({ timeout: SETTLE });

    // Clean up.
    await row.getByRole("button", { name: "Delete data room" }).click();
    await expect(page.getByText("Data room deleted").first())
      .toBeVisible({ timeout: SETTLE });
    await expect(page.locator("li").filter({ hasText: uri }))
      .toHaveCount(0, { timeout: SETTLE });
  });
});
