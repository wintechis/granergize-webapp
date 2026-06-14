import { expect, type Page, test } from "@playwright/test";
import { account, hasAccount, login } from "../helpers/login.ts";
import { confirmDialog } from "../helpers/confirm.ts";
import { buildingIds, buildingRows } from "../helpers/manage.ts";
import { newCapturedPage } from "../helpers/consoleLog.ts";
import { ensureDemoBuildings } from "../helpers/seed.ts";
import { assertCleanStart, verifyAndReset } from "../helpers/cleanSlate.ts";
import { menuAction, setDevMode } from "../helpers/accountMenu.ts";
import { T } from "../helpers/timeouts.ts";

/**
 * Archive backup/restore e2e (dev-mode). Drives the real account-menu flow end to
 * end against a throwaway local CSS: enable Developer mode, **Download archive**
 * (capture the .zip), **Remove all app data** (wipe), **Upload archive…** (restore
 * from the captured file), and assert the buildings come back. Exercises the UI
 * wiring + the two native confirm() dialogs; field/IRI fidelity and the sharing
 * replay are covered by the unit + Tier-2 (`archive-restore`) tests.
 *
 * MUTATES the Pod (wipes then restores it) — Tier 3 runs against a disposable CSS,
 * and a wiped Pod reseeds itself next run.
 *
 *   deno task e2e:local test/e2e/tasks/archive-restore.spec.ts
 *
 * Runs against Alice (account A). Skipped without creds.
 */

const ACC = account("A");
const ARCHIVE_PATH = "test-results/archive-e2e.zip";

async function openManage(page: Page): Promise<void> {
  await page.getByRole("tab", { name: "Manage" }).click();
}


test.describe.configure({ mode: "serial" });

test.describe("archive backup/restore", () => {
  test.skip(
    !hasAccount(ACC),
    "Set E2E_USERNAME_A / E2E_PASSWORD_A (a throwaway Solid Pod) to run the archive-restore e2e.",
  );

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(T.setup);
    page = await newCapturedPage(browser, "archive-restore");
    // Both the restore and the wipe go through window.confirm — accept them.
    page.on("dialog", (d) => d.accept().catch(() => {}));
    await login(page, ACC);
    await assertCleanStart(page);
    await ensureDemoBuildings(page); // any building; download → wipe → restore
  });

  test.afterAll(async () => {
    await verifyAndReset(page, "archive-restore");
    await page.close();
  });

  test("download → wipe → upload restores the buildings", async () => {
    test.setTimeout(T.testSolo);
    await openManage(page);
    await expect(buildingRows(page).first()).toBeVisible({ timeout: T.action });
    // Capture the seeded set only once it has CONVERGED (stable across a short
    // interval). A single read the instant the first row appears can grab a
    // partial or residual listing on a slow Pod — and since the post-restore
    // compare below IS poll-stabilized, an unstable baseline is what makes the two
    // disagree (disjoint id sets), not the restore itself.
    let before = new Set<string>();
    await expect(async () => {
      const ids = new Set(await buildingIds(page));
      expect(ids.size, "seeded buildings to back up").toBeGreaterThan(0);
      await page.waitForTimeout(400);
      expect(new Set(await buildingIds(page))).toEqual(ids);
      before = ids;
    }).toPass({ timeout: T.poll });

    // Developer mode gates the archive menu items (off by default).
    await setDevMode(page, true);

    // Download archive → capture the .zip.
    const dl = page.waitForEvent("download");
    await menuAction(page, /Download archive/);
    await (await dl).saveAs(ARCHIVE_PATH);
    await expect(page.getByText(/Archived \d+ resource\(s\)/)).toBeVisible({
      timeout: T.action,
    });

    // Wipe the Pod (the in-app confirm dialog asks first).
    await menuAction(page, /Remove all app data/);
    await confirmDialog(page, "Remove all");
    await expect(page.getByText("All app data removed")).toBeVisible({
      timeout: T.action,
    });
    // The buildings are gone (the fresh-Pod "Add examples" offer returns).
    await openManage(page);
    await expect(page.getByRole("button", { name: "Add examples" })).toBeVisible({
      timeout: T.action,
    });

    // Upload archive → the hidden picker drives importArchive; the in-app confirm
    // dialog asks before overwriting.
    await page.locator('input[type="file"][accept*="zip"]').setInputFiles(ARCHIVE_PATH);
    await confirmDialog(page, "Restore");
    await expect(page.getByText(/Restored \d+ resource\(s\)/)).toBeVisible({
      timeout: T.action,
    });

    // The exact same buildings are back (same Pod → same ids; eventually consistent).
    await openManage(page);
    await expect(buildingRows(page).first()).toBeVisible({ timeout: T.action });
    await expect(async () => {
      expect(new Set(await buildingIds(page))).toEqual(before);
    }).toPass({ timeout: T.poll });
  });
});
