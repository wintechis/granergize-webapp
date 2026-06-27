import { expect, type Page, test } from "@playwright/test";
import { account, hasAccount, login } from "../helpers/login.ts";
import { metricT, t } from "../helpers/i18n.ts";
import { newCapturedPage } from "../helpers/consoleLog.ts";
import { assertCleanStart, verifyAndReset } from "../helpers/cleanSlate.ts";
import { buildingIdOf, openBuildingsList } from "../helpers/manage.ts";
import { openPalette, paletteInput } from "../helpers/palette.ts";
import { ACTION_PARAM, observationRoute, withAction } from "../../../src/routes.ts";
import { T } from "../helpers/timeouts.ts";

/**
 * CT "Add a building and enter its 2024 energy", driven THROUGH the ⌘K command
 * palette (plan-palette §"e2e — anchored in competency tasks"), not the finder's
 * bespoke "Add Building" button. Two palette-native steps:
 *
 *   1. In the shell, ⌘K → "Add building" → the palette routes to
 *      `/buildings?action=add`, which auto-opens the AddBuilding dialog; fill +
 *      submit the generic building form.
 *   2. On the new building's observation page, the palette's "Enter energy…" rich
 *      verb routes to `/observation?...&action=enter-energy`, which auto-opens the
 *      EnergyYearEditor; enter the 2024 figure and save.
 *
 * KNOWN RESIDUAL (plan-palette §"Open questions"): the palette does NOT auto-chain
 * add → enter-energy — it acts on the *currently-focused* object, and a just-added
 * building isn't auto-focused, so the spec navigates between the two palette-native
 * steps itself (resolve the new building's id from the Buildings list, route to its
 * observation page). Closing that gap needs a focus-handoff seam, deliberately
 * deferred. Step 2 also reflects that `CommandPalette` is mounted only in the shell
 * (AppShell), not on the shell-less `/observation` detail page — so the "Enter
 * energy…" verb is exercised via the SAME `?action=` URL the palette's `run()`
 * builds (`withAction(observationRoute(id), "enter-energy")`), the palette's routing
 * contract for a focused object's rich verb.
 *
 *   # tier 3 (local CSS, no creds):
 *   deno task e2e:local test/e2e/solo/palette-add-and-energy.spec.ts
 *
 * Runs against Alice (account A). Self-cleaning (verifyAndReset wipes the
 * collection). Skipped when account env vars are absent.
 */

const ACC = account("A");
const ADDR = "Palette Add Energy E2E Strasse 1";
const YEAR = "2024";
const ELECTRICITY = "54321";

test.describe.configure({ mode: "serial" });

test.describe("palette: add building + enter energy", () => {
  test.skip(
    !hasAccount(ACC),
    `Set WEBID_A_USERNAME / WEBID_A_PASSWORD (a throwaway Solid Pod) to run the palette add+energy e2e.`,
  );

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(T.setup);
    page = await newCapturedPage(browser, "palette-add-and-energy");
    page.on("dialog", (d) => d.accept().catch(() => {})); // delete confirms
    await login(page, ACC);
    await assertCleanStart(page);
  });

  test.afterAll(async () => {
    test.setTimeout(T.afterAll);
    await verifyAndReset(page, "palette-add-and-energy");
    await page.close();
  });

  test("⌘K → Add building, then ⌘K-route → Enter energy for 2024", async () => {
    test.setTimeout(T.testSolo);

    // ── Step 1: add the building through the palette (not the Add button) ──
    // Land in the shell (the only place the palette is mounted); the home route
    // redirects to the Buildings finder.
    await page.goto("/");
    await openBuildingsList(page);

    // Sanity: the palette opens and offers the always-applicable create verb in
    // the shell (no object focused → navigation + collection-create commands).
    await openPalette(page);
    await expect(page.getByText(t("paletteGroupActions"))).toBeVisible({
      timeout: T.visible,
    });
    await paletteInput(page).fill(t("addBuildingBtn"));
    const addCmd = page.getByRole("button", { name: t("addBuildingBtn") }).first();
    await expect(addCmd).toBeVisible({ timeout: T.visible });
    await addCmd.click();
    await expect(paletteInput(page)).toBeHidden({ timeout: T.action });

    // The palette routed to /buildings?action=add, which auto-opens the dialog.
    await expect(page).toHaveURL(new RegExp(`${ACTION_PARAM}=add`));
    const add = page.getByRole("dialog");
    await expect(add.getByLabel(t("lblStreetAddress"))).toBeVisible({
      timeout: T.visible,
    });
    await add.getByLabel(t("lblStreetAddress")).fill(ADDR);
    await add.getByLabel(t("lblLocality")).fill("Nürnberg");
    await add.getByLabel(t("lblPostalCode")).fill("90451");
    await add.getByLabel(t("lblRegion")).fill("Bayern");
    await add.getByLabel(t("lblLatitude")).fill("49.45");
    await add.getByLabel(t("lblLongitude")).fill("11.08");
    await add.getByRole("button", { name: t("addBuildingBtn") }).click();
    await expect(page.getByText(t("addBuildingAddedCount", { count: 1 }))).toBeVisible({
      timeout: T.action,
    });

    // ── Bridge the residual: the palette does not auto-focus the new building,
    // so resolve its id and navigate to its observation page ourselves. ──
    await page.goto("/");
    await openBuildingsList(page);
    const row = page.locator("li[data-building-id]", { hasText: ADDR }).first();
    await expect(row).toBeVisible({ timeout: T.action });
    const id = await buildingIdOf(row);
    if (!id) throw new Error("palette add+energy: missing building id");

    // ── Step 2: enter energy through the palette's rich-verb routing contract ──
    // The "Enter energy…" verb is a focused-object rich verb (surface
    // EnergyYearEditor on /observation). The palette routes it to
    // withAction(observationRoute(id), "enter-energy"); since CommandPalette isn't
    // mounted on the shell-less observation page, drive that exact route here.
    await page.goto(withAction(observationRoute(id), "enter-energy"));
    // The editor is inline on the observation page now (no dialog) — its year input
    // appearing means it auto-opened from `?action=enter-energy`. The building is named
    // by the observation page's own header (h5).
    await expect(page.getByRole("spinbutton", { name: t("lblYear"), exact: true }))
      .toBeVisible({ timeout: T.visible });
    await expect(page.getByRole("heading", { level: 5 }).first())
      .toContainText(ADDR, { timeout: T.visible });

    await page.getByRole("spinbutton", { name: t("lblYear"), exact: true })
      .fill(YEAR);
    await page.getByRole("spinbutton", { name: metricT("electricityConsumption") })
      .fill(ELECTRICITY);
    await page.getByRole("button", { name: t("btnSave"), exact: true }).click();
    await expect(page.getByText(t("energySaved")).first()).toBeVisible({
      timeout: T.action,
    });

    // The saved year reads back into the editor's year table — proof the figure
    // landed (the editor stays open after save so the table reflects it).
    await expect(page.getByText(YEAR).first()).toBeVisible({
      timeout: T.action,
    });
    await page.getByRole("button", { name: t("btnClose"), exact: true })
      .filter({ hasText: t("btnClose") }).click();
    await expect(page.getByRole("spinbutton", { name: t("lblYear"), exact: true }))
      .toBeHidden({ timeout: T.action });
  });
});
