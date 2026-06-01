import { expect, test } from "@playwright/test";

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
    ).toBeVisible({ timeout: 20_000 });

    // The two recommended identity providers and the custom-provider input.
    await expect(
      page.getByRole("button", { name: /solidcommunity\.net/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /solid\.iis\.fraunhofer\.de/i }),
    ).toBeVisible();
    await expect(page.getByLabel(/Identity Provider/i)).toBeVisible();
  });

  test("the guide route exists (redirects to login when logged out)", async ({ page }) => {
    // /guide lives inside the login gate, so logged-out it still shows the
    // sign-in screen rather than 404/white-screening.
    await page.goto("/#/guide");
    await expect(
      page.getByRole("heading", { name: "Granergize App" }),
    ).toBeVisible({ timeout: 20_000 });
  });
});
