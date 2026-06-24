import { expect, type Page, test } from "@playwright/test";
import { metricT, t } from "../helpers/i18n.ts";
import { account, hasAccount, login } from "../helpers/login.ts";
import { addBuilding, openObservationsView } from "../helpers/manage.ts";
import { newCapturedPage } from "../helpers/consoleLog.ts";
import { assertCleanStart, verifyAndReset } from "../helpers/cleanSlate.ts";
import { confirmDialog } from "../helpers/confirm.ts";
import { T } from "../helpers/timeouts.ts";

/**
 * Building-less observations — create an energy observation WITHOUT a building, then
 * bind it to a building later. With no buildings yet, "Add observation" writes a
 * building-less observation (the picker is hidden), which shows under a "Without a
 * building" section in the List; once a building exists, "Link to a building" binds it
 * in place (the observation IRI is stable) and it moves under that building. Binding is
 * OPTIONAL: even with buildings present the create picker defaults to UNBOUND, so an
 * unbound series is always creatable. Self-cleaning; Alice (account A).
 *
 *   deno task e2e:local test/e2e/tasks/buildingless-observations.spec.ts
 */

const ADDR = "Buildingless Obs E2E Strasse 1";
const ACC = account("A");

test.describe.configure({ mode: "serial" });

test.describe("building-less observations", () => {
  test.skip(
    !hasAccount(ACC),
    `Set WEBID_A_USERNAME / WEBID_A_PASSWORD (a throwaway Solid Pod) to run the buildingless-observations e2e.`,
  );

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(T.setup);
    page = await newCapturedPage(browser, "buildingless-observations");
    page.on("dialog", (d) => d.accept().catch(() => {}));
    await login(page, ACC);
    await assertCleanStart(page);
  });

  test.afterAll(async () => {
    await verifyAndReset(page, "buildingless-observations");
    await page.close();
  });

  test("create a building-less observation, then delete it", async () => {
    test.setTimeout(T.testSolo);

    // Create one (no buildings → building-less by default).
    await page.getByRole("tab", { name: t("navObservations") }).click();
    await page.getByRole("button", { name: t("eyAddObservation") }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("spinbutton", { name: t("lblYear"), exact: true })
      .fill("2019");
    await dialog.getByRole("spinbutton", { name: metricT("electricityConsumption") })
      .fill("3000");
    await dialog.getByRole("button", { name: t("btnSave"), exact: true }).click();
    await expect(page.getByText(t("energySaved")).first())
      .toBeVisible({ timeout: T.action });
    await dialog.getByRole("button", { name: t("btnClose"), exact: true }).click();
    await expect(dialog).toBeHidden({ timeout: T.action });

    // It shows under "Without a building"; its trash action deletes it (own data,
    // removable with no building involved). The loose section then disappears.
    await openObservationsView(page, "list");
    await expect(page.getByRole("heading", { name: t("obsWithoutBuilding") }))
      .toBeVisible({ timeout: T.action });
    await page.getByRole("button", { name: t("btnDelete") }).first().click();
    await confirmDialog(page, "Delete");
    await expect(page.getByRole("heading", { name: t("obsWithoutBuilding") }))
      .toHaveCount(0);
  });

  test("create without a building, then link it to one", async () => {
    test.setTimeout(T.testSolo);

    // 1. With no buildings yet, "Add observation" creates a building-less observation:
    //    the dialog shows the building-less hint (no picker) and saves an unbound year.
    await page.getByRole("tab", { name: t("navObservations") }).click();
    await page.getByRole("button", { name: t("eyAddObservation") }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText(t("eyBuildinglessHint")))
      .toBeVisible({ timeout: T.action });
    await dialog.getByRole("spinbutton", { name: t("lblYear"), exact: true })
      .fill("2024");
    await dialog.getByRole("spinbutton", { name: metricT("electricityConsumption") })
      .fill("5000");
    await dialog.getByRole("button", { name: t("btnSave"), exact: true }).click();
    await expect(page.getByText(t("energySaved")).first())
      .toBeVisible({ timeout: T.action });
    await dialog.getByRole("button", { name: t("btnClose"), exact: true }).click();
    await expect(dialog).toBeHidden({ timeout: T.action });

    // 2. It appears under "Without a building" in the List (no building → loose row).
    await openObservationsView(page, "list");
    await expect(page.getByRole("heading", { name: t("obsWithoutBuilding") }))
      .toBeVisible({ timeout: T.action });
    const looseRow = page.locator("li", { hasText: "2024" }).first();
    await expect(looseRow).toBeVisible({ timeout: T.action });

    // 2b. The List view is URL-addressable: a fresh load of `?view=list` restores the
    //     List and the loose observation (no building needed to reach it).
    await page.goto("/observations?view=list");
    await expect(page).toHaveURL(/view=list/, { timeout: T.action });
    await expect(page.getByRole("heading", { name: t("obsWithoutBuilding") }))
      .toBeVisible({ timeout: T.action });

    // 3. Add a building, then link the loose observation to it.
    await addBuilding(page, ADDR);
    await openObservationsView(page, "list");
    // The loose row now offers "Link to a building" (a building exists to bind to).
    await page.getByRole("button", { name: t("obsLinkToBuilding") }).click();
    const linkDialog = page.getByRole("dialog");
    await linkDialog.getByLabel(t("eyBuildingLabel")).fill(ADDR);
    await page.getByRole("option", { name: new RegExp(ADDR) }).click();
    await linkDialog.getByRole("button", { name: t("obsLinkToBuilding") }).click();
    await expect(linkDialog).toBeHidden({ timeout: T.action });

    // 4. The observation is now under the building (a building row appears) and the
    //    loose "Without a building" section is gone.
    await expect(async () => {
      await openObservationsView(page, "list");
      await expect(
        page.locator("li[data-building-id]", { hasText: ADDR }).first(),
      ).toBeVisible({ timeout: T.quick });
    }).toPass({ timeout: T.poll });
    await expect(page.getByRole("heading", { name: t("obsWithoutBuilding") }))
      .toHaveCount(0);
  });

  test("with a building present, Add observation still defaults to unbound (binding optional)", async () => {
    test.setTimeout(T.testSolo);

    // A building exists now (from the previous test). The finder's "Add observation"
    // still defaults to UNBOUND — the picker is present but NOT pre-selected, so binding
    // is optional. Create a building-less series without touching it.
    await page.getByRole("tab", { name: t("navObservations") }).click();
    await page.getByRole("button", { name: t("eyAddObservation") }).click();
    const dialog = page.getByRole("dialog");
    // The optional building picker IS shown (a building exists to bind to) ...
    await expect(dialog.getByLabel(t("eyBuildingLabel")))
      .toBeVisible({ timeout: T.action });
    // ... but nothing is bound by default → the building-less hint shows.
    await expect(dialog.getByText(t("eyBuildinglessHint")))
      .toBeVisible({ timeout: T.action });

    // Save WITHOUT binding (leave the picker unbound).
    await dialog.getByRole("spinbutton", { name: t("lblYear"), exact: true })
      .fill("2017");
    await dialog.getByRole("spinbutton", { name: metricT("electricityConsumption") })
      .fill("4000");
    await dialog.getByRole("button", { name: t("btnSave"), exact: true }).click();
    await expect(page.getByText(t("energySaved")).first())
      .toBeVisible({ timeout: T.action });
    await dialog.getByRole("button", { name: t("btnClose"), exact: true }).click();
    await expect(dialog).toBeHidden({ timeout: T.action });

    // The new series lands under "Without a building" — it stayed unbound despite a
    // building existing (binding is optional, not forced). verifyAndReset cleans up.
    await openObservationsView(page, "list");
    await expect(page.getByRole("heading", { name: t("obsWithoutBuilding") }))
      .toBeVisible({ timeout: T.action });
    await expect(page.locator("li", { hasText: "2017" }).first())
      .toBeVisible({ timeout: T.action });
  });
});
