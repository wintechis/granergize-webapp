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

  test("the login screen links the Praxishandbuch (PDF/DOCX download)", async ({ page }) => {
    // The handbuch is reachable pre-login as a downloadable document (the in-app
    // guide was retired); the login screen must offer it.
    await page.goto("/");
    const link = page.getByRole("link", { name: /praxishandbuch/i });
    await expect(link).toBeVisible({ timeout: 20_000 });
    await expect(link).toHaveAttribute("href", /granergize-handbuch\.(docx|pdf)$/);
  });
});
