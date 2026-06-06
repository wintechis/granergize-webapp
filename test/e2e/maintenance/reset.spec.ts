import { expect, test } from "@playwright/test";
import { account, hasAccount, login } from "../helpers/login.ts";

/**
 * Maintenance utility (NOT a test of the app): wipe the e2e app collection
 * (VITE_POD_APP_DIR, e.g. `granergize-e2e/`) for BOTH roles — A (Alice) and
 * B (Bob) — so a Tier-4 run starts from a clean slate. Because Tier 4 writes only
 * to that throwaway collection — never the real `granergize/` — this can't touch
 * real data. Each role self-skips if its account isn't configured. It drives the
 * app's own "Remove all app data" action, so it reuses the exact auth + delete
 * path the app uses (and a 404 collection is treated as already-empty, so
 * resetting a fresh Pod still succeeds).
 *
 *   source test/.env.e2e.local && deno task e2e:remote:reset
 */
for (const slot of ["A", "B"]) {
  const acc = account(slot);

  test.describe(`reset (${slot})`, () => {
    test.skip(
      !hasAccount(acc),
      `Set E2E_USERNAME_${slot} / E2E_PASSWORD_${slot} to reset that account.`,
    );

    test("wipe the e2e app collection", async ({ browser }) => {
      test.setTimeout(240_000); // login (IdP + consent) + a full recursive delete

      const page = await browser.newPage();
      // The wipe asks for confirmation via window.confirm — accept it.
      page.on("dialog", (d) => d.accept());

      await login(page, acc);

      // "Remove all app data" lives behind the footer Developer-mode toggle;
      // flip it on (reactive — the menu item appears without a reload).
      await page.getByLabel("Developer mode").check();

      await page.getByRole("button", { name: "Account menu" }).click();
      await page.getByRole("menuitem", { name: /Remove all app data/i }).click();

      // Success notification fires whether the collection had data or was already
      // empty/absent (a 404 delete is treated as already-gone).
      await expect(page.getByText("All app data removed", { exact: false }))
        .toBeVisible({ timeout: 180_000 });

      await page.close();
    });
  });
}
