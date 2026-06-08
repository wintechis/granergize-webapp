import { expect, type Page } from "@playwright/test";
import { ensureCompanyKind } from "./login.ts";
import type { UserRole } from "../../../src/types.ts";
import { T } from "./timeouts.ts";

/**
 * Ensure the logged-in account has the demo building for a given company `kind` on
 * Manage, seeding an empty Pod through the in-app action so specs never assume a
 * pre-seeded Pod (a freshly-wiped Pod reseeds itself on the next run).
 *
 * The demo seed is **kind-specific** (one shape per company kind: `investor` → the
 * annual "Nordostpark" building, `user` → a 15-min series, `benchmark_service_provider`
 * → an annual benchmark building; `companyKindHasDemo` in buildingSerializer.ts). So
 * the caller MUST state the kind it needs, and we set it via the in-app Organisation
 * form (`ensureCompanyKind(..., { force: true })`) before the "Add examples" banner —
 * the banner only appears once a demo-capable kind is set, and `force` overrides the
 * login baseline. Pass `investor` for specs that assert on the Nordostpark building
 * (`building-details`, `view-data`); `user` for specs that just need any building.
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
export async function ensureDemoBuildings(
  page: Page,
  kind: UserRole,
): Promise<void> {
  await page.getByRole("tab", { name: "Manage" }).click();
  const rows = page.locator("li", { hasText: /Building \S+/ });

  // Already populated (used Pod, or residue from an earlier spec) — nothing to do.
  if (await rows.first().isVisible({ timeout: T.visible }).catch(() => false)) {
    return;
  }

  // Set the company kind via the in-app form so the kind-specific demo offer appears
  // (force, to override the login baseline). The app re-evaluates the offer on save.
  await ensureCompanyKind(page, kind, { force: true });

  // Empty Pod: seed via the fresh-Pod "Add examples" onboarding banner. This is the
  // ONLY in-app seed path (the old avatar-menu "Create demo buildings" action no
  // longer exists).
  //
  // The app evaluates this offer ONCE, when the kind is saved, reading the kind back
  // from the Pod (refreshDemoOffer → getCompanyKind), and does NOT re-evaluate. Two
  // ways that single evaluation can miss on a real Pod: (a) it's slow — the offer's
  // reads (buildings list + profile + prefs) take a while, so the banner appears
  // late; (b) a read-after-write race returns the PRE-write profile, so the offer is
  // computed against a stale kind and suppressed for good. So: wait generously for
  // the in-app evaluation to settle (covers (a)); only if that misses, reload ONCE to
  // force a single fresh evaluation against the now-converged Pod (covers (b)), then
  // wait again. Do NOT loop reloads — each reload restarts the whole app bootstrap
  // and would reset the settle clock, so a late banner is never caught (it just
  // re-thrashes the slow Pod). If it still never shows, the demo kind wasn't set or
  // the Pod has gran:demoSeedDeclined.
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
