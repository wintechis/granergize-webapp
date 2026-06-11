import { expect, type Page } from "@playwright/test";
import { T } from "./timeouts.ts";

/**
 * Ensure the logged-in account has the demo buildings on Manage, seeding an empty
 * Pod through the in-app action so specs never assume a pre-seeded Pod (a
 * freshly-wiped Pod reseeds itself on the next run).
 *
 * The demo seed is a fixed set spanning both data shapes — the annual investor
 * "Nordostpark" buildings AND a 15-minute user series — independent of any role
 * (roles live only in data rooms now). So `building-details` / `materialised-views` find the
 * Nordostpark building, and specs that just need "any building" are satisfied too.
 *
 * Idempotent: a Pod that already lists buildings (incl. residue left by an earlier
 * spec whose cleanup was slow) returns quickly. The banner is suppressed once the
 * demo offer was declined (gran:demoSeedDeclined in prefs), so a Pod in that state
 * must be wiped first (the per-test clean-slate wipe); Tier 4's per-run
 * `granergize-e2e-<uuid>` collection always starts fresh and shows it.
 *
 * After seeding it waits for the listing to *stabilise* — same count across a
 * short interval — rather than for a fixed number, so a caller that snapshots the
 * building count (e.g. the excel-export round-trip) doesn't read a moving baseline.
 */
export async function ensureDemoBuildings(page: Page): Promise<void> {
  await page.getByRole("tab", { name: "Manage" }).click();
  const rows = page.locator("li[data-building-id]");

  // Already populated (used Pod, or residue from an earlier spec) — nothing to do.
  if (await rows.first().isVisible({ timeout: T.visible }).catch(() => false)) {
    return;
  }

  // Empty Pod: seed via the fresh-Pod "Add examples" onboarding banner — the only
  // in-app seed path (the avatar-menu "Add demo buildings" is dev-mode only).
  //
  // The offer is evaluated on login (refreshDemoOffer: buildings list + prefs), so on
  // a slow real Pod it can appear late. Wait generously for it to settle; if it
  // misses, reload ONCE to force a fresh evaluation against the converged Pod, then
  // wait again. Do NOT loop reloads — each restarts the app bootstrap and resets the
  // settle clock. If it still never shows, the Pod has gran:demoSeedDeclined.
  await page.getByRole("tab", { name: "Manage" }).click();
  const addExamples = page.getByRole("button", { name: "Add examples" });
  try {
    await expect(addExamples).toBeVisible({ timeout: T.action });
  } catch {
    await page.reload();
    await page.getByRole("tab", { name: "Manage" }).click();
    await expect(addExamples).toBeVisible({ timeout: T.action });
  }
  await addExamples.click();

  // Wait for the seed to fully settle: at least one building, and the count stable
  // across a 1s interval — so the listing has stopped growing before the caller
  // reads it (no magic number, tolerant of pre-existing residue).
  await expect(async () => {
    const a = await rows.count();
    expect(a).toBeGreaterThan(0);
    await page.waitForTimeout(1000);
    expect(await rows.count()).toBe(a);
  }).toPass({ timeout: T.poll });
}
