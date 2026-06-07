import { expect, type Page, test } from "@playwright/test";
import { buildingRows } from "./manage.ts";
import { logRun } from "./consoleLog.ts";

/**
 * Per-spec clean-slate utilities, both tiers.
 *
 * Unified across solo and sharing specs:
 *  - START: {@link assertCleanStart} ASSERTS the collection is empty (a check, not
 *    a wipe — the clean start is free: a Tier-4 run gets a fresh per-run
 *    `granergize-e2e-<uuid>`, Tier 3 restarts its throwaway CSS per spec file).
 *  - END: {@link verifyAndReset} (solo, one pod) / {@link verifyAndResetBoth}
 *    (sharing, both pods) WIPE so nothing is left behind — the next spec starts
 *    empty and a run removes its whole collection container from the Pod(s).
 *
 * The two ends bracket each spec: if a spec's end-wipe fails, the NEXT spec's
 * start-assertion catches it with a clear message, instead of confusing downstream
 * failures. Helpers:
 *
 *  - {@link logCollectionState} records what the collection holds just before the
 *    wipe — residue (a greppable RESIDUE marker) means the spec's own in-flow
 *    cleanup (deletes/revokes) didn't fully work; it's logged, not failed (some
 *    specs intentionally leave demo seeds, and the wipe cleans up regardless).
 *  - {@link wipeCollection} drives the app's dev-mode "Remove all app data" action
 *    (the exact auth+delete path the app uses) to remove the whole
 *    `VITE_POD_APP_DIR` collection. `reload` re-provisions the inbox (which lives
 *    UNDER the collection) for a page that keeps being used; omit it at end-of-spec
 *    since the page is about to close (the next spec's fresh login re-provisions).
 *  - {@link verifyAndReset} / {@link verifyAndResetBoth} are the end-of-spec
 *    teardowns for solo (one pod) and sharing (both pods).
 */

/**
 * Start-of-spec precondition: ASSERT the logged-in account's collection is empty,
 * failing loudly if not. A Tier-4 run's per-run `granergize-e2e-<uuid>` is fresh and
 * every spec wipes at the end, so residue here means the PREVIOUS spec's teardown
 * didn't complete — catching that up front keeps later errors interpretable (instead
 * of confusing "already exists" / stale-data failures deeper in the spec).
 */
export async function assertCleanStart(page: Page, tag = ""): Promise<void> {
  await page.getByRole("tab", { name: "Manage" }).click();
  await page.waitForLoadState("networkidle").catch(() => {});
  const buildings = await buildingRows(page).count();
  const views = await page.getByRole("button", { name: /open view/i }).count();
  logRun(`clean-slate start [${tag}]: buildings=${buildings} views=${views}`);
  expect(
    buildings + views,
    `${tag}: expected an empty collection at start (the previous spec's teardown ` +
      `should have wiped it); found ${buildings} building(s) + ${views} view(s)`,
  ).toBe(0);
}

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
 * End-of-spec teardown for a SOLO spec (one pod): record residue (cleanup check)
 * then wipe so the run leaves nothing behind and the next spec starts empty. The
 * page is closed by the caller afterwards, so no reload is needed.
 */
export async function verifyAndReset(page: Page, tag: string): Promise<void> {
  // afterAll's default budget is 30s; a recursive remote delete can exceed it.
  test.setTimeout(240_000);
  await logCollectionState(page, tag);
  await wipeCollection(page, { tag });
}

/**
 * End-of-spec teardown for a SHARING spec (both pods): same as {@link verifyAndReset}
 * but wipes A and B so neither Pod accumulates residue across runs. A's page is the
 * one driven through the test; B's per-step contexts are closed mid-flow, so the
 * caller opens a fresh B page for this. Both pages close right after, so no reload.
 */
export async function verifyAndResetBoth(
  aPage: Page,
  bPage: Page,
  tag: string,
): Promise<void> {
  test.setTimeout(300_000);
  await logCollectionState(aPage, `${tag}:A`);
  await wipeCollection(aPage, { tag: `${tag}:A` });
  await wipeCollection(bPage, { tag: `${tag}:B` });
}
