import { expect, test } from "@playwright/test";
import { account, hasAccount, login, LOGIN_HEADING } from "../helpers/login.ts";
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
 *   deno task e2e:local test/e2e/tasks/session-restore.spec.ts
 *   # tier 4 (real Pods):
 *   source test/.env.e2e.local && deno task e2e:remote:spec test/e2e/tasks/session-restore.spec.ts
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
    "Set E2E_USERNAME_A / E2E_PASSWORD_A (a throwaway Solid Pod) to run the restore e2e.",
  );

  test("a failed restore offers a working clear-local-data remedy", async ({ browser }) => {
    test.setTimeout(T.setup); // login (IdP + consent) can be slow / retried
    const page = await newCapturedPage(browser, "session-restore");
    const { assertNoAppErrors } = watchAppErrors(page);

    // Establish a real, restorable session.
    await login(page, ACC);
    await expect(page.getByRole("tab", { name: "Connect" })).toBeVisible({
      timeout: T.action,
    });
    assertNoAppErrors();

    // Break the next silent restore: answer the OIDC auth/token endpoints with
    // the IdP's "Unknown client" error so `restorePreviousSession` rejects.
    const breakOidc = /\/\.oidc\/(auth|token)\b/;
    await page.route(breakOidc, async (route) => {
      const url = new URL(route.request().url());
      // The silent restore is a prompt=none redirect to the auth endpoint: hand
      // control back to the app's redirect_uri carrying the error + echoed state
      // (exactly what the server does on an unknown client).
      if (url.pathname.endsWith("/.oidc/auth")) {
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
      hasText: /couldn’t restore your previous session/i,
    });
    await expect(alert).toBeVisible({ timeout: T.login });
    const clearBtn = page.getByRole("button", {
      name: /clear local data & retry/i,
    });
    await expect(clearBtn).toBeVisible();

    // Stop forcing the failure so the post-clear reload reaches a clean login
    // form instead of re-triggering the alert.
    await page.unroute(breakOidc);

    // Click the remedy: it wipes local storage and reloads to a clean login form.
    await clearBtn.click();
    await expect(page.getByRole("heading", { name: LOGIN_HEADING })).toBeVisible({
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

  test("a stale-client restore that bounces to a dead-end IdP page does not re-bounce on return", async ({ browser }) => {
    test.setTimeout(T.setup);
    const page = await newCapturedPage(browser, "session-restore-loop");

    // Establish a real, restorable session first.
    await login(page, ACC);
    await expect(page.getByRole("tab", { name: "Connect" })).toBeVisible({
      timeout: T.action,
    });

    // Count top-level silent-restore bounces to the IdP auth endpoint.
    let authBounces = 0;
    const breakOidc = /\/\.oidc\/(auth|token)\b/;
    await page.route(breakOidc, async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith("/.oidc/auth")) {
        // The real "Unknown client" failure is a DEAD END: the IdP renders its
        // own error page and never redirects back, so the app can't catch a
        // `?error=` (unlike the test above). Serve a standalone HTML page to
        // mimic that — the app loses control here.
        authBounces++;
        await route.fulfill({
          status: 400,
          contentType: "text/html",
          body: `<html><body><h1>${UNKNOWN_CLIENT}</h1></body></html>`,
        });
        return;
      }
      // Token refresh fails first → inrupt falls through to the /auth redirect.
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({
          error: "invalid_client",
          error_description: UNKNOWN_CLIENT,
        }),
      });
    });

    // Reload → the app attempts the silent restore, which bounces once to the
    // dead-end IdP page (the loop's first iteration).
    await page.goto("./");
    await expect.poll(() => authBounces, { timeout: T.login }).toBeGreaterThan(0);
    const bouncesAfterFirst = authBounces;

    // The user escapes the dead-end by navigating back to the app. WITHOUT the
    // loop guard the app would silently re-restore and bounce again; WITH it the
    // `granergize:restoreAttempted` breadcrumb (set before the first bounce)
    // suppresses the second auto-restore and the login chooser appears instead.
    await page.goto("./");
    await expect(page.getByRole("heading", { name: LOGIN_HEADING })).toBeVisible({
      timeout: T.login,
    });

    // The breadcrumb is why we stopped, and there was no second bounce.
    const breadcrumb = await page.evaluate(() =>
      localStorage.getItem("granergize:restoreAttempted")
    );
    expect(breadcrumb).toBe("1");
    expect(authBounces).toBe(bouncesAfterFirst);

    // The always-available escape hatch is right there to clear the stale client.
    await expect(
      page.getByRole("button", { name: /^clear local data$/i }),
    ).toBeVisible();

    await page.close();
  });
});

test.describe("login escape hatch (no creds)", () => {
  test("the login chooser always offers a working Clear-local-data action", async ({ browser }) => {
    // No login: the chooser must expose the clear-storage remedy unconditionally
    // (not only after a caught restore error), so a user stranded by a stale OIDC
    // client can always recover without DevTools or Esc-timing.
    const page = await newCapturedPage(browser, "login-escape-hatch");

    await page.goto("./");
    await expect(page.getByRole("heading", { name: LOGIN_HEADING })).toBeVisible({
      timeout: T.login,
    });

    // Seed the kind of stale state a stranded browser carries (done after the
    // chooser settles so inrupt doesn't act on the fake keys mid-restore).
    await page.evaluate(() => {
      localStorage.setItem("granergize:restoreAttempted", "1");
      localStorage.setItem("solidClientAuthenticationUser:stale", "{}");
    });

    const clearBtn = page.getByRole("button", { name: /^clear local data$/i });
    await expect(clearBtn).toBeVisible();

    // Clicking wipes local storage and reloads to a clean chooser.
    await clearBtn.click();
    await expect(page.getByRole("heading", { name: LOGIN_HEADING })).toBeVisible({
      timeout: T.action,
    });
    const leftovers = await page.evaluate(() => ({
      breadcrumb: localStorage.getItem("granergize:restoreAttempted"),
      authKeys: Object.keys(localStorage).filter((k) =>
        k.startsWith("solidClientAuthenticationUser")
      ),
    }));
    expect(leftovers.breadcrumb).toBeNull();
    expect(leftovers.authKeys).toEqual([]);

    await page.close();
  });
});
