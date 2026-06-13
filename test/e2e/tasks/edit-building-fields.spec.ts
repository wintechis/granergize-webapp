import { expect, type Page, test } from "@playwright/test";
import { account, hasAccount, login } from "../helpers/login.ts";
import { confirmDialog } from "../helpers/confirm.ts";
import { addBuilding } from "../helpers/manage.ts";
import { newCapturedPage } from "../helpers/consoleLog.ts";
import { assertCleanStart, verifyAndReset } from "../helpers/cleanSlate.ts";
import { T } from "../helpers/timeouts.ts";

/**
 * Edit-building operating-costs + certifications e2e. Covers the Edit dialog's
 * Operating costs / Certifications sections (added so those investor master-data
 * fields are editable, not only importable): fill an operating-cost figure and a
 * certification, save, REOPEN the dialog and assert the values round-tripped
 * through Turtle. Self-cleaning — adds its own throwaway building and deletes it.
 *
 * The Operating-costs / Certifications sections are investor-specific, so the
 * Edit dialog only renders them when the building's provenance is `investor`.
 * Provenance is stamped from the org's company kind at add-time, so the test
 * sets the kind to Investor via the in-app Organisation form first.
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
    test.setTimeout(T.setup); // login (IdP + consent) can be slow / retried
    page = await newCapturedPage(browser, "edit-building-fields");
    // "Delete building" confirms via window.confirm — accept automatically.
    page.on("dialog", (d) => d.accept().catch(() => {}));
    await login(page, ACC);
    await assertCleanStart(page);
    // The Edit dialog renders the Operating-costs / Certifications sections for every
    // building now (one generic form, no role gating), so no setup is needed.
  });

  test.afterAll(async () => {
    await verifyAndReset(page, "edit-building-fields");
    await page.close();
  });

  test("operating costs + a certification persist through an edit", async () => {
    test.setTimeout(T.testSolo);

    await addBuilding(page, ADDR);
    const row = page.locator("li", { hasText: ADDR }).first();
    await expect(row).toBeVisible({ timeout: T.action });

    // Open the Edit dialog and confirm the new investor sections are present.
    await row.getByRole("button", { name: "Edit building" }).click();
    let dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Operating costs", { exact: true }))
      .toBeVisible({ timeout: T.visible });
    await expect(dialog.getByText("Certifications", { exact: true }))
      .toBeVisible();

    // Fill an operating-cost figure and the first certification, then save.
    // The cert type is a select over the known systems (it mints an IRI local
    // name, so free text is rejected), not a text field.
    await dialog.getByLabel("Insurance", { exact: true }).fill("1200");
    await dialog.getByLabel("Type", { exact: true }).first().click();
    await page.getByRole("option", { name: "LEED" }).click();
    await dialog.getByLabel("Level", { exact: true }).first().fill("Gold");
    await dialog.getByRole("button", { name: /save changes/i }).click();
    await expect(page.getByText(/building updated/i))
      .toBeVisible({ timeout: T.action });
    await page.waitForLoadState("networkidle").catch(() => {}); // list refetch

    // Reopen Edit — the values must have round-tripped through the Pod's Turtle.
    await row.getByRole("button", { name: "Edit building" }).click();
    dialog = page.getByRole("dialog");
    await expect(dialog.getByLabel("Insurance", { exact: true }))
      .toHaveValue("1200", { timeout: T.visible });
    await expect(dialog.getByLabel("Type", { exact: true }).first())
      .toHaveText("LEED");
    await expect(dialog.getByLabel("Level", { exact: true }).first())
      .toHaveValue("Gold");
    await dialog.getByRole("button", { name: /^cancel$/i }).click();
    await expect(dialog).toBeHidden({ timeout: T.visible });

    // Cleanup: delete the throwaway building.
    await row.getByRole("button", { name: "Delete building" }).click();
    await confirmDialog(page, "Delete");
    await expect(page.getByText("Building deleted").first())
      .toBeVisible({ timeout: T.action });
    await expect(row).toHaveCount(0, { timeout: T.action });
  });
});
