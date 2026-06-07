import { expect, type Page, test } from "@playwright/test";
import { account, hasAccount, login } from "../helpers/login.ts";
import { addBuilding, buildingRows } from "../helpers/manage.ts";

/**
 * Agent management e2e — the contacts address book + auto-remember. MUI page
 * render isn't unit-testable under Deno, so this covers the UI half:
 *  1. add a contact by WebID on Connect → it lists (via <AgentLabel>) → remove it;
 *  2. a building saved with an `operatedBy` WebID is auto-remembered as a contact.
 *
 * WebIDs use a distinctive `#fragment` on an unresolvable host: <AgentLabel> shows
 * the fragment as the name immediately (resolution falls back to it for an
 * unreachable profile, per the loading policy), so assertions don't depend on any
 * profile being readable. Self-cleaning — removes its contacts and its building.
 *
 *   # tier 3 (local CSS, no creds):
 *   deno task e2e:local test/e2e/tasks/contacts.spec.ts
 *   # tier 4 (real Pods):
 *   source test/.env.e2e.local && deno task e2e:remote:spec test/e2e/tasks/contacts.spec.ts
 *
 * Runs against Alice (account A). Skipped when account env vars are absent.
 */

const ACC = account("A");
const ADDR = "Contacts E2E Strasse 1";
const CONTACT = "https://contacts-e2e.example/profile/card#DirectCarol";
const OPERATOR = "https://contacts-e2e.example/profile/card#OperatorBob";

/** The aria-labelled contacts list on Connect (added for this disambiguation). */
const contactsList = (page: Page) => page.getByRole("list", { name: "Contacts" });

test.describe.configure({ mode: "serial" });

test.describe("contacts address book + auto-remember", () => {
  test.skip(
    !hasAccount(ACC),
    `Set E2E_USERNAME_A / E2E_PASSWORD_A (a throwaway Solid Pod) to run the contacts e2e.`,
  );

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(240_000); // login (IdP + consent) can be slow / retried
    page = await browser.newPage();
    page.on("dialog", (d) => d.accept().catch(() => {})); // delete-building confirm
    await login(page, ACC);
  });

  test.afterAll(async () => {
    // Best-effort teardown of the throwaway building (the local CSS is wiped per
    // spec, and the e2e collection is throwaway, so a substrate hiccup here must
    // not fail the verified feature).
    // Bounded well under Playwright's 30s afterAll-hook budget so a slow/dead
    // substrate can't blow the hook (the building is throwaway either way).
    try {
      await page.getByRole("tab", { name: "Manage" }).click({ timeout: 8_000 });
      const row = buildingRows(page).filter({ hasText: ADDR }).first();
      if (await row.count()) {
        await row.getByRole("button", { name: "Delete building" })
          .click({ timeout: 8_000 });
        await expect(row).toHaveCount(0, { timeout: 12_000 });
      }
    } catch { /* leave it — throwaway collection */ }
    await page.close();
  });

  test("a contact can be added by WebID and removed", async () => {
    test.setTimeout(120_000);
    await page.getByRole("tab", { name: "Connect" }).click();

    await page.getByLabel("WebID", { exact: true }).fill(CONTACT);
    await page.getByRole("button", { name: "Add contact" }).click();
    await expect(page.getByText(/contact added/i)).toBeVisible({ timeout: 30_000 });

    const row = contactsList(page).locator("li", { hasText: "DirectCarol" });
    await expect(row).toBeVisible({ timeout: 30_000 });

    await row.getByRole("button", { name: "Remove contact" }).click();
    await expect(row).toHaveCount(0, { timeout: 30_000 });
  });

  test("a building's operatedBy WebID is auto-remembered as a contact", async () => {
    test.setTimeout(180_000);

    // Add a building, then set its operator on the Edit dialog and save — the
    // save fires rememberAgent(operatedBy) fire-and-forget.
    await addBuilding(page, ADDR);
    const row = buildingRows(page).filter({ hasText: ADDR }).first();
    await expect(row).toBeVisible({ timeout: 60_000 });

    await row.getByRole("button", { name: "Edit building" }).click();
    const dialog = page.getByRole("dialog");
    const operatedBy = dialog.getByLabel("Operated by (WebID)");
    await expect(operatedBy).toBeVisible({ timeout: 15_000 });
    // <AgentField> is a MUI Autocomplete — type with real keystrokes (fill() can
    // be dropped by the controlled combobox), then dismiss the suggestion popup.
    await operatedBy.click();
    await operatedBy.pressSequentially(OPERATOR);
    await page.keyboard.press("Escape");
    await expect(operatedBy).toHaveValue(OPERATOR); // value stuck before saving
    await dialog.getByRole("button", { name: /save changes/i }).click();
    await expect(page.getByText(/building updated/i))
      .toBeVisible({ timeout: 60_000 });

    // The operator shows up in Contacts on Connect (auto-remember is a fire-and-
    // forget resolve+write, so poll by re-opening the tab until it lands).
    await expect(async () => {
      await page.getByRole("tab", { name: "Manage" }).click();
      await page.getByRole("tab", { name: "Connect" }).click();
      await expect(contactsList(page).locator("li", { hasText: "OperatorBob" }))
        .toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 90_000 });

    // Remove the auto-remembered contact (the building is torn down in afterAll).
    await contactsList(page).locator("li", { hasText: "OperatorBob" })
      .getByRole("button", { name: "Remove contact" }).click();
    await expect(contactsList(page).locator("li", { hasText: "OperatorBob" }))
      .toHaveCount(0, { timeout: 30_000 });
  });
});
