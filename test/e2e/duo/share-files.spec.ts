import { expect, type Page, test } from "@playwright/test";
import { t, tPattern } from "../helpers/i18n.ts";
import { account, webIdOf } from "../helpers/login.ts";
import { reloadUntil } from "../helpers/reloadUntil.ts";
import { confirmDialog } from "../helpers/confirm.ts";
import { resolveAccounts } from "../../config/resolve.ts";
import { freshPage, freshPagesParallel } from "../helpers/twoPod.ts";
import {
  addBuilding,
  openBuildingsList,
  shareByWebId,
  uploadBuildingFile,
} from "../helpers/manage.ts";
import { assertCleanStart, verifyAndResetBoth } from "../helpers/cleanSlate.ts";
import { T } from "../helpers/timeouts.ts";

/**
 * File sharing across TWO throwaway Solid Pods: A shares to B's WebID (the only
 * share target — a data room is a WebID directory, never a target). A attaches a
 * file to the building, shares, and B (logged in fresh so the inbox grant is
 * archived) downloads the file from the Share tab. This is the recipient-access
 * half of the attachments feature, in the browser.
 *
 *   deno task e2e:local test/e2e/duo/share-files.spec.ts
 *
 * Needs an interoperating A/B pair (both on one provider). Skipped otherwise; the
 * data-layer path is also covered by the Tier-2 `attachment-share` task.
 */

const A = account("A");
const B = account("B");
const FIXTURE = "test/e2e/fixtures/sample.pdf";
const pair = resolveAccounts({ count: 2, interoperatingPair: true });

/** B (a freshly-logged-in recipient page) downloads the shared file. */
async function downloadSharedFile(page: Page): Promise<void> {
  // Poll, reloading to re-drain B's inbox each attempt, until the shared building
  // is listed on the Sharing tab — replaces a blind write→read cooldown. The
  // recipient's per-file download lives on the building's detail page (the
  // read-only Files section), so open it from the Sharing-tab row's link.
  await reloadUntil(page, async () => {
    await page.getByRole("tab", { name: t("navSharing") }).click();
    await expect(page.getByRole("link", { name: tPattern("shareBuildingN") }).first())
      .toBeVisible({ timeout: T.quick });
  });
  await page.getByRole("link", { name: tPattern("shareBuildingN") }).first().click();
  const fileRow = page.locator("li", { hasText: "sample.pdf" });
  await expect(fileRow).toBeVisible({ timeout: T.action });
  const dl = page.waitForEvent("download");
  await fileRow.getByRole("button", { name: t("btnDownload") }).click();
  const download = await dl;
  expect(download.suggestedFilename()).toBe("sample.pdf");
}

test.describe("file sharing across two pods", () => {
  test.skip(!pair.ok, pair.ok ? "" : pair.reason);
  test.describe.configure({ mode: "serial" });

  test("direct (By WebID): A attaches a file + shares; B downloads it", async ({ browser }) => {
    test.setTimeout(T.testSharing);
    const street = "Share Files Direct Strasse 1";
    // Log both in first, and keep B's session open THROUGH the share: B's inbox is
    // provisioned asynchronously after login (ensureOwnInbox), and A must be able
    // to POST the grant notification to it or the share 403s. A's add+upload+share
    // takes ~30 s — far longer than the provisioning — so by share time it exists.
    // (Closing B right after login raced that provisioning.)
    // Clean START is free (fresh per-run collection / restarted CSS); the spec
    // wipes BOTH pods at the END instead.
    const [a, b1] = await freshPagesParallel(browser, [A, B]);
    await assertCleanStart(a.page, "share-files:A");
    await assertCleanStart(b1.page, "share-files:B");
    a.page.on("dialog", (d) => d.accept());
    try {
      // Discover B's REAL WebID from its logged-in session (the account menu),
      // rather than deriving it from the username — works without WEBID_B and
      // regardless of the provider's WebID layout.
      const bWebId = await webIdOf(b1.page);
      await addBuilding(a.page, street);
      await uploadBuildingFile(a.page, street, FIXTURE);
      await shareByWebId(a.page, street, bWebId);
      await b1.ctx.close(); // inbox provisioned; B re-logs in fresh below to drain it

      const b2 = await freshPage(browser, B); // fresh login → inbox archives grant
      try {
        await downloadSharedFile(b2.page);
      } finally {
        await b2.ctx.close();
      }
    } finally {
      await b1.ctx.close().catch(() => {}); // no-op if already closed above
      await deleteOwnBuilding(a.page, street);
      // Leave both Pods empty — the per-run collection is removed entirely on each.
      const bEnd = await freshPage(browser, B);
      try {
        await verifyAndResetBoth(a.page, bEnd.page, "share-files");
      } finally {
        await bEnd.ctx.close();
        await a.ctx.close();
      }
    }
  });

});

/** Best-effort cleanup: delete A's throwaway building. */
async function deleteOwnBuilding(page: Page, street: string): Promise<void> {
  try {
    if (page.isClosed()) return;
    // A failed step may have left a modal open; dismiss it (Escape) so the clicks
    // below aren't blocked by its backdrop and hang (default action timeout is 0).
    await page.keyboard.press("Escape").catch(() => {});
    await page.goto("/");
    await openBuildingsList(page);
    const row = page.locator("li", { hasText: street }).first();
    if (await row.count()) {
      await row.getByRole("button", { name: t("buildingDeleteAria") })
        .click({ timeout: T.visible });
      await confirmDialog(page, "Delete");
      await expect(page.getByText(t("buildingDeleted")).first())
        .toBeVisible({ timeout: T.action });
    }
  } catch {
    // best-effort
  }
}
