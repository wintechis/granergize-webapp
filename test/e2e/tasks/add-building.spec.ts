import { expect, type Page, test } from "@playwright/test";
import { account, hasAccount, login } from "../helpers/login.ts";
import { confirmDialog } from "../helpers/confirm.ts";
import { buildingRows } from "../helpers/manage.ts";
import { newCapturedPage } from "../helpers/consoleLog.ts";
import { assertCleanStart, verifyAndReset } from "../helpers/cleanSlate.ts";
import { T } from "../helpers/timeouts.ts";

/**
 * Building add + delete e2e (PROBLEMS.md #3). Self-cleaning: it adds its own
 * throwaway building (a unique address), asserts it appears on Manage, deletes it
 * via the "Delete building" row action, and asserts the row is gone and the count
 * is back where it started — so it leaves the Pod exactly as it found it (no need
 * to consume a seeded building). Adding no longer needs a data-room role.
 *
 *   # tier 3 (local CSS, no creds):
 *   deno task e2e:local test/e2e/tasks/add-building.spec.ts
 *   # tier 4 (real Pods):
 *   source test/.env.e2e.local && deno task e2e:remote:spec test/e2e/tasks/add-building.spec.ts
 *
 * Runs against Alice (account A).
 * Skipped automatically when the account env vars are absent.
 */

const ADDR = "Delete E2E Strasse 1"; // unique address for the throwaway building

const ACC = account("A"); // Alice -- solo specs use one account

test.describe.configure({ mode: "serial" });

test.describe("building deletion", () => {
  test.skip(
    !hasAccount(ACC),
    `Set E2E_USERNAME_A / E2E_PASSWORD_A (a throwaway Solid Pod) to run the building-delete e2e.`,
  );

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(T.setup); // login (IdP + consent) can be slow / retried
    page = await newCapturedPage(browser, "add-building");
    // "Delete building" confirms via window.confirm — accept automatically.
    page.on("dialog", (d) => d.accept().catch(() => {}));
    await login(page, ACC);
    await assertCleanStart(page);
  });

  test.afterAll(async () => {
    await verifyAndReset(page, "add-building");
    await page.close();
  });

  test("a building can be added and then deleted from Manage", async () => {
    test.setTimeout(T.testSolo);

    await page.getByRole("tab", { name: "Manage" }).click();
    const addBtn = page.getByRole("button", {
      name: "Add Building",
      exact: true,
    })
      .first();
    await expect(addBtn).toBeVisible({ timeout: T.action });
    await page.waitForLoadState("networkidle").catch(() => {}); // list settles
    const before = await buildingRows(page).count();

    // Add a throwaway building. The User template needs only the location fields;
    // adding is decoupled from data-room roles.
    await addBtn.click();
    const add = page.getByRole("dialog");
    await add.getByLabel(/street address/i).fill(ADDR);
    await add.getByLabel(/locality/i).fill("Nürnberg");
    await add.getByLabel(/postal code/i).fill("90451");
    await add.getByLabel(/region/i).fill("Bayern");
    await add.getByLabel(/latitude/i).fill("49.45");
    await add.getByLabel(/longitude/i).fill("11.08");
    await add.getByRole("button", { name: /^Add Building$/ }).click();
    await expect(page.getByText(/building added/i))
      .toBeVisible({ timeout: T.action });

    // It appears on Manage (closing the dialog refetches the list)…
    const row = page.locator("li", { hasText: ADDR });
    await expect(row.first()).toBeVisible({ timeout: T.action });

    // …delete it, and the row disappears with the count back to the start.
    await row.first().getByRole("button", { name: "Delete building" }).click();
    await confirmDialog(page, "Delete");
    await expect(page.getByText("Building deleted").first())
      .toBeVisible({ timeout: T.action });
    await expect(row).toHaveCount(0, { timeout: T.action });
    await expect(buildingRows(page)).toHaveCount(before);
  });
});
