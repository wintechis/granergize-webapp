import { t } from "../helpers/i18n.ts";
import { expect, type Page, test } from "@playwright/test";
import { account, hasAccount, login } from "../helpers/login.ts";
import { confirmDialog } from "../helpers/confirm.ts";
import {
  addBuilding,
  buildingIdOf,
  buildingRoute,
  deleteBuildingRow,
  openBuildingsList,
} from "../helpers/manage.ts";
import { newCapturedPage } from "../helpers/consoleLog.ts";
import { assertCleanStart, verifyAndReset } from "../helpers/cleanSlate.ts";
import { T } from "../helpers/timeouts.ts";

/**
 * Building file attachments e2e. Covers the owner flow end-to-end through the UI:
 * open the Files dialog from a Manage row, upload a file, see it listed, download
 * it, flag it as the energy certificate, then delete it. Self-cleaning — adds its
 * own throwaway building and deletes it.
 *
 *   # tier 3 (local CSS, no creds):
 *   deno task e2e:local test/e2e/tasks/attachments.spec.ts
 *   # tier 4 (real Pods):
 *   source test/.env.e2e.local && deno task e2e:remote:spec test/e2e/tasks/attachments.spec.ts
 *
 * Runs against Alice (account A). Skipped when account env vars are absent.
 */

const ADDR = "Attachments E2E Strasse 1";
const ACC = account("A");

test.describe.configure({ mode: "serial" });

test.describe("building file attachments", () => {
  test.skip(
    !hasAccount(ACC),
    `Set WEBID_A_USERNAME / WEBID_A_PASSWORD (a throwaway Solid Pod) to run the attachments e2e.`,
  );

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(T.setup); // login (IdP + consent) can be slow / retried
    // "Delete building" / "Delete file" confirm via window.confirm — auto-accept.
    page = await newCapturedPage(browser, "attachments");
    page.on("dialog", (d) => d.accept().catch(() => {}));
    await login(page, ACC);
    await assertCleanStart(page);
  });

  test.afterAll(async () => {
    await verifyAndReset(page, "attachments");
    await page.close();
  });

  test("upload, download, flag as certificate, and delete a file", async () => {
    test.setTimeout(T.testSolo);

    await addBuilding(page, ADDR);
    const listRow = page.locator("li[data-building-id]", { hasText: ADDR }).first();
    await expect(listRow).toBeVisible({ timeout: T.action });
    const id = await buildingIdOf(listRow);
    if (!id) throw new Error("attachments: missing building id");

    // Files live in the building page's Files section now (no per-row dialog).
    await page.goto(buildingRoute("building", id));
    await expect(page.getByRole("heading", { name: t("secFiles") }))
      .toBeVisible({ timeout: T.action });

    // Upload the fixture (the file input is hidden; set it directly).
    await page.locator("#building-files-input").setInputFiles(
      "test/e2e/fixtures/sample.pdf",
    );
    // Scope to the file's own row — the page header carries its OWN "Download …"
    // (the building workbook), so an unscoped "Download" would grab that instead.
    const fileRow = page.locator("li", { hasText: "sample.pdf" });
    await expect(fileRow).toBeVisible({ timeout: T.action });

    // Download it — the browser download fires with the original filename.
    const downloadPromise = page.waitForEvent("download");
    await fileRow.getByRole("button", { name: t("btnDownload") }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("sample.pdf");

    // Flag it as the energy certificate → the badge appears.
    await fileRow.getByRole("button", { name: t("filesSetCert") }).click();
    await expect(fileRow.getByText(t("energyCertChip")))
      .toBeVisible({ timeout: T.action });

    // Delete it (the in-app confirm dialog asks first) → it drops off the list.
    await fileRow.getByRole("button", { name: t("filesDeleteAria", { filename: "sample.pdf" }) }).click();
    await confirmDialog(page, "Delete");
    await expect(page.getByText("sample.pdf"))
      .toHaveCount(0, { timeout: T.action });

    // Cleanup: delete the throwaway building from the Buildings list.
    await page.goto("/");
    await openBuildingsList(page);
    await deleteBuildingRow(page, id);
  });
});
