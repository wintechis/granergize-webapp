import { expect, type Page, test } from "@playwright/test";
import { buildingRows } from "./manage.ts";
import { logRun } from "./consoleLog.ts";

/**
 * Per-spec clean-slate utilities, both tiers.
 *
 * The invariant we want each spec to uphold: it cleans up after itself, and the
 * NEXT spec starts from an empty app collection. These helpers make that explicit
 * and visible in the per-run console log:
 *  - {@link logCollectionState} records what the collection holds at a checkpoint
 *    (end of a spec) — residue means the spec's own cleanup didn't fully work, and
 *    is flagged with a greppable RESIDUE marker rather than failing the run (some
 *    specs intentionally leave demo seeds; the wipe below still guarantees the next
 *    spec is clean).
 *  - {@link wipeCollection} drives the app's dev-mode "Remove all app data" action
 *    (the exact auth+delete path the app uses — same as maintenance/reset.spec.ts)
 *    to remove the whole `VITE_POD_APP_DIR` collection, then optionally reloads so
 *    login re-provisions the inbox (which lives UNDER the collection, so the wipe
 *    removes it too — a reload is required before any sharing can post to it again).
 *
 * Tier 3 already restarts CSS per spec file, so its clean START is guaranteed; the
 * value there is the end-of-spec residue check. Tier 4 (real Pods) relies on the
 * wipe for both the check and the clean start.
 */

/** Count what the logged-in account's collection currently surfaces, and log it. */
export async function logCollectionState(page: Page, tag: string): Promise<void> {
  if (page.isClosed()) {
    logRun(`clean-slate check [${tag}]: page already closed, skipped`);
    return;
  }
  try {
    await page.getByRole("tab", { name: "Manage" }).click();
    await page.waitForLoadState("networkidle").catch(() => {});
    const buildings = await buildingRows(page).count();
    // Views render as list rows carrying a "View" / "Open view" affordance; count
    // defensively (0 if the locator matches nothing).
    const views = await page.getByRole("button", { name: /open view/i }).count();
    const marker = buildings + views > 0 ? " RESIDUE" : " clean";
    logRun(`clean-slate check [${tag}]: buildings=${buildings} views=${views}${marker}`);
  } catch (err) {
    logRun(`clean-slate check [${tag}]: FAILED to read state: ${String(err)}`);
  }
}

/**
 * Remove the whole e2e app collection for the logged-in account via the app's own
 * "Remove all app data" action. `reload` re-logs-in (reload → ensureOwnInbox) so the
 * inbox is re-provisioned — pass it whenever the page keeps being used afterwards
 * (e.g. a sharing recipient), omit it when the page is about to be closed.
 */
export async function wipeCollection(
  page: Page,
  opts: { reload?: boolean; tag?: string } = {},
): Promise<void> {
  const { reload = false, tag = "" } = opts;
  if (page.isClosed()) {
    logRun(`clean-slate wipe [${tag}]: page already closed, skipped`);
    return;
  }
  try {
    // Accept the wipe's window.confirm. `once` + a swallowed accept is safe even if
    // the spec already registered a persistent dialog handler (the second accept of
    // the same dialog rejects, which we ignore).
    page.once("dialog", (d) => d.accept().catch(() => {}));
    // "Remove all app data" lives behind the footer Developer-mode toggle.
    await page.getByLabel("Developer mode").check();
    await page.getByRole("button", { name: /Account menu/ }).click();
    await page.getByRole("menuitem", { name: /Remove all app data/i }).click();
    await expect(page.getByText("All app data removed", { exact: false }))
      .toBeVisible({ timeout: 180_000 });
    logRun(`clean-slate wipe [${tag}]: collection removed`);
    if (reload) {
      await page.reload();
      // Wait until logged back in (tabs present) so ensureOwnInbox has re-run.
      await expect(page.getByRole("tab", { name: "Connect" }))
        .toBeVisible({ timeout: 120_000 });
      logRun(`clean-slate wipe [${tag}]: reloaded, inbox re-provisioned`);
    }
  } catch (err) {
    logRun(`clean-slate wipe [${tag}]: FAILED: ${String(err)}`);
    throw err;
  }
}

/**
 * End-of-spec teardown for the solo specs (one persistent page): record residue
 * (cleanup check) then wipe so the next spec starts empty. The page is closed by
 * the caller afterwards, so no reload is needed.
 */
export async function verifyAndReset(page: Page, tag: string): Promise<void> {
  // afterAll's default budget is 30s; a recursive remote delete can exceed it.
  test.setTimeout(240_000);
  await logCollectionState(page, tag);
  await wipeCollection(page, { tag });
}

/**
 * Clean-START for a sharing test: wipe BOTH roles' collections right after they log
 * in and BEFORE any sharing, reloading each so its inbox is re-provisioned (the
 * inbox lives under the collection). Guarantees each sharing test starts from two
 * empty pods regardless of what the previous test/run left.
 */
export async function freshSlateBoth(
  aPage: Page,
  bPage: Page,
  tag: string,
): Promise<void> {
  await wipeCollection(aPage, { reload: true, tag: `${tag}:A` });
  await wipeCollection(bPage, { reload: true, tag: `${tag}:B` });
}
