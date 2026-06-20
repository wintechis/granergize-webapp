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
 * PER-ATTACHMENT sharing across TWO throwaway Solid Pods — the withholding half
 * of the attachments feature (`interop:includesAttachment`). A attaches TWO files
 * to a building and shares it with B "By WebID", but UNTICKS one in the share
 * dialog's attachment checklist. The granted file gets a per-file read ACL; the
 * withheld file gets none (and the `files/` container default is not granted).
 *
 * B (fresh login → inbox archived) opens the shared building's detail page. Both
 * filenames appear (the building TTL lists every `bldg:hasAttachment`, readable by
 * B), but only the GRANTED file downloads — the WITHHELD file's binary 403s, so its
 * download surfaces the standard error toast. This is the recipient-visible proof
 * that selection actually withholds. Self-cleaning; needs an interoperating A/B
 * pair (both on one provider).
 *
 *   deno task e2e:local test/e2e/tasks/share-attachment-subset.spec.ts
 */

const A = account("A");
const B = account("B");
const KEEP = "test/e2e/fixtures/sample.pdf"; // granted
const WITHHELD = "test/e2e/fixtures/investor-import.xlsx"; // withheld
const KEEP_NAME = "sample.pdf";
const WITHHELD_NAME = "investor-import.xlsx";
const pair = resolveAccounts({ count: 2, interoperatingPair: true });

test.describe("per-attachment share across two pods", () => {
  test.skip(!pair.ok, pair.ok ? "" : pair.reason);
  test.describe.configure({ mode: "serial" });

  test("A withholds one of two files; B reads the granted file but not the withheld one", async ({ browser }) => {
    test.setTimeout(T.testSharing);
    const street = "Per Attachment Share Strasse 1";
    // Keep B's first session open through the share so its inbox is provisioned
    // (ensureOwnInbox) before A POSTs the grant — same rationale as share-files.
    const [a, b1] = await freshPagesParallel(browser, [A, B]);
    await assertCleanStart(a.page, "attachment-subset:A");
    await assertCleanStart(b1.page, "attachment-subset:B");
    a.page.on("dialog", (d) => d.accept());
    try {
      const bWebId = await webIdOf(b1.page);
      await addBuilding(a.page, street);
      await uploadBuildingFile(a.page, street, KEEP);
      await uploadBuildingFile(a.page, street, WITHHELD);
      // Share with B, WITHHOLDING the xlsx — only sample.pdf is granted.
      await shareByWebId(a.page, street, bWebId, { withhold: [WITHHELD_NAME] });
      await b1.ctx.close(); // inbox provisioned; B re-logs in fresh below to drain it

      const b2 = await freshPage(browser, B);
      try {
        // Drain B's inbox (reload re-drains) until the shared building is listed
        // on the Sharing tab, then open its detail page.
        await reloadUntil(b2.page, async () => {
          await b2.page.getByRole("tab", { name: t("navSharing") }).click();
          await expect(
            b2.page.getByRole("link", { name: tPattern("shareBuildingN") }).first(),
          ).toBeVisible({ timeout: T.action });
        });
        await b2.page.getByRole("link", { name: tPattern("shareBuildingN") }).first().click();

        // The building's Files section lists BOTH names (B can read the building
        // TTL, which carries every bldg:hasAttachment link).
        const keepRow = b2.page.locator("li", { hasText: KEEP_NAME });
        const withheldRow = b2.page.locator("li", { hasText: WITHHELD_NAME });
        await expect(keepRow).toBeVisible({ timeout: T.action });
        await expect(withheldRow).toBeVisible();

        // The GRANTED file downloads — B holds a per-file read grant.
        const dl = b2.page.waitForEvent("download");
        await keepRow.getByRole("button", { name: t("btnDownload") }).click();
        expect((await dl).suggestedFilename()).toBe(KEEP_NAME);

        // The WITHHELD file's binary has no grant → the download 403s and surfaces
        // the standard "Failed to download the file" error toast.
        await withheldRow.getByRole("button", { name: t("btnDownload") }).click();
        await expect(
          b2.page.getByText(`Failed to ${t("actionDownloadFile")}`),
        ).toBeVisible({ timeout: T.action });
      } finally {
        await b2.ctx.close();
      }
    } finally {
      await b1.ctx.close().catch(() => {});
      await deleteOwnBuilding(a.page, street);
      const bEnd = await freshPage(browser, B);
      try {
        await verifyAndResetBoth(a.page, bEnd.page, "attachment-subset");
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
