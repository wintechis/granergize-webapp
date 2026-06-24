import { expect, type Page, test } from "@playwright/test";
import { t } from "../helpers/i18n.ts";
import { account, hasAccount, login } from "../helpers/login.ts";
import { confirmDialog } from "../helpers/confirm.ts";
import { addBuilding, buildingRows, openBuildingsList } from "../helpers/manage.ts";
import { newCapturedPage } from "../helpers/consoleLog.ts";
import { assertCleanStart, verifyAndReset } from "../helpers/cleanSlate.ts";
import { T } from "../helpers/timeouts.ts";

/**
 * Agents finder e2e — the address book (saved tier) + auto-remember + the derived
 * REFERENCED tier. MUI page render isn't unit-testable under Deno, so this covers the
 * UI half:
 *  1. add an agent by WebID → it lists (via <AgentLabel>) → remove it;
 *  2. a building saved with an `operatedBy` WebID is auto-remembered (saved); removing
 *     the saved record leaves it in the finder as a REFERENCED agent (it still appears
 *     on the building) with a save-to-agents action.
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
const agentsList = (page: Page) => page.getByRole("list", { name: t("navAgents") });

test.describe.configure({ mode: "serial" });

test.describe("agents address book + auto-remember", () => {
  test.skip(
    !hasAccount(ACC),
    `Set WEBID_A_USERNAME / WEBID_A_PASSWORD (a throwaway Solid Pod) to run the contacts e2e.`,
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
        await row.getByRole("button", { name: t("buildingDeleteAria") })
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
    await page.getByRole("tab", { name: t("navAgents") }).click();

    await page.getByLabel("WebID", { exact: true }).fill(CONTACT);
    await page.getByRole("button", { name: t("agentAddAria") }).click();
    await expect(page.getByText(t("agentAdded"))).toBeVisible({ timeout: T.action });

    const row = agentsList(page).locator("li", { hasText: "DirectCarol" });
    await expect(row).toBeVisible({ timeout: T.action });

    await row.getByRole("button", { name: t("agentRemoveAria") }).click();
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
      await page.getByRole("tab", { name: t("navBuildings") }).click();
      await page.getByRole("tab", { name: t("navAgents") }).click();
      await expect(agentsList(page).locator("li", { hasText: "OperatorBob" }))
        .toBeVisible({ timeout: T.quick });
    }).toPass({ timeout: T.poll });

    // Auto-remember made it a SAVED agent (a remove action). Removing the saved
    // record does NOT hide it: the building still references it, so it falls back to
    // the REFERENCED tier — a "save to agents" action replaces the remove. (The
    // referenced tier surfaces a portfolio's operators even before they're saved.)
    const operatorRow = () =>
      agentsList(page).locator("li", { hasText: "OperatorBob" });
    await operatorRow().getByRole("button", { name: t("agentRemoveAria") }).click();
    await expect(operatorRow().getByRole("button", { name: t("agentSaveToBookAria") }))
      .toBeVisible({ timeout: T.action });
  });
});
