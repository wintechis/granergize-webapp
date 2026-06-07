import { expect, type Page, test } from "@playwright/test";
import { account, hasAccount, login } from "../helpers/login.ts";
import { addBuilding } from "../helpers/manage.ts";
import { newCapturedPage } from "../helpers/consoleLog.ts";
import { assertCleanStart, verifyAndReset } from "../helpers/cleanSlate.ts";

/**
 * Edit-building operating-costs + certifications e2e. Covers the Edit dialog's
 * Operating costs / Certifications sections (added so those investor master-data
 * fields are editable, not only importable): fill an operating-cost figure and a
 * certification, save, REOPEN the dialog and assert the values round-tripped
 * through Turtle. Self-cleaning — adds its own throwaway building and deletes it.
 *
 * A building added without a producing role has undefined provenance, so the Edit
 * dialog defaults `role` to "investor" and shows these sections.
 *
 *   # tier 3 (local CSS, no creds):
 *   deno task e2e:local test/e2e/tasks/edit-building-fields.spec.ts
 *   # tier 4 (real Pods):
 *   source test/.env.e2e.local && deno task e2e:remote:spec test/e2e/tasks/edit-building-fields.spec.ts
 *
 * Runs against Alice (account A). Skipped when account env vars are absent.
 */

const ADDR = "Edit Fields E2E Strasse 1";
const ACC = account("A");

test.describe.configure({ mode: "serial" });

test.describe("edit building operating costs + certifications", () => {
  test.skip(
    !hasAccount(ACC),
    `Set E2E_USERNAME_A / E2E_PASSWORD_A (a throwaway Solid Pod) to run the edit-fields e2e.`,
  );

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(240_000); // login (IdP + consent) can be slow / retried
    page = await newCapturedPage(browser, "edit-building-fields");
    // "Delete building" confirms via window.confirm — accept automatically.
    page.on("dialog", (d) => d.accept().catch(() => {}));
    await login(page, ACC);
    await assertCleanStart(page);
  });

  test.afterAll(async () => {
    await verifyAndReset(page, "edit-building-fields");
    await page.close();
  });

  test("operating costs + a certification persist through an edit", async () => {
    test.setTimeout(180_000);

    await addBuilding(page, ADDR);
    const row = page.locator("li", { hasText: ADDR }).first();
    await expect(row).toBeVisible({ timeout: 60_000 });

    // Open the Edit dialog and confirm the new investor sections are present.
    await row.getByRole("button", { name: "Edit building" }).click();
    let dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Operating costs", { exact: true }))
      .toBeVisible({ timeout: 15_000 });
    await expect(dialog.getByText("Certifications", { exact: true }))
      .toBeVisible();

    // Fill an operating-cost figure and the first certification, then save.
    await dialog.getByLabel("Insurance", { exact: true }).fill("1200");
    await dialog.getByLabel(/^Type \(/).first().fill("LEED");
    await dialog.getByLabel("Level", { exact: true }).first().fill("Gold");
    await dialog.getByRole("button", { name: /save changes/i }).click();
    await expect(page.getByText(/building updated/i))
      .toBeVisible({ timeout: 60_000 });
    await page.waitForLoadState("networkidle").catch(() => {}); // list refetch

    // Reopen Edit — the values must have round-tripped through the Pod's Turtle.
    await row.getByRole("button", { name: "Edit building" }).click();
    dialog = page.getByRole("dialog");
    await expect(dialog.getByLabel("Insurance", { exact: true }))
      .toHaveValue("1200", { timeout: 15_000 });
    await expect(dialog.getByLabel(/^Type \(/).first()).toHaveValue("LEED");
    await expect(dialog.getByLabel("Level", { exact: true }).first())
      .toHaveValue("Gold");
    await dialog.getByRole("button", { name: /^cancel$/i }).click();
    await expect(dialog).toBeHidden({ timeout: 15_000 });

    // Cleanup: delete the throwaway building.
    await row.getByRole("button", { name: "Delete building" }).click();
    await expect(page.getByText("Building deleted").first())
      .toBeVisible({ timeout: 90_000 });
    await expect(row).toHaveCount(0, { timeout: 60_000 });
  });
});
