import { expect, type Page, test } from "@playwright/test";
import { account, hasAccount, login } from "../helpers/login.ts";

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
  // Wait on the Add Building action itself, not a building row — the Pod may have
  // no buildings yet (so the test doesn't depend on demo seeding).
  const addBtn = page.getByRole("button", { name: "Add Building", exact: true })
    .first();
  await expect(addBtn).toBeVisible({ timeout: 120_000 });
  await addBtn.click();
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
    // The cleanup step deletes each imported building; "Delete building" confirms
    // via window.confirm — accept automatically.
    page.on("dialog", (d) => d.accept());
    // Import geocodes each building's address via Nominatim (lat/long are
    // required). e2e must not depend on a rate-limited third-party service — a
    // burst of real lookups intermittently throttles and leaves a building
    // uncoordinated, blocking submit. Stub it with deterministic coordinates so
    // the test exercises OUR import flow, not Nominatim's availability. (The
    // app's own throttle + coarsening fallback are covered by unit tests.)
    await page.route(/nominatim\.openstreetmap\.org/, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([{ lat: "49.45", lon: "11.08" }]),
      }));
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

    // Closing the dialog triggers a refetch of the Manage list (reloadData), so
    // the imported rows appear a moment later — poll the id diff rather than
    // reading it once before the refetch lands.
    await expect(buildingRows(page).first()).toBeVisible({ timeout: 60_000 });
    let added: string[] = [];
    await expect(async () => {
      added = (await buildingIds(page)).filter((id) => !before.has(id));
      expect(added.length, "imported buildings appear on Manage").toBeGreaterThan(0);
    }).toPass({ timeout: 60_000 });

    for (const id of added) {
      const row = page.locator("li", { hasText: `Building ${id}` });
      await row.first().getByRole("button", { name: "Delete building" }).click();
      // Wait for THIS row to vanish, not the shared "Building deleted" toast —
      // the toast lingers (~6 s) so it would still be visible from the previous
      // delete and let the loop race ahead before this one actually completed.
      await expect(row).toHaveCount(0, { timeout: 90_000 });
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
    // The Lastgang file carries only a label + readings (no address), so it can't
    // be geocoded — fill the required location fields manually to enable submit.
    // (Coordinates are irrelevant to what this test checks: the cancel path.)
    await dialog.getByLabel(/street address/i).fill("Cancel E2E Strasse 1");
    await dialog.getByLabel(/locality/i).fill("Nürnberg");
    await dialog.getByLabel(/postal code/i).fill("90451");
    await dialog.getByLabel(/region/i).fill("Bayern");
    await dialog.getByLabel(/latitude/i).fill("49.45");
    await dialog.getByLabel(/longitude/i).fill("11.08");
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
