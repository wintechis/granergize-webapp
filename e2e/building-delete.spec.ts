import { expect, type Page, test } from "@playwright/test";
import { account, hasAccount, login } from "./helpers/login.ts";

/**
 * Building-deletion e2e (PROBLEMS.md #3). DESTRUCTIVE: it removes one of the
 * seeded buildings from the Pod (the Manage "Delete building" row action →
 * `useDeleteBuilding` → de-registers the source, deletes the building file and
 * its energy subtree). Like the other smokes it therefore expects a freshly
 * wiped + reseeded Pod, and consumes one building per run.
 *
 *   source .env.e2e.local && deno task e2e building-delete --workers=1
 *
 * Defaults to account B (solidweb.org); override with E2E_SMOKE_ACCOUNT=A.
 * Skipped automatically when the account env vars are absent.
 */

const WHICH = (process.env.E2E_SMOKE_ACCOUNT === "A" ? "A" : "B") as "A" | "B";
const ACC = account(WHICH);

const buildingRows = (page: Page) =>
  page.locator("li", { hasText: /Building \d+/ });

test.describe.configure({ mode: "serial" });

test.describe("building deletion", () => {
  test.skip(
    !hasAccount(ACC),
    `Set E2E_USERNAME_${WHICH} / E2E_PASSWORD_${WHICH} (a throwaway Solid Pod) to run the building-delete e2e.`,
  );

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(240_000); // login (IdP + consent) can be slow / retried
    page = await browser.newPage();
    // Defensive: building delete has no confirm() today, but accept one if added.
    page.on("dialog", (d) => d.accept().catch(() => {}));
    await login(page, ACC);
  });

  test.afterAll(async () => {
    await page.close();
  });

  test("deleting an owned building removes its row from Manage", async () => {
    test.setTimeout(180_000);

    await page.getByRole("tab", { name: "Manage" }).click();
    const rows = buildingRows(page);
    await expect(rows.first()).toBeVisible({ timeout: 120_000 });

    const before = await rows.count();
    expect(before, "a seeded building to delete (reseed the Pod if 0)")
      .toBeGreaterThan(0);

    // Target the LAST building row, so a full-suite run doesn't disturb the
    // first building the energy specs key on. Capture its id to assert removal.
    const victim = rows.last();
    const id = (await victim.textContent())?.match(/Building (\d+)/)?.[1];
    expect(id, "the victim building's id").toBeTruthy();

    await victim.getByRole("button", { name: "Delete building" }).click();

    // The single global notification confirms the write…
    await expect(page.getByText("Building deleted").first())
      .toBeVisible({ timeout: 90_000 });
    // …and the building's own row is gone (no row still names that id), with the
    // owned-building count dropped by exactly one.
    await expect(
      page.locator("li", { hasText: new RegExp(`Building ${id}(?!\\d)`) }),
    ).toHaveCount(0, { timeout: 90_000 });
    await expect(buildingRows(page)).toHaveCount(before - 1);
  });
});
