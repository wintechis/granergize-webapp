import { expect, type Locator, type Page, test } from "@playwright/test";
import { account, hasAccount, login } from "./helpers/login.ts";

/**
 * Provenance-from-profile e2e (PROBLEMS.md #1). Proves a building's PROV
 * provenance comes from the **profile data-producer role**, not the import
 * template: set the role to *Investor* but add a building with the *User*
 * template, then in Create View the building filters under **Investor** (its
 * provenance) and NOT under **User** (its template) — `CreateViewDialog` filters
 * `b.provenance === selectedRole`.
 *
 *   source .env.e2e.local && deno task e2e provenance --workers=1
 *
 * MUTATES the Pod but fully reverses itself: it restores the prior profile
 * producer role in afterAll and adds+deletes its one building. Defaults to
 * account B; E2E_SMOKE_ACCOUNT=A to switch. Skipped without creds.
 */

const WHICH = (process.env.E2E_SMOKE_ACCOUNT === "A" ? "A" : "B") as "A" | "B";
const ACC = account(WHICH);
const ADDR = "Provenance E2E Strasse 1"; // unique, matchable building address

const buildingRows = (page: Page) =>
  page.locator("li", { hasText: /Building \S+/ });

// The producer role this Pod had before the test, restored in afterAll so the
// spec fully reverses its profile mutation (defaults to "Not set" on a reseeded
// Pod). Captured from the dialog in the test.
let priorRole = "Not set";

/** Open the avatar-menu Organisation dialog (waits for the role prefill). */
async function openOrgDialog(page: Page): Promise<Locator> {
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: /organisation/i }).click();
  const org = page.getByRole("dialog");
  await expect(org).toBeVisible({ timeout: 30_000 });
  await page.waitForLoadState("networkidle").catch(() => {}); // role prefills async
  return org;
}

/** Select a role in the open Organisation dialog and save (Cancel if unchanged). */
async function setRoleAndSave(
  page: Page,
  org: Locator,
  label: string,
): Promise<void> {
  const sel = org.getByLabel("Your data-producer role");
  if ((await sel.textContent())?.trim() === label) {
    await org.getByRole("button", { name: /cancel/i }).click();
    return;
  }
  await sel.click();
  await page.getByRole("option", { name: label, exact: true }).click();
  await org.getByRole("button", { name: /^save$/i }).click();
  await expect(page.getByText(/organisation saved/i))
    .toBeVisible({ timeout: 60_000 });
}

test.describe.configure({ mode: "serial" });

test.describe("provenance from profile", () => {
  test.skip(
    !hasAccount(ACC),
    `Set E2E_USERNAME_${WHICH} / E2E_PASSWORD_${WHICH} (a throwaway Solid Pod) to run the provenance e2e.`,
  );

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(240_000);
    page = await browser.newPage();
    page.on("dialog", (d) => d.accept().catch(() => {}));
    await login(page, ACC);
  });

  test.afterAll(async () => {
    // Fully reverse the profile mutation: restore the role this Pod started with.
    try {
      if (!page.isClosed()) {
        const org = await openOrgDialog(page);
        await setRoleAndSave(page, org, priorRole);
      }
    } catch {
      // best-effort restore; never fail teardown
    } finally {
      await page.close();
    }
  });

  test("the profile producer role, not the template, sets a building's provenance", async () => {
    test.setTimeout(180_000);

    // 1. Capture the current producer role (to restore later), then set Investor.
    const org = await openOrgDialog(page);
    priorRole =
      (await org.getByLabel("Your data-producer role").textContent())?.trim() ||
      "Not set";
    await setRoleAndSave(page, org, "Investor");

    // 2. Add a building with the USER template (≠ the profile role).
    await page.getByRole("tab", { name: "Manage" }).click();
    await expect(buildingRows(page).first()).toBeVisible({ timeout: 120_000 });
    await page.getByRole("button", { name: "Add Building", exact: true }).first()
      .click();
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

    // 3. Create View filters the building by provenance: present under Investor
    //    (the profile role), absent under User (the import template it was added
    //    with) — so provenance came from the profile, not the template.
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.getByRole("button", { name: /create view/i }).click();
    const view = page.getByRole("dialog");
    await expect(view).toBeVisible({ timeout: 30_000 });
    const option = page.getByRole("option", { name: new RegExp(ADDR) });

    await view.getByLabel("Role").click();
    await page.getByRole("option", { name: "Investor", exact: true }).click();
    await view.getByLabel("Select Buildings").click();
    await expect(option).toBeVisible({ timeout: 30_000 });
    await page.keyboard.press("Escape");

    await view.getByLabel("Role").click();
    await page.getByRole("option", { name: "User", exact: true }).click();
    await view.getByLabel("Select Buildings").click();
    await expect(option).toHaveCount(0);
    await page.keyboard.press("Escape");
    await view.getByRole("button", { name: /cancel/i }).click();

    // 4. Clean up the building.
    await page.getByRole("tab", { name: "Manage" }).click();
    const row = page.locator("li", { hasText: ADDR }).first();
    await expect(row).toBeVisible({ timeout: 30_000 });
    await row.getByRole("button", { name: "Delete building" }).click();
    await expect(page.getByText("Building deleted").first())
      .toBeVisible({ timeout: 90_000 });
  });
});
