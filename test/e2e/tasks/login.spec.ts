import { expect, test } from "@playwright/test";
import { T } from "../helpers/timeouts.ts";

/**
 * Smoke tests that need NO login. The whole app sits behind the Solid login
 * gate, so logged-out we can only reach the sign-in screen — but asserting it
 * renders catches build breakage, white-screens and routing regressions, and
 * runs in CI without any credentials.
 */
test.describe("smoke (no login)", () => {
  test("the sign-in screen renders", async ({ page }) => {
    await page.goto("/");

    // The app name (the login screen shows it once auth state has settled).
    await expect(
      page.getByRole("heading", { name: "Granergize App" }),
    ).toBeVisible({ timeout: T.visible });

    // The two recommended identity providers and the custom-provider input.
    await expect(
      page.getByRole("button", { name: /solidcommunity\.net/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /solid\.iis\.fraunhofer\.de/i }),
    ).toBeVisible();
    await expect(page.getByLabel(/Identity Provider/i)).toBeVisible();
  });

  test("the login screen explains what the app is (pre-login)", async ({ page }) => {
    // heike-1: the landing page (before login) gave no explanation. The login
    // screen now leads with a one-line description of the app, so a first-time
    // visitor sees what Granergize is for before authenticating. (The Praxishandbuch
    // download moved off the login screen into the dev-mode account menu.)
    await page.goto("/");
    await expect(
      page.getByText(/browse, compare and share energy consumption data/i),
    ).toBeVisible({ timeout: T.visible });
  });
});
