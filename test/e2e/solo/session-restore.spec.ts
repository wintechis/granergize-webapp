import { expect, test } from "@playwright/test";
import { t, tPattern } from "../helpers/i18n.ts";
import { account, hasAccount, login, signInScreen } from "../helpers/login.ts";
import { newCapturedPage } from "../helpers/consoleLog.ts";
import { watchAppErrors } from "../helpers/errorGuard.ts";
import { T } from "../helpers/timeouts.ts";

/**
 * Failed-session-restore remedy e2e.
 *
 * On reload the app silently restores the previous Solid session
 * (`restorePreviousSession`). When the locally-cached OIDC client registration
 * has gone stale the IdP rejects that with an "Unknown client" error; without a
 * remedy the user is stuck (the app keeps trying to restore a session it can't).
 * Login.tsx now catches the rejected restore and surfaces an inline warning with
 * a "Clear local data & retry" button (backed by `clearLocalData`, unit-tested in
 * src/lib/clearLocalData.test.ts). This spec guards that UI end to end.
 *
 * The failure is forced deterministically — not by waiting for a registration to
 * actually rot — by intercepting the restore's OIDC calls (`/.oidc/auth` silent
 * redirect and `/.oidc/token` refresh) and answering with the server's error, so
 * the test never depends on real server/registration state.
 *
 *   # tier 3 (local CSS, no creds):
 *   deno task e2e:local test/e2e/solo/session-restore.spec.ts
 *   # tier 4 (real Pods):
 *   source test/.env.e2e.local && deno task e2e:remote:spec test/e2e/solo/session-restore.spec.ts
 *
 * Runs against Alice (account A). Skipped when account env vars are absent.
 */

const ACC = account("A");

// The server's literal "Unknown client" message, injected as the OIDC error
// description so the forced failure mirrors the real one.
const UNKNOWN_CLIENT =
  "Unknown client, you might need to clear the local storage on the client.";

test.describe("session restore", () => {
  test.skip(
    !hasAccount(ACC),
    "Set WEBID_A_USERNAME / WEBID_A_PASSWORD (a throwaway Solid Pod) to run the restore e2e.",
  );

  test("a failed restore offers a working clear-local-data remedy", async ({ browser }) => {
    test.setTimeout(T.setup); // login (IdP + consent) can be slow / retried
    const page = await newCapturedPage(browser, "session-restore");
    const { assertNoAppErrors } = watchAppErrors(page);

    // Establish a real, restorable session.
    await login(page, ACC);
    await expect(page.getByRole("tab", { name: t("navBuildings") })).toBeVisible({
      timeout: T.action,
    });
    assertNoAppErrors();

    // Break the next silent restore: answer the OIDC auth/token endpoints with
    // the IdP's "Unknown client" error so `restorePreviousSession` rejects.
    // Match BOTH providers' OIDC endpoints — CSS mounts them at `/.oidc/{auth,token}`,
    // JSS at `/idp/{auth,token}` — so the break works on either Tier-3 server.
    const breakOidc = /\/(\.oidc|idp)\/(auth|token)\b/;
    await page.route(breakOidc, async (route) => {
      const url = new URL(route.request().url());
      // The silent restore is a prompt=none redirect to the auth endpoint: hand
      // control back to the app's redirect_uri carrying the error + echoed state
      // (exactly what the server does on an unknown client).
      if (/\/(\.oidc|idp)\/auth$/.test(url.pathname)) {
        const redirectUri = url.searchParams.get("redirect_uri");
        if (redirectUri) {
          const loc = new URL(redirectUri);
          loc.searchParams.set("error", "invalid_client");
          loc.searchParams.set("error_description", UNKNOWN_CLIENT);
          loc.searchParams.set("state", url.searchParams.get("state") ?? "");
          await route.fulfill({ status: 302, headers: { location: loc.href } });
          return;
        }
      }
      // Token refresh path → the same error as a JSON body.
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({
          error: "invalid_client",
          error_description: UNKNOWN_CLIENT,
        }),
      });
    });

    // Reload → the app attempts the (now broken) silent restore.
    await page.reload();

    // The remedy appears: the warning alert (with whatever message the IdP gave)
    // and the clear-and-retry action.
    const alert = page.getByRole("alert").filter({
      hasText: tPattern("loginRestoreFailed"),
    });
    await expect(alert).toBeVisible({ timeout: T.login });
    const clearBtn = page.getByRole("button", {
      name: t("loginClearRetry"),
    });
    await expect(clearBtn).toBeVisible();

    // Stop forcing the failure so the post-clear reload reaches a clean login
    // form instead of re-triggering the alert.
    await page.unroute(breakOidc);

    // Click the remedy: it wipes local storage and reloads to a clean login form.
    await clearBtn.click();
    await expect(signInScreen(page)).toBeVisible({
      timeout: T.action,
    });

    // The stored session is gone — no inrupt auth state survived the wipe.
    const authKeys = await page.evaluate(() =>
      Object.keys(localStorage).filter((k) =>
        k.startsWith("solidClientAuthenticationUser")
      )
    );
    expect(authKeys).toEqual([]);
  });
});

test.describe("login escape hatch (no creds)", () => {
  // No login needed — this only reaches the chooser, so it runs in every mode.
  // Use a plain unseeded page (NOT `newCapturedPage`, which seeds Alice's saved
  // session in login-reuse mode) so the screen is genuinely logged out.
  test("the login chooser always offers a working Clear-local-data action", async ({ browser }) => {
    // The chooser must expose the clear-storage remedy unconditionally (not only
    // after a caught restore error), so a user stranded by a stale OIDC client —
    // e.g. one bounced to the IdP's dead-end "Unknown client" page, where no
    // error ever reaches the app — can always recover without DevTools/Esc.
    const page = await browser.newPage();
    try {
      await page.goto("./");
      await expect(signInScreen(page))
        .toBeVisible({ timeout: T.login });

      // Simulate a user stranded with stale local data (e.g. a dead OIDC client
      // registration), then reload so the chooser re-checks on mount and sees
      // there's something to clear — the remedy is gated on local data presence
      // (a pristine browser has nothing to clear).
      await page.evaluate(() => {
        localStorage.setItem("granergize:restoreAttempted", "1");
        localStorage.setItem("prevIdps", JSON.stringify(["https://example.test"]));
      });
      await page.reload();

      // The clear-storage remedy lives in the sign-in dialog (distinct from the
      // failed-restore Alert above, which auto-opens the dialog itself).
      await signInScreen(page).click();
      const clearBtn = page.getByRole("button", { name: t("loginClearData") });
      await expect(clearBtn).toBeVisible();
      await clearBtn.click();

      // It wipes local storage and returns to a clean chooser.
      await expect(signInScreen(page))
        .toBeVisible({ timeout: T.action });
      const leftover = await page.evaluate(() => localStorage.length);
      expect(leftover).toBe(0);
    } finally {
      await page.close();
    }
  });
});
