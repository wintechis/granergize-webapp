import { expect, test } from "@playwright/test";
import { account, hasAccount, login, logout } from "../helpers/login.ts";
import { newCapturedPage } from "../helpers/consoleLog.ts";
import { watchAppErrors } from "../helpers/errorGuard.ts";
import { T } from "../helpers/timeouts.ts";

/**
 * Logout e2e — logging out must be clean: no error notifications while the
 * session tears down. Regression spec for the eviction-order bug where
 * `queryClient.clear()` ran while the app shell was still mounted: every
 * active query refetched immediately (an emptied cache bypasses
 * `refetchOnMount: false`) into the just-cleared storage-root cache, and the
 * synchronous `getStorageRoot` threw "Storage root … not resolved" as an
 * error toast mid-logout. Eviction now runs after the shell has unmounted
 * (`session === null` effect in main.tsx). Visiting Manage + Connect first
 * mounts the query observers that provoked the refetch storm.
 *
 *   # tier 3 (local CSS, no creds):
 *   deno task e2e:local test/e2e/tasks/logout.spec.ts
 *   # tier 4 (real Pods):
 *   source test/.env.e2e.local && deno task e2e:remote:spec test/e2e/tasks/logout.spec.ts
 *
 * Runs against Alice (account A). Read-only (writes nothing to the Pod).
 * Skipped when account env vars are absent.
 */

const ACC = account("A");

test.describe("logout", () => {
  test.skip(
    !hasAccount(ACC),
    "Set E2E_USERNAME_A / E2E_PASSWORD_A (a throwaway Solid Pod) to run the logout e2e.",
  );

  test("logging out raises no error notifications", async ({ browser }) => {
    test.setTimeout(T.setup); // login (IdP + consent) can be slow / retried
    const page = await newCapturedPage(browser, "logout");
    const { assertNoAppErrors } = watchAppErrors(page);
    await login(page, ACC);

    // Mount the tabs whose queries build Pod paths via the synchronous
    // getStorageRoot (contacts + rooms on Connect; buildings, views and the
    // shared-out fold on Manage), so the logout-time cache clear has live
    // query observers — the condition that triggered the bug.
    await page.getByRole("tab", { name: "Manage" }).click();
    await expect(page.getByRole("heading", { name: "Your buildings" }))
      .toBeVisible({ timeout: T.visible });
    await page.getByRole("tab", { name: "Connect" }).click();
    await expect(page.getByRole("heading", { name: "Contacts" }))
      .toBeVisible({ timeout: T.visible });

    await logout(page); // waits for the sign-in screen to render

    // The buggy refetch storm fired between the cache clear and the shell
    // unmount, so its toasts are mirrored to the console before the sign-in
    // screen settles; a short grace period catches any straggler.
    await page.waitForTimeout(1_000);
    assertNoAppErrors();
    await page.close();
  });
});
