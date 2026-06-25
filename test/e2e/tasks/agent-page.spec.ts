import { expect, type Page, test } from "@playwright/test";
import { t } from "../helpers/i18n.ts";
import { account, hasAccount, login } from "../helpers/login.ts";
import {
  addBuilding,
  deleteBuildingRow,
  findOwnBuildingRow,
} from "../helpers/manage.ts";
import { newCapturedPage } from "../helpers/consoleLog.ts";
import { assertCleanStart, verifyAndReset } from "../helpers/cleanSlate.ts";
import { T } from "../helpers/timeouts.ts";
import { agentRoute } from "../../../src/routes.ts";

/**
 * Redesign e2e — the agent (person/org) detail page (`/agent?uri=<webId>`), rebuilt to
 * the building-page master-detail pattern (header + Profile + "Appears in"
 * sections; the agent's own profile is someone else's WebID, so those are
 * read-only). Seeds a building whose operator is a WebID, opens that agent's page,
 * and asserts the rebuilt sections render: the agent name (the WebID fragment, since
 * the profile is unreachable), the WebID row, and the "Appears in" list linking back
 * to the building. Also covers the local annotations the user CAN edit (stored name,
 * person/organisation kind, org fields incl. an uploaded logo, the "works for" edge).
 * Self-cleaning.
 *
 *   # tier 3 (local CSS, no creds):
 *   deno task e2e:local test/e2e/tasks/agent-page.spec.ts
 *
 * Runs against Alice (account A); skipped when account env vars are absent.
 */
const ACC = account("A");
const ADDR = "SavedAgent Page E2E Strasse 1";
const OP_WEBID = "https://contact-page-e2e.example/profile/card#OpAgent";
const OP_FRAGMENT = "OpAgent"; // the agent page shows the IRI fragment as the name

test.describe.configure({ mode: "serial" });

