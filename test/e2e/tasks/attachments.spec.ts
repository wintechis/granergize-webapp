import { expect, type Page, test } from "@playwright/test";
import { account, hasAccount, login } from "../helpers/login.ts";
import { confirmDialog } from "../helpers/confirm.ts";
import { addBuilding } from "../helpers/manage.ts";
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
    `Set E2E_USERNAME_A / E2E_PASSWORD_A (a throwaway Solid Pod) to run the attachments e2e.`,
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
    const row = page.locator("li", { hasText: ADDR }).first();
    await expect(row).toBeVisible({ timeout: T.action });

    // Open the Files dialog from the row action.
    await row.getByRole("button", { name: "Manage files" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("button", { name: "Add files" }))
      .toBeVisible({ timeout: T.visible });

    // Upload the fixture (the file input is hidden; set it directly).
    await dialog.locator('input[type="file"]').setInputFiles(
      "test/e2e/fixtures/sample.pdf",
    );
    await expect(dialog.getByText("sample.pdf")).toBeVisible({ timeout: T.action });

    // Download it — the browser download fires with the original filename.
    const downloadPromise = page.waitForEvent("download");
    await dialog.getByRole("button", { name: "Download" }).first().click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("sample.pdf");

    // Flag it as the energy certificate → the badge appears.
    await dialog.getByRole("button", { name: "Set as cert" }).first().click();
    await expect(dialog.getByText("Energy certificate"))
      .toBeVisible({ timeout: T.action });

    // Delete it (the in-app confirm dialog asks first) → it drops off the list.
    await dialog.getByRole("button", { name: "Delete sample.pdf" }).first()
      .click();
    await confirmDialog(page, "Delete");
    await expect(dialog.getByText("sample.pdf"))
      .toHaveCount(0, { timeout: T.action });
    await dialog.getByRole("button", { name: /close/i }).click();

    // Cleanup: delete the throwaway building.
    await row.getByRole("button", { name: "Delete building" }).click();
    await confirmDialog(page, "Delete");
    await expect(page.getByText("Building deleted").first())
      .toBeVisible({ timeout: T.action });
    await expect(row).toHaveCount(0, { timeout: T.action });
  });
});
