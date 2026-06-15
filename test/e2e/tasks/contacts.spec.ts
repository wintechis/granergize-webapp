import { expect, type Page, test } from "@playwright/test";
import { account, hasAccount, login } from "../helpers/login.ts";
import { confirmDialog } from "../helpers/confirm.ts";
import { addBuilding, buildingRows, openBuildingsList } from "../helpers/manage.ts";
import { newCapturedPage } from "../helpers/consoleLog.ts";
import { assertCleanStart, verifyAndReset } from "../helpers/cleanSlate.ts";
import { T } from "../helpers/timeouts.ts";

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
    test.setTimeout(T.setup); // login (IdP + consent) can be slow / retried
    page = await newCapturedPage(browser, "contacts");
    page.on("dialog", (d) => d.accept().catch(() => {})); // delete-building confirm
    await login(page, ACC);
    await assertCleanStart(page);
  });

  test.afterAll(async () => {
    // Best-effort teardown of the throwaway building (the local CSS is wiped per
    // spec, and the e2e collection is throwaway, so a substrate hiccup here must
    // not fail the verified feature).
    // Bounded well under Playwright's 30s afterAll-hook budget so a slow/dead
    // substrate can't blow the hook (the building is throwaway either way).
    try {
      await openBuildingsList(page);
      const row = buildingRows(page).filter({ hasText: ADDR }).first();
      if (await row.count()) {
        await row.getByRole("button", { name: "Delete building" })
          .click({ timeout: T.quick });
        await confirmDialog(page, "Delete");
        await expect(row).toHaveCount(0, { timeout: T.quick });
      }
    } catch { /* leave it — throwaway collection */ }
    await verifyAndReset(page, "contacts");
    await page.close();
  });

  test("a contact can be added by WebID and removed", async () => {
    test.setTimeout(T.testSolo);
    await page.getByRole("tab", { name: "Contacts" }).click();

    await page.getByLabel("WebID", { exact: true }).fill(CONTACT);
    await page.getByRole("button", { name: "Add contact" }).click();
    await expect(page.getByText(/contact added/i)).toBeVisible({ timeout: T.action });

    const row = contactsList(page).locator("li", { hasText: "DirectCarol" });
    await expect(row).toBeVisible({ timeout: T.action });

    await row.getByRole("button", { name: "Remove contact" }).click();
    await expect(row).toHaveCount(0, { timeout: T.action });
  });

  test("a building's operatedBy WebID is auto-remembered as a contact", async () => {
    test.setTimeout(T.testSolo);

    // Saving a building that carries an operatedBy WebID fires
    // rememberBuildingAgents (fire-and-forget) on the write — set it at creation
    // via the Add dialog (the per-row Edit dialog is gone; master-data edits live
    // on the building page now, and the create path remembers agents too).
    await addBuilding(page, ADDR, { operatedBy: OPERATOR });
    const row = buildingRows(page).filter({ hasText: ADDR }).first();
    await expect(row).toBeVisible({ timeout: T.action });

    // The operator shows up in the Contacts finder (auto-remember is a fire-and-
    // forget resolve+write, so poll by re-opening the finder until it lands).
    await expect(async () => {
      await page.getByRole("tab", { name: "Buildings" }).click();
      await page.getByRole("tab", { name: "Contacts" }).click();
      await expect(contactsList(page).locator("li", { hasText: "OperatorBob" }))
        .toBeVisible({ timeout: T.quick });
    }).toPass({ timeout: T.poll });

    // Remove the auto-remembered contact (the building is torn down in afterAll).
    await contactsList(page).locator("li", { hasText: "OperatorBob" })
      .getByRole("button", { name: "Remove contact" }).click();
    await expect(contactsList(page).locator("li", { hasText: "OperatorBob" }))
      .toHaveCount(0, { timeout: T.action });
  });
});
