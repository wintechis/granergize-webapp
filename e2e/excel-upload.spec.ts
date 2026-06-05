import { expect, type Page, test } from "@playwright/test";
import { account, hasAccount, login } from "./helpers/login.ts";

/**
 * Excel-import e2e (PROBLEMS.md #6). MUTATES the Pod: imports building(s) from an
 * XLSX template via Manage → "Add Building" → file picker, and exercises the
 * Cancel control on a long 15-min upload. Like the other smokes it expects a
 * freshly wiped + reseeded Pod. Adding a building no longer depends on a
 * data-room role — the Add dialog's selector is a plain import *template*.
 *
 *   source .env.e2e.local && deno task e2e excel-upload --workers=1
 *
 * Defaults to account B (solidweb.org); E2E_SMOKE_ACCOUNT=A to switch. Skipped
 * without creds. The happy-path test cleans up the buildings it adds; the cancel
 * test aborts before the building file is written (so no Manage row is created),
 * leaving only orphaned partial energy files — tolerated by the reseed contract.
 */

const WHICH = (process.env.E2E_SMOKE_ACCOUNT === "A" ? "A" : "B") as "A" | "B";
const ACC = account(WHICH);

const buildingRows = (page: Page) =>
  page.locator("li", { hasText: /Building \S+/ });

/** Capture the id token of every owned building row currently on Manage. */
async function buildingIds(page: Page): Promise<string[]> {
  const rows = buildingRows(page);
  const n = await rows.count();
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const id = (await rows.nth(i).textContent())?.match(/Building (\S+)/)?.[1];
    if (id) ids.push(id);
  }
  return ids;
}

/** Open the Add-building dialog from the Manage tab (manual entry — no picker). */
async function openAddDialog(page: Page): Promise<void> {
  await page.getByRole("tab", { name: "Manage" }).click();
  await expect(buildingRows(page).first()).toBeVisible({ timeout: 120_000 });
  await page.getByRole("button", { name: "Add Building", exact: true }).first()
    .click();
}

/** Pick an import template in the dialog's (always-populated) Template select. */
async function selectTemplate(page: Page, label: string): Promise<void> {
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Template").click();
  await page.getByRole("option", { name: label, exact: true }).click();
}

test.describe.configure({ mode: "serial" });

test.describe("excel upload", () => {
  test.skip(
    !hasAccount(ACC),
    `Set E2E_USERNAME_${WHICH} / E2E_PASSWORD_${WHICH} (a throwaway Solid Pod) to run the excel-upload e2e.`,
  );

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(240_000); // login (IdP + consent) can be slow / retried
    page = await browser.newPage();
    await login(page, ACC);
  });

  test.afterAll(async () => {
    await page.close();
  });

  test("imports building(s) from an investor XLSX template", async () => {
    test.setTimeout(180_000);

    await openAddDialog(page);
    await selectTemplate(page, "Investor");

    const before = new Set(await buildingIds(page));

    // The file input is hidden (display:none); set it directly rather than
    // driving the OS picker.
    await page.getByRole("dialog").locator('input[type="file"]').setInputFiles(
      "public/templates/investor-template.xlsx",
    );
    await expect(page.getByText(/Loaded \d+ building\(s\) from file/))
      .toBeVisible({ timeout: 60_000 });

    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: /^Add (Building|\d+ Buildings)$/ })
      .click();

    await expect(page.getByText(/buildings? added/).first())
      .toBeVisible({ timeout: 120_000 });

    // Exactly the new building(s) appeared; clean them up so the test repeats.
    await expect(buildingRows(page).first()).toBeVisible({ timeout: 60_000 });
    const added = (await buildingIds(page)).filter((id) => !before.has(id));
    expect(added.length, "at least one building was imported").toBeGreaterThan(0);

    for (const id of added) {
      const row = page.locator("li", { hasText: `Building ${id}` }).first();
      await row.getByRole("button", { name: "Delete building" }).click();
      await expect(page.getByText("Building deleted").first())
        .toBeVisible({ timeout: 90_000 });
    }
    // Back to the original set — no residue.
    expect(new Set(await buildingIds(page))).toEqual(before);
  });

  test("a long 15-min upload can be cancelled", async () => {
    test.setTimeout(180_000);

    await openAddDialog(page);
    await selectTemplate(page, "User");

    await page.getByRole("dialog").locator('input[type="file"]').setInputFiles(
      "public/templates/user-lastgang-template.xlsx",
    );
    // The Lastgang parse reports the readings/days it's ready to upload.
    await expect(page.getByText(/readings.*days.*ready to upload/))
      .toBeVisible({ timeout: 60_000 });

    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: /^Add (Building|\d+ Buildings)$/ })
      .click();

    // The busy overlay surfaces the live requests and a Cancel control once the
    // ~365 daily-file writes start. Cancel and assert the abort path.
    const cancel = page.getByRole("button", { name: "Cancel upload" });
    await expect(cancel).toBeVisible({ timeout: 60_000 });
    await cancel.click();

    await expect(page.getByText(/Import cancelled/).first())
      .toBeVisible({ timeout: 60_000 });
  });
});