test.describe("redesign: agent page", () => {
  test.skip(
    !hasAccount(ACC),
    `Set WEBID_A_USERNAME / WEBID_A_PASSWORD (a throwaway Solid Pod) to run the agent-page e2e.`,
  );

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(T.setup);
    page = await newCapturedPage(browser, "agent-page");
    page.on("dialog", (d) => d.accept().catch(() => {})); // delete-building confirm
    await login(page, ACC);
    await assertCleanStart(page);
  });

  test.afterAll(async () => {
    await verifyAndReset(page, "agent-page");
    await page.close();
  });

  test("shows the agent identity, WebID, and where it appears", async () => {
    test.setTimeout(T.testSolo);

    // A building whose operator is a WebID makes that agent an agent-page subject.
    // Resolve the row via the fresh-read retry helper (a just-written building can lag
    // the container listing, and refetchOnMount:false means only a full goto re-reads).
    await addBuilding(page, ADDR, { operatedBy: OP_WEBID });
    const { id } = await findOwnBuildingRow(page, ADDR);

    // Open the operator's agent page (the same target AgentLabel links to).
    await page.goto(agentRoute(OP_WEBID));

    // Header identity: the WebID fragment stands in for the unreachable profile.
    await expect(page.getByRole("heading", { name: OP_FRAGMENT }))
      .toBeVisible({ timeout: T.action });
    // Profile section: the WebID row (rendered as an external link).
    await expect(page.getByText(OP_WEBID).first()).toBeVisible();
    // "Appears in": the seeded building, linking back to its building page.
    await expect(page.getByText(t("secAppearsIn"))).toBeVisible({ timeout: T.action });
    const buildingLink = page.getByRole("link", { name: /SavedAgent Page E2E/ });
    await expect(buildingLink).toBeVisible({ timeout: T.action });
    await buildingLink.click();
    await expect(page).toHaveURL(/\/building\?/, { timeout: T.action });

    // Back returns to the AGENT we came from (the trail carried in history state),
    // not the Buildings finder — the building was reached by following the agent's
    // operatedBy edge. This is the back-consistency the navigation trail guarantees.
    await page.getByRole("link", { name: /Back/ }).click();
    await expect(page).toHaveURL(/\/agent\?/, { timeout: T.action });
    await expect(page.getByRole("heading", { name: OP_FRAGMENT }))
      .toBeVisible({ timeout: T.action });

    // Cleanup: delete the throwaway building from the Buildings list (fresh-read
    // retry re-opens the List and waits for the row before deleting).
    await findOwnBuildingRow(page, ADDR);
    await deleteBuildingRow(page, id);
  });

  test("add a contact, then edit its stored name inline", async () => {
    test.setTimeout(T.testSolo);
    const EDIT_WEBID = "https://contact-edit-e2e.example/profile/card#Editable";
    const FRAGMENT = "Editable"; // the resolved name is the WebID fragment
    const NEW_NAME = "My Renamed SavedAgent";

    // Any agent's agent page offers "Add to agents"; the name is the WebID fragment
    // until a profile resolves.
    await page.goto(agentRoute(EDIT_WEBID));
    await expect(page.getByRole("heading", { name: FRAGMENT }))
      .toBeVisible({ timeout: T.action });
    await page.getByRole("button", { name: t("agentAddToBook"), exact: true })
      .click();

    // Now a known contact → the inline [Edit] appears. Rename the stored label.
    const editBtn = page.getByRole("button", { name: t("btnEdit"), exact: true });
    await expect(editBtn).toBeVisible({ timeout: T.action });
    await editBtn.click();
    const nameField = page.getByLabel(t("agentName"), { exact: true });
    await expect(nameField).toBeVisible({ timeout: T.action });
    await nameField.fill(NEW_NAME);
    await page.getByRole("button", { name: t("btnSave"), exact: true }).click();

    // The header shows the user's label, persisted via the idempotent SaveAgent.
    await expect(page.getByRole("heading", { name: NEW_NAME }))
      .toBeVisible({ timeout: T.action });

    // Re-open → the renamed label round-trips (read back from the contacts log).
    await page.goto("/");
    await page.goto(agentRoute(EDIT_WEBID));
    await expect(page.getByRole("heading", { name: NEW_NAME }))
      .toBeVisible({ timeout: T.action });
  });

  test("classify a contact as an organisation and edit its org fields", async () => {
    test.setTimeout(T.testSolo);
    const ORG_WEBID = "https://contact-org-e2e.example/profile/card#Acme";
    const ORG_NAME = "ACME Logistik GmbH";
    const ORG_HOMEPAGE = "https://acme-logistik.example/";

    // Add the agent (defaults to a person — the .example profile is unreachable, so no
    // rdf:type resolves), then open the inline editor.
    await page.goto(agentRoute(ORG_WEBID));
    await page.getByRole("button", { name: t("agentAddToBook"), exact: true })
      .click();
    const editBtn = page.getByRole("button", { name: t("btnEdit"), exact: true });
    await expect(editBtn).toBeVisible({ timeout: T.action });
    await editBtn.click();

    // Re-classify as an organisation → the name field becomes "Company name" and the
    // org-only homepage / cross-reference fields appear.
    await page.getByRole("button", { name: t("agentKindOrganisation"), exact: true })
      .click();
    await page.getByLabel(t("lblCompanyName"), { exact: true }).fill(ORG_NAME);
    await page.getByLabel(t("lblHomepageUri"), { exact: true }).fill(ORG_HOMEPAGE);

    // Upload a logo via the shared org editor (same component as the Organisation
    // page). A 1×1 PNG is enough; the picker shows an immediate object-URL preview.
    // Persistence (vcard:logo + public ACL) is covered by the SaveAgent unit test.
    const PNG_1x1 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC";
    await page.locator('input[type="file"]').setInputFiles({
      name: "acme-logo.png",
      mimeType: "image/png",
      buffer: Buffer.from(PNG_1x1, "base64"),
    });
    await expect(page.locator('img[src^="blob:"]')).toBeVisible({ timeout: T.action });

    await page.getByRole("button", { name: t("btnSave"), exact: true }).click();

    // The org view: the company name as the heading + the curated homepage row.
    await expect(page.getByRole("heading", { name: ORG_NAME }))
      .toBeVisible({ timeout: T.action });
    await expect(page.getByText(ORG_HOMEPAGE).first()).toBeVisible();

    // Re-open → kind + name + homepage round-trip from the local record in agents.ttl.
    await page.goto("/");
    await page.goto(agentRoute(ORG_WEBID));
    await expect(page.getByRole("heading", { name: ORG_NAME }))
      .toBeVisible({ timeout: T.action });
    await expect(page.getByText(ORG_HOMEPAGE).first()).toBeVisible();
    // It stayed an organisation: re-editing opens with the org-only fields present.
    await page.getByRole("button", { name: t("btnEdit"), exact: true }).click();
    await expect(page.getByLabel(t("lblHomepageUri"), { exact: true }))
      .toBeVisible({ timeout: T.action });
  });

  test("link a person contact to an org contact via a local 'works for' edge", async () => {
    test.setTimeout(T.testSolo);
    const EMP_ORG_WEBID = "https://works-for-org-e2e.example/profile/card#Globex";
    const EMP_ORG_NAME = "Globex Spedition";
    const PERSON_WEBID = "https://works-for-person-e2e.example/profile/card#Pat";
    const PERSON_NAME = "Pat Person";

    // An org contact must exist first so the person's "works for" dropdown has a target.
    await page.goto(agentRoute(EMP_ORG_WEBID));
    await page.getByRole("button", { name: t("agentAddToBook"), exact: true })
      .click();
    await page.getByRole("button", { name: t("btnEdit"), exact: true }).click();
    await page.getByRole("button", { name: t("agentKindOrganisation"), exact: true })
      .click();
    await page.getByLabel(t("lblCompanyName"), { exact: true }).fill(EMP_ORG_NAME);
    await page.getByRole("button", { name: t("btnSave"), exact: true }).click();
    await expect(page.getByRole("heading", { name: EMP_ORG_NAME }))
      .toBeVisible({ timeout: T.action });

    // Add the person, then edit → pick the org in the "Works for" dropdown.
    await page.goto(agentRoute(PERSON_WEBID));
    await page.getByRole("button", { name: t("agentAddToBook"), exact: true })
      .click();
    await page.getByRole("button", { name: t("btnEdit"), exact: true }).click();
    await page.getByLabel(t("agentName"), { exact: true }).fill(PERSON_NAME);
    // Open the MUI select and choose the org by its name.
    await page.getByLabel(t("agentWorksFor"), { exact: true }).click();
    await page.getByRole("option", { name: EMP_ORG_NAME }).click();
    await page.getByRole("button", { name: t("btnSave"), exact: true }).click();

    // Read view: a "Works for" row links to the org's agent page.
    const worksForLink = page.getByRole("link", { name: EMP_ORG_NAME });
    await expect(worksForLink).toBeVisible({ timeout: T.action });

    // Round-trips from the local record, and the link navigates to the org contact.
    await page.goto("/");
    await page.goto(agentRoute(PERSON_WEBID));
    await expect(page.getByRole("heading", { name: PERSON_NAME }))
      .toBeVisible({ timeout: T.action });
    await page.getByRole("link", { name: EMP_ORG_NAME }).click();
    await expect(page).toHaveURL(/\/agent\?/, { timeout: T.action });
    await expect(page.getByRole("heading", { name: EMP_ORG_NAME }))
      .toBeVisible({ timeout: T.action });
  });
});
