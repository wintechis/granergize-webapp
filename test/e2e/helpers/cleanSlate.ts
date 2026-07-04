import { expect, type Page, test } from "@playwright/test";
import { t } from "./i18n.ts";
import { buildingRows, openBuildingsList } from "./manage.ts";
import { confirmDialog } from "./confirm.ts";
import { logRun } from "./consoleLog.ts";
import { menuAction, setDevMode } from "./accountMenu.ts";
import { T } from "./timeouts.ts";

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
  await openBuildingsList(page);
  await page.waitForLoadState("networkidle").catch(() => {});
  const buildings = await buildingRows(page).count();
  const aggregations = await page.getByRole("button", { name: /aggregation details/i }).count();
  logRun(`clean-slate start [${tag}]: buildings=${buildings} aggregations=${aggregations}`);
  expect(
    buildings + aggregations,
    `${tag}: expected an empty collection at start (the previous spec's teardown ` +
      `should have wiped it); found ${buildings} building(s) + ${aggregations} aggregation(s)`,
  ).toBe(0);
}

/**
 * Clear the finder view/tier **session memory** (`granergize.facet.*` in
 * `sessionStorage` — see `src/lib/facetMemory.ts`) so each test starts from the
 * hardcoded defaults (Map; own + shared). The sticky facet/view otherwise leaks a
 * sibling test's choice within a serial spec's shared context — e.g. one test leaving
 * `?space=rows` makes a later `goto("/buildings")` open the List, not the Map. Clears
 * ONLY our keys: inrupt's auth session also lives in `sessionStorage`, so a blanket
 * `sessionStorage.clear()` would log the page out. Wire it as a `test.beforeEach` in
 * any serial spec that toggles a view/tier. No-op on a closed page / before navigation.
 */
export async function clearFinderMemory(page: Page): Promise<void> {
  if (page.isClosed()) return;
  await page.evaluate(() => {
    for (const k of Object.keys(globalThis.sessionStorage ?? {})) {
      if (k.startsWith("granergize.facet.")) sessionStorage.removeItem(k);
    }
  }).catch(() => {});
}

