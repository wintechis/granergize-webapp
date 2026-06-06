import { expect, type Page, test } from "@playwright/test";
import { hasAccount, login, SOLO_SLOT, soloAccount } from "../helpers/login.ts";
import { buildingRows } from "../helpers/manage.ts";

/**
 * Building add + delete e2e (PROBLEMS.md #3). Self-cleaning: it adds its own
 * throwaway building (a unique address), asserts it appears on Manage, deletes it
 * via the "Delete building" row action, and asserts the row is gone and the count
 * is back where it started — so it leaves the Pod exactly as it found it (no need
 * to consume a seeded building). Adding no longer needs a data-room role.
 *
 *   source .env.e2e.local && deno task e2e:base building-delete --workers=1
 *
 * Runs against the solo Pod (E2E_SOLO; default C = solidweb).
 * Skipped automatically when the account env vars are absent.
 */

const ACC = soloAccount();
const ADDR = "Delete E2E Strasse 1"; // unique address for the throwaway building

test.describe.configure({ mode: "serial" });

test.describe("building deletion", () => {
  test.skip(
    !hasAccount(ACC),
    `Set E2E_USERNAME_${SOLO_SLOT} / E2E_PASSWORD_${SOLO_SLOT} (a throwaway Solid Pod) to run the building-delete e2e.`,
  );

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(240_000); // login (IdP + consent) can be slow / retried
    page = await browser.newPage();
    // "Delete building" confirms via window.confirm — accept automatically.
    page.on("dialog", (d) => d.accept().catch(() => {}));
    await login(page, ACC);
  });

  test.afterAll(async () => {
    await page.close();
  });

  test("a building can be added and then deleted from Manage", async () => {
    test.setTimeout(180_000);

    await page.getByRole("tab", { name: "Manage" }).click();
    const addBtn = page.getByRole("button", { name: "Add Building", exact: true })
      .first();
    await expect(addBtn).toBeVisible({ timeout: 120_000 });
    await page.waitForLoadState("networkidle").catch(() => {}); // list settles
    const before = await buildingRows(page).count();

    // Add a throwaway building. The User template needs only the location fields;
    // adding is decoupled from data-room roles.
    await addBtn.click();
    const add = page.getByRole("dialog");
    await add.getByLabel("Template").click();
    await page.getByRole("option", { name: "User", exact: true }).click();
    await add.getByLabel(/street address/i).fill(ADDR);
    await add.getByLabel(/locality/i).fill("Nürnberg");
    await add.getByLabel(/postal code/i).fill("90451");
    await add.getByLabel(/region/i).fill("Bayern");
    await add.getByLabel(/latitude/i).fill("49.45");
    await add.getByLabel(/longitude/i).fill("11.08");
    await add.getByRole("button", { name: /^Add Building$/ }).click();
    await expect(page.getByText(/building added/i))
      .toBeVisible({ timeout: 120_000 });

    // It appears on Manage (closing the dialog refetches the list)…
    const row = page.locator("li", { hasText: ADDR });
    await expect(row.first()).toBeVisible({ timeout: 60_000 });

    // …delete it, and the row disappears with the count back to the start.
    await row.first().getByRole("button", { name: "Delete building" }).click();
    await expect(page.getByText("Building deleted").first())
      .toBeVisible({ timeout: 90_000 });
    await expect(row).toHaveCount(0, { timeout: 60_000 });
    await expect(buildingRows(page)).toHaveCount(before);
  });
});
