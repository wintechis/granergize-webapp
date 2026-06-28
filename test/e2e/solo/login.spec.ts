import { expect, test } from "@playwright/test";
import { t } from "../helpers/i18n.ts";
import { T } from "../helpers/timeouts.ts";

/**
 * Smoke tests that need NO login. The whole app sits behind the Solid login
 * gate, so logged-out we land on the public landing page — asserting it renders
 * (and that the sign-in dialog opens to the provider chooser) catches build
 * breakage, white-screens and routing regressions, and runs in CI without any
 * credentials.
 */
test.describe("smoke (no login)", () => {
  test("the landing page renders with a working sign-in dialog", async ({ page }) => {
    await page.goto("/");

    // The logged-out view is the public landing page; its header carries the
    // sign-in affordance.
    const signIn = page.getByRole("button", { name: t("landingNavLogin") }).first();
    await expect(signIn).toBeVisible({ timeout: T.visible });

    // Opening the dialog reveals the recommended identity providers and the
    // custom-provider input.
    await signIn.click();
    await expect(
      page.getByRole("button", { name: /solidcommunity\.net/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /solid\.iis\.fraunhofer\.de/i }),
    ).toBeVisible();
    await expect(page.getByLabel(t("loginIdpLabel"))).toBeVisible();
  });

  test("the landing explains what the app is (pre-login)", async ({ page }) => {
    // heike-1: a first-time visitor sees what Granergize is for before
    // authenticating — the landing hero leads with a one-line description.
    await page.goto("/");
    await expect(
      page.getByText(t("landingHeroLead")),
    ).toBeVisible({ timeout: T.visible });
  });
});
