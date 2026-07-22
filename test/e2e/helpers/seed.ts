import { expect, type Page } from "@playwright/test";
import { T } from "./timeouts.ts";
import { t } from "./i18n.ts";
import { openBuildingsList } from "./manage.ts";

/**
 * Ensure the logged-in account has the demo buildings on Manage, seeding an empty
 * Pod through the in-app action so specs never assume a pre-seeded Pod (a
 * freshly-wiped Pod reseeds itself on the next run).
 *
 * The demo seed is a fixed set spanning both data shapes — annual aggregates
 * (the "Thomas-Dachser-Str. 4" flagship) AND 15-minute series — independent of
 * any role (roles live only in data rooms now). So `building-details` /
 * `aggregations` find the flagship building, and specs that just need "any
 * building" are satisfied too. The browser lanes seed the curated CORE subset
 * of the L.Immo demo set (`VITE_DEMO_SEED=core`, baked into the build by the
 * e2e tasks / set for the dev server in `playwright.config.ts`) — the full
 * 37-building seed would take minutes per spec on a throttled remote Pod.
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
  await openBuildingsList(page);
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
  await openBuildingsList(page);
  const addExamples = page.getByRole("button", { name: t("onboardAddExamples") });
  try {
    await expect(addExamples).toBeVisible({ timeout: T.action });
  } catch {
    await page.reload();
    await openBuildingsList(page);
    await expect(addExamples).toBeVisible({ timeout: T.action });
  }
  await addExamples.click();

  // Primary end signal: the seed's completion toast. On a slow Pod the gap
  // between two building writes can exceed the stability interval below, so the
  // count check alone could read a still-growing listing. Best-effort — the
  // toast auto-hides, so a missed window just falls through.
  await page.getByText(t("demoBuildingsAdded")).waitFor({ timeout: T.poll })
    .catch(() => {});

  // Then wait for the seed to fully settle: at least one building, and the count stable
  // across a 1s interval — so the listing has stopped growing before the caller
  // reads it (no magic number, tolerant of pre-existing residue).
  await expect(async () => {
    const a = await rows.count();
    expect(a).toBeGreaterThan(0);
    await page.waitForTimeout(1000);
    expect(await rows.count()).toBe(a);
  }).toPass({ timeout: T.poll });
}
