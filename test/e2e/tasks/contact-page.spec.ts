import { expect, type Page, test } from "@playwright/test";
import { account, hasAccount, login } from "../helpers/login.ts";
import {
  addBuilding,
  buildingIdOf,
  deleteBuildingRow,
  openBuildingsList,
} from "../helpers/manage.ts";
import { newCapturedPage } from "../helpers/consoleLog.ts";
import { assertCleanStart, verifyAndReset } from "../helpers/cleanSlate.ts";
import { T } from "../helpers/timeouts.ts";
import { contactRoute } from "../../../src/routes.ts";

/**
 * Redesign e2e — the contact (agent) detail page (`/contact/:webId`), rebuilt to
 * the building-page master-detail pattern (header + Profile + "Appears in"
 * sections, read-only — a contact is someone else's WebID). Seeds a building
 * whose operator is a WebID, opens that agent's contact page, and asserts the
 * rebuilt sections render: the agent name (the WebID fragment, since the profile
 * is unreachable), the WebID row, and the "Appears in" list linking back to the
 * building. Self-cleaning.
 *
 *   # tier 3 (local CSS, no creds):
 *   deno task e2e:local test/e2e/tasks/contact-page.spec.ts
 *
 * Runs against Alice (account A); skipped when account env vars are absent.
 */
const ACC = account("A");
const ADDR = "Contact Page E2E Strasse 1";
const OP_WEBID = "https://contact-page-e2e.example/profile/card#OpAgent";
const OP_FRAGMENT = "OpAgent"; // the contact page shows the IRI fragment as the name

test.describe.configure({ mode: "serial" });

test.describe("redesign: contact page", () => {
  test.skip(
    !hasAccount(ACC),
    `Set WEBID_A_USERNAME / WEBID_A_PASSWORD (a throwaway Solid Pod) to run the contact-page e2e.`,
  );

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(T.setup);
    page = await newCapturedPage(browser, "contact-page");
    page.on("dialog", (d) => d.accept().catch(() => {})); // delete-building confirm
    await login(page, ACC);
    await assertCleanStart(page);
  });

  test.afterAll(async () => {
    await verifyAndReset(page, "contact-page");
    await page.close();
  });

  test("shows the agent identity, WebID, and where it appears", async () => {
    test.setTimeout(T.testSolo);

    // A building whose operator is a WebID makes that agent a contact-page subject.
    await addBuilding(page, ADDR, { operatedBy: OP_WEBID });
    const row = page.locator("li[data-building-id]", { hasText: ADDR }).first();
    await expect(row).toBeVisible({ timeout: T.action });
    const id = await buildingIdOf(row);
    if (!id) throw new Error("contact-page: missing building id");

    // Open the operator's contact page (the same target AgentLabel links to).
    await page.goto(contactRoute(OP_WEBID));

    // Header identity: the WebID fragment stands in for the unreachable profile.
    await expect(page.getByRole("heading", { name: OP_FRAGMENT }))
      .toBeVisible({ timeout: T.action });
    // Profile section: the WebID row (rendered as an external link).
    await expect(page.getByText(OP_WEBID).first()).toBeVisible();
    // "Appears in": the seeded building, linking back to its building page.
    await expect(page.getByText("Appears in")).toBeVisible({ timeout: T.action });
    const buildingLink = page.getByRole("link", { name: /Contact Page E2E/ });
    await expect(buildingLink).toBeVisible({ timeout: T.action });
    await buildingLink.click();
    await expect(page).toHaveURL(/\/building\?/, { timeout: T.action });

    // Cleanup: delete the throwaway building from the Buildings list.
    await page.goto("/");
    await openBuildingsList(page);
    await deleteBuildingRow(page, id);
  });
});
