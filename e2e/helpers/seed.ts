import { expect, type Page } from "@playwright/test";

/**
 * Ensure the logged-in account has the demo buildings on Manage, seeding an empty
 * Pod through the in-app action so specs never assume a pre-seeded Pod (a
 * freshly-wiped Pod reseeds itself on the next run — no manual reseed needed).
 *
 * Idempotent: a used Pod already lists buildings, so this returns quickly. An
 * empty Pod is seeded via the fresh-Pod "Add examples" banner when it's shown, or
 * the always-present avatar-menu "Create demo buildings" action as a fallback (the
 * banner is suppressed once the demo offer was declined). Either path writes one
 * annual (investor) + one 15-min series (user) building.
 */
export async function ensureDemoBuildings(page: Page): Promise<void> {
  await page.getByRole("tab", { name: "Manage" }).click();
  const rows = page.getByText(/^Building /);

  // Already seeded (used Pod) — nothing to do.
  if (await rows.first().isVisible({ timeout: 15_000 }).catch(() => false)) {
    return;
  }

  // Empty Pod: prefer the fresh-Pod onboarding banner; otherwise fall back to the
  // avatar-menu action (always available, even after the banner was dismissed).
  const addExamples = page.getByRole("button", { name: "Add examples" });
  if (await addExamples.isVisible().catch(() => false)) {
    await addExamples.click();
  } else {
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("menuitem", { name: /create demo buildings/i }).click();
  }

  await expect(rows.first()).toBeVisible({ timeout: 120_000 });
}
