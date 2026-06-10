import { expect, type Page, test } from "@playwright/test";
import { account, hasAccount, login, LOGIN_HEADING } from "./helpers/login.ts";

/**
 * Tier 5 — smoke against the DEPLOYED app (`deno task e2e:deployed`). Drives the
 * published build at `E2E_DEPLOYED_URL` (the GitHub-Actions deploy target) with a
 * real throwaway Pod — account A, configured by `source`-ing a Tier-4 env file.
 * Deliberately shallow: log in, walk the four tabs, and fail on any uncaught page
 * error or "Failed to …" error toast. It proves the DEPLOYMENT is alive and wired
 * (assets served from the subpath, hash routing, the baked OIDC ClientID document
 * dereferencable, a real provider's login round-trip) — app BEHAVIOUR is Tiers
 * 1–4's job, so this stays read-only: no buildings added, nothing written.
 */

const ACC = account("A");

/** Error toasts use the one formatError shape, so this catches any of them. */
async function expectNoErrorToast(page: Page) {
  await expect(page.getByText(/^Failed to /)).toHaveCount(0);
}

test.describe("deployed smoke", () => {
  test.skip(
    !process.env.E2E_DEPLOYED_URL,
    "Set E2E_DEPLOYED_URL (use `deno task e2e:deployed`).",
  );
  test.skip(
    !hasAccount(ACC),
    "Source a Tier-4 env file first (E2E_USERNAME_A / E2E_PASSWORD_A).",
  );

  test("log in and click around without errors", async ({ page }) => {
    // One real-Pod login + four tab renders; generous for a throttled provider.
    test.setTimeout(ACC.provider.throttled ? 600_000 : 300_000);

    // An uncaught exception anywhere during the walk fails the smoke — this is
    // the signal a transpile-only build can't catch (e.g. a ReferenceError from
    // a bad import sweep).
    const pageErrors: string[] = [];
    page.on("pageerror", (e) => pageErrors.push(String(e)));

    // The published app loads at the subpath and shows the pre-login screen.
    // "./" keeps the baseURL's subpath (an absolute "/" would resolve to the
    // host root — the university homepage, not the app).
    await page.goto("./");
    await expect(page.getByRole("heading", { name: LOGIN_HEADING }))
      .toBeVisible({ timeout: 30_000 });

    await login(page, ACC);
    await expectNoErrorToast(page);

    // Explore: the map renders.
    await page.getByRole("tab", { name: "Explore" }).click();
    await expect(page.locator(".leaflet-container")).toBeVisible({
      timeout: 30_000,
    });
    await expectNoErrorToast(page);

    // Manage: both sections render (whatever the Pod holds, headings appear).
    await page.getByRole("tab", { name: "Manage" }).click();
    await expect(page.getByRole("heading", { name: "Your buildings" }))
      .toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("heading", { name: "Aggregated views" }))
      .toBeVisible({ timeout: 60_000 });
    await expectNoErrorToast(page);

    // Share: the received-shares fold ran.
    await page.getByRole("tab", { name: "Share" }).click();
    await expect(
      page.getByRole("heading", { name: "Buildings shared with you" }),
    ).toBeVisible({ timeout: 60_000 });
    await expectNoErrorToast(page);

    // Connect: contacts + rooms render.
    await page.getByRole("tab", { name: "Connect" }).click();
    await expect(page.getByRole("heading", { name: "Contacts" }))
      .toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("heading", { name: "Your data rooms" }))
      .toBeVisible({ timeout: 60_000 });
    await expectNoErrorToast(page);

    // Let in-flight loads settle, then the final verdicts.
    await page.waitForLoadState("networkidle").catch(() => {});
    await expectNoErrorToast(page);
    expect(
      pageErrors,
      `uncaught page errors during the walk:\n${pageErrors.join("\n")}`,
    ).toEqual([]);
  });
});