/** Count what the logged-in account's collection currently surfaces, and log it. */
export async function logCollectionState(
  page: Page,
  tag: string,
): Promise<void> {
  if (page.isClosed()) {
    logRun(`clean-slate check [${tag}]: page already closed, skipped`);
    return;
  }
  try {
    await openBuildingsList(page);
    await page.waitForLoadState("networkidle").catch(() => {});
    const buildings = await buildingRows(page).count();
    // Aggregations render as list rows carrying an "Aggregation details" affordance; count
    // defensively (0 if the locator matches nothing).
    const aggregations = await page.getByRole("button", { name: /aggregation details/i })
      .count();
    const marker = buildings + aggregations > 0 ? " RESIDUE" : " clean";
    logRun(
      `clean-slate check [${tag}]: buildings=${buildings} aggregations=${aggregations}${marker}`,
    );
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
  opts: { reload?: boolean; tag?: string; wipeTimeout?: number } = {},
): Promise<void> {
  const { reload = false, tag = "", wipeTimeout = T.action } = opts;
  if (page.isClosed()) {
    logRun(`clean-slate wipe [${tag}]: page already closed, skipped`);
    return;
  }
  try {
    // "Remove all app data" lives behind Developer mode, in the Account menu.
    await setDevMode(page, true);
    await menuAction(page, t("menuRemoveAll"));
    // Confirm via the in-app confirm dialog (replaced the native window.confirm).
    await confirmDialog(page, "Remove all");
    // The "removed" toast fires only once the recursive delete finishes; a spec
    // that imported a LARGE archive (~1.3k resources) passes a bigger `wipeTimeout`
    // so the delete has room to complete (the default T.action fits a normal spec).
    await expect(page.getByText(t("allDataRemoved"), { exact: false }))
      .toBeVisible({ timeout: wipeTimeout });
    logRun(`clean-slate wipe [${tag}]: collection removed`);
    if (reload) {
      await page.reload();
      // Wait until logged back in (tabs present) so ensureOwnInbox has re-run.
      await expect(page.getByRole("tab", { name: t("navBuildings") }))
        .toBeVisible({ timeout: T.action });
      logRun(`clean-slate wipe [${tag}]: reloaded, inbox re-provisioned`);
    }
  } catch (err) {
    logRun(`clean-slate wipe [${tag}]: FAILED: ${String(err)}`);
    throw err;
  }
}

/**
 * Bring the page back to the app shell before a teardown reads/wipes. A spec can
 * leave the page on a STANDALONE full-page route (`/energy/:id`, `/aggregation/:id`,
 * `/building/:id` — no app-shell tabs) or mid-reload, where the finder tabs the
 * teardown clicks don't exist; without this, that click hangs the whole afterAll
 * budget (the 240s "wipe hang"). `goto("/")` re-enters the shell (the seeded session
 * survives navigation — specs already `goto` standalone routes mid-test), then we
 * wait, BOUNDED, for the tabs so a genuine login failure fails in seconds instead of
 * consuming the hook's whole budget.
 */
async function returnToShell(page: Page): Promise<boolean> {
  if (page.isClosed()) return false;
  await page.goto("/").catch(() => {});
  return await page.getByRole("tab", { name: t("navBuildings") })
    .waitFor({ state: "visible", timeout: T.action })
    .then(() => true)
    .catch(() => false);
}

/**
 * End-of-spec teardown for a SOLO spec (one pod): record residue (cleanup check)
 * then wipe so the run leaves nothing behind and the next spec starts empty. The
 * page is closed by the caller afterwards, so no reload is needed.
 *
 * If the app shell never comes back (the spec left the page broken — e.g. a failed
 * login/beforeAll), SKIP the wipe instead of letting its unbounded shell clicks
 * burn the whole afterAll budget: the bounded {@link returnToShell} probe is the
 * only wait we pay, so a dead page fails the hook in ~60s, not 240s.
 */
export async function verifyAndReset(
  page: Page,
  tag: string,
  opts: { wipeTimeout?: number } = {},
): Promise<void> {
  // Grant the teardown its own budget ON TOP of whatever's left — a recursive
  // remote delete can exceed the default. ADD it (don't replace): `test.setTimeout`
  // sets the TOTAL test budget from the start, so a bare `setTimeout(T.afterAll)`
  // called from a sharing spec's test-body `finally` would SHRINK a 150 s test to
  // 60 s and abort it mid-cleanup. Extending works in both an afterAll hook and a
  // test-body finally. A large-archive spec passes `wipeTimeout` for the slow
  // delete; the hook budget is extended to cover it (max of the two), so the inner
  // toast wait can't outlast the hook.
  const { wipeTimeout } = opts;
  test.setTimeout(test.info().timeout + Math.max(T.afterAll, wipeTimeout ?? 0));
  if (!await returnToShell(page)) {
    logRun(`clean-slate wipe [${tag}]: app shell unavailable, skipped`);
    return;
  }
  await logCollectionState(page, tag);
  await wipeCollection(page, { tag, wipeTimeout });
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
  // Additive, not replacing — see verifyAndReset: a sharing spec calls this from
  // its test-body `finally`, where a bare setTimeout would shrink the total test
  // budget and abort cleanup. Extend the remaining budget instead.
  test.setTimeout(test.info().timeout + T.afterAll);
  if (await returnToShell(aPage)) {
    await logCollectionState(aPage, `${tag}:A`);
    await wipeCollection(aPage, { tag: `${tag}:A` });
  } else {
    logRun(`clean-slate wipe [${tag}:A]: app shell unavailable, skipped`);
  }
  if (await returnToShell(bPage)) {
    await wipeCollection(bPage, { tag: `${tag}:B` });
  } else {
    logRun(`clean-slate wipe [${tag}:B]: app shell unavailable, skipped`);
  }
}
