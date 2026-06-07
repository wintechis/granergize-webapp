import { expect, type Page } from "@playwright/test";

/**
 * Ensure the logged-in account has at least the demo buildings on Manage, seeding
 * an empty Pod through the in-app action so specs never assume a pre-seeded Pod (a
 * freshly-wiped Pod reseeds itself on the next run — no manual reseed needed).
 *
 * Idempotent: a Pod that already lists buildings (incl. residue left by an earlier
 * spec whose cleanup was slow) returns quickly. An empty Pod is seeded via the
 * fresh-Pod "Add examples" onboarding banner — the only in-app seed path. It writes
 * one annual (investor) + one 15-min series (user) building. The banner is
 * suppressed once the demo offer was declined (gran:demoSeedDeclined in prefs), so a
 * Pod in that state must be wiped first (the per-test clean-slate wipe); Tier 4's
 * per-run `granergize-e2e-<uuid>` collection always starts fresh and shows it.
 *
 * After seeding it waits for the listing to *stabilise* — same count across a
 * short interval — rather than for a fixed number. The seed writes its buildings
 * sequentially (geocoding each), so the list grows for a moment; returning at the
 * first row would hand a caller that snapshots the building count (e.g. the
 * excel-export round-trip) a moving baseline. A fixed expected count is also wrong
 * here, because earlier specs can leave residue, so the post-seed total isn't
 * necessarily two.
 */
export async function ensureDemoBuildings(page: Page): Promise<void> {
  await page.getByRole("tab", { name: "Manage" }).click();
  const rows = page.locator("li", { hasText: /Building \S+/ });

  // Already populated (used Pod, or residue from an earlier spec) — nothing to do.
  if (await rows.first().isVisible({ timeout: 15_000 }).catch(() => false)) {
    return;
  }

  // Empty Pod: seed via the fresh-Pod "Add examples" onboarding banner. This is the
  // ONLY in-app seed path (the old avatar-menu "Create demo buildings" action no
  // longer exists), so WAIT for the banner — a non-waiting isVisible() check races
  // the buildings query on a slower (real) Pod and misses it. If the banner never
  // appears the Pod likely has gran:demoSeedDeclined set and must be reset first.
  const addExamples = page.getByRole("button", { name: "Add examples" });
  await expect(addExamples).toBeVisible({ timeout: 30_000 });
  await addExamples.click();

  // Wait for the seed to fully settle: at least one building, and the count stable
  // across a 1s interval — so the listing has stopped growing before the caller
  // reads it (no magic number, tolerant of pre-existing residue).
  await expect(async () => {
    const a = await rows.count();
    expect(a).toBeGreaterThan(0);
    await page.waitForTimeout(1000);
    expect(await rows.count()).toBe(a);
  }).toPass({ timeout: 120_000 });
}
