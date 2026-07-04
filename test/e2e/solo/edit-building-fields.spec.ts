import { t } from "../helpers/i18n.ts";
import { expect, type Page, test } from "@playwright/test";
import { account, hasAccount, login } from "../helpers/login.ts";
import {
  addBuilding,
  buildingIdOf,
  buildingRoute,
  deleteBuildingRow,
  openBuildingsList,
} from "../helpers/manage.ts";
import { newCapturedPage } from "../helpers/consoleLog.ts";
import { assertCleanStart, verifyAndReset } from "../helpers/cleanSlate.ts";
import { T } from "../helpers/timeouts.ts";

/**
 * Edit-building operating-costs + certifications e2e. Covers the Edit dialog's
 * Operating costs / Certifications sections (added so those investor master-data
 * fields are editable, not only importable): fill an operating-cost figure and a
 * certification, save, REOPEN the dialog and assert the values round-tripped
 * through Turtle. Self-cleaning — adds its own throwaway building and deletes it.
 *
 * The Operating-costs / Certifications sections are investor-specific, so the
 * Edit dialog only renders them when the building's provenance is `investor`.
 * Provenance is stamped from the org's company kind at add-time, so the test
 * sets the kind to Investor via the in-app Organisation form first.
 *
 *   # tier 3 (local CSS, no creds):
 *   deno task e2e:local test/e2e/solo/edit-building-fields.spec.ts
 *   # tier 4 (real Pods):
 *   source test/.env.e2e.local && deno task e2e:remote:spec test/e2e/solo/edit-building-fields.spec.ts
 *
 * Runs against Alice (account A). Skipped when account env vars are absent.
 */

const ADDR = "Edit Fields E2E Strasse 1";
const ACC = account("A");

test.describe.configure({ mode: "serial" });

test.describe("edit building operating costs + certifications", () => {
  test.skip(
    !hasAccount(ACC),
    `Set WEBID_A_USERNAME / WEBID_A_PASSWORD (a throwaway Solid Pod) to run the edit-fields e2e.`,
  );

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(T.setup); // login (IdP + consent) can be slow / retried
    page = await newCapturedPage(browser, "edit-building-fields");
    // "Delete building" confirms via window.confirm — accept automatically.
    page.on("dialog", (d) => d.accept().catch(() => {}));
    await login(page, ACC);
    await assertCleanStart(page);
    // The Edit dialog renders the Operating-costs / Certifications sections for every
    // building now (one generic form, no role gating), so no setup is needed.
  });

  test.afterAll(async () => {
    await verifyAndReset(page, "edit-building-fields");
    await page.close();
  });

  test("operating costs + a certification persist through an edit", async () => {
    test.setTimeout(T.testSolo);

    await addBuilding(page, ADDR);
    const listRow = page.locator("li[data-building-id]", { hasText: ADDR }).first();
    await expect(listRow).toBeVisible({ timeout: T.action });
    const id = await buildingIdOf(listRow);
    if (!id) throw new Error("edit-building-fields: missing building id");

    // Master-data editing is inline on the building page now (no per-row dialog).
    // Open the inline editor and confirm the investor sections are present (they
    // render for every building — one generic form, no role gating).
    await page.goto(buildingRoute("building", id));
    await page.getByRole("button", { name: t("btnEdit"), exact: true }).first().click();
    await expect(page.getByText(t("secOperatingCosts")))
      .toBeVisible({ timeout: T.visible });
    await expect(page.getByText(t("secCertifications"))).toBeVisible();

    // Fill an operating-cost figure and the first certification, then save.
    // The cert type is a select over the known systems (it mints an IRI local
    // name, so free text is rejected), not a text field.
    await page.getByLabel(t("lblOpcostInsurance"), { exact: true }).fill("1200");
    await page.getByLabel(t("lblCertType"), { exact: true }).first().click();
    await page.getByRole("option", { name: "LEED" }).click();
    await page.getByLabel(t("lblCertLevel"), { exact: true }).first().fill("Gold");
    await page.getByRole("button", { name: t("btnSave"), exact: true }).click();
    await expect(page.getByText(t("buildingUpdated")))
      .toBeVisible({ timeout: T.action });

    // Saving closes the editor → read view. Re-open it: the update invalidates +
    // refetches the building from the Pod, so the form now reflects the values
    // that round-tripped through its Turtle.
    await page.getByRole("button", { name: t("btnEdit"), exact: true }).first().click();
    await expect(page.getByLabel(t("lblOpcostInsurance"), { exact: true }))
      .toHaveValue("1200", { timeout: T.visible });
    await expect(page.getByLabel(t("lblCertType"), { exact: true }).first())
      .toHaveText("LEED");
    await expect(page.getByLabel(t("lblCertLevel"), { exact: true }).first())
      .toHaveValue("Gold");
    await page.getByRole("button", { name: t("btnCancel"), exact: true }).click();

    // Cleanup: delete the throwaway building from the Buildings list.
    await page.goto("/");
    await openBuildingsList(page);
    await deleteBuildingRow(page, id);
  });

  test("a PV unit is added on the building page (not at create) and persists", async () => {
    test.setTimeout(T.testSolo);
    const PV_ADDR = "Edit PV E2E Strasse 1";

    await addBuilding(page, PV_ADDR);
    const listRow = page.locator("li[data-building-id]", { hasText: PV_ADDR }).first();
    await expect(listRow).toBeVisible({ timeout: T.action });
    const id = await buildingIdOf(listRow);
    if (!id) throw new Error("edit-building-fields: missing PV building id");

    // Energy systems are managed on the building page now, NOT in the create form. A
    // freshly added building has none → the section shows its empty state + "Add system".
    await page.goto(buildingRoute("building", id));
    // The single button in the Energy systems section header (label flips Add → Edit).
    const sysBtn = page
      .getByRole("heading", { name: t("secEnergySystems"), exact: true })
      .locator("xpath=../..")
      .getByRole("button")
      .last(); // the header row's ACTION button (the dev-mode marker precedes it)
    await expect(page.getByText(t("energySystemsEmpty")))
      .toBeVisible({ timeout: T.visible });

    // Add a PV unit via the INLINE editor (no dialog now): it's a list editor, so
    // "Add PV plant" first, then fill the unit's capacity. The unit becomes a
    // `bldg:hasSystem` :PVSystem node.
    await sysBtn.click();
    const addPv = page.getByRole("button", { name: t("btnAddPv"), exact: true });
    await expect(addPv).toBeVisible({ timeout: T.visible });
    await addPv.click();
    await page.getByLabel(t("lblSystemCapacityKW"), { exact: true }).fill("500");
    await page.getByLabel(t("lblCommissioningYear"), { exact: true }).fill("2020");
    await page.getByRole("button", { name: t("btnSave"), exact: true }).click();
    await expect(page.getByText(t("buildingUpdated")))
      .toBeVisible({ timeout: T.action });

    // The section now renders the PV plant as a summary row (presence ⇒ has PV),
    // parsed back from the unit node — proving it persisted through Turtle.
    await expect(page.getByText(/500 kW, since 2020/))
      .toBeVisible({ timeout: T.visible });

    // Re-open (the button is now "Edit"): the value round-tripped into the inline editor.
    await sysBtn.click();
    await expect(page.getByLabel(t("lblSystemCapacityKW"), { exact: true }))
      .toHaveValue("500", { timeout: T.visible });
    await page.getByRole("button", { name: t("btnCancel"), exact: true }).click();

    await page.goto("/");
    await openBuildingsList(page);
    await deleteBuildingRow(page, id);
  });
});
