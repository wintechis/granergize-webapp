import { expect, type Page, test } from "@playwright/test";
import { account, hasAccount, login } from "../helpers/login.ts";
import { metricT, t, tPattern } from "../helpers/i18n.ts";
import { confirmDialog } from "../helpers/confirm.ts";
import {
  addEnergyYear,
  buildingRoute,
  openBuildingsList,
  openObservationsView,
} from "../helpers/manage.ts";
import { newCapturedPage } from "../helpers/consoleLog.ts";
import { assertCleanStart, verifyAndReset } from "../helpers/cleanSlate.ts";
import { T } from "../helpers/timeouts.ts";

/**
 * Energy per-year entry + planned/actual (Soll-Ist) e2e. Self-cleaning: it adds
 * its own throwaway building, writes a fixed year (2099) actual + planned
 * `cons:EnergyDataset` to it, proves the *actual* figure flows back through
 * `loadEnergy` into the energy view (with the Recharts SVG chart), then deletes
 * the building in afterAll — which removes its whole energy subtree, so nothing
 * leaks. A third test drives the map's Energy tab (AnnualEnergy), the only place
 * the Soll-Ist *comparison* renders, and asserts the entered planned figure
 * surfaces as the "(planned)" overlay beside actual. It selects the single map
 * marker, so it needs a pristine collection — the per-spec CSS reset (Tier 3) or
 * the per-run `granergize-e2e-<uuid>` collection (Tier 4). (The overlay's chart
 * legend is also unit-tested in `MetricBarChart.test.tsx`.) A fourth test guards
 * the incremental-edit path: re-opening a stored year pre-loads its figures, so
 * adding one metric later doesn't overwrite the earlier ones with nothing. A
 * fifth drives the dialog's read-back table — that a stored year is listed, its
 * Edit loads the figures back into the form, and it can be deleted from the table.
 *
 *   # tier 3 (local CSS, no creds):
 *   deno task e2e:local test/e2e/tasks/energy-entry.spec.ts
 *   # tier 4 (real Pods):
 *   source test/.env.e2e.local && deno task e2e:remote:spec test/e2e/tasks/energy-entry.spec.ts
 *
 * Runs against Alice (account A). Skipped
 * without creds.
 */

const YEAR = "2099"; // fixed far-future year; re-runs overwrite it (idempotent)
const EDIT_YEAR = "2097"; // a separate year for the incremental-edit test
const ADDR = "Energy Entry E2E Strasse 1"; // unique address for the building

const ACC = account("A"); // Alice -- solo specs use one account

test.describe.configure({ mode: "serial" });

test.describe("energy entry + Soll-Ist", () => {
  test.skip(
    !hasAccount(ACC),
    `Set WEBID_A_USERNAME / WEBID_A_PASSWORD (a throwaway Solid Pod) to run the energy-entry e2e.`,
  );

  let page: Page;
  let id = "";

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(T.setup);
    page = await newCapturedPage(browser, "energy-entry");
    // "Delete building" confirms via window.confirm — accept automatically.
    page.on("dialog", (d) => d.accept().catch(() => {}));
    await login(page, ACC);
    await assertCleanStart(page);

    // Add a throwaway building to write the year to (deleted in afterAll).
    await openBuildingsList(page);
    const addBtn = page.getByRole("button", { name: t("addBuildingBtn"), exact: true })
      .first();
    await expect(addBtn).toBeVisible({ timeout: T.action });
    await addBtn.click();
    const add = page.getByRole("dialog");
    await add.getByLabel(t("lblStreetAddress")).fill(ADDR);
    await add.getByLabel(t("lblLocality")).fill("Nürnberg");
    await add.getByLabel(t("lblPostalCode")).fill("90451");
    await add.getByLabel(t("lblRegion")).fill("Bayern");
    await add.getByLabel(t("lblLatitude")).fill("49.45");
    await add.getByLabel(t("lblLongitude")).fill("11.08");
    await add.getByRole("button", { name: t("addBuildingBtn") }).click();
    await expect(page.getByText(t("addBuildingAddedCount", { count: 1 })))
      .toBeVisible({ timeout: T.action });

    // Capture its (generated) id from the Manage row's data attribute.
    const row = page.locator("li", { hasText: ADDR }).first();
    await expect(row).toBeVisible({ timeout: T.action });
    id = (await row.getAttribute("data-building-id")) ?? "";
    expect(id, "the added building's id").toBeTruthy();
  });

  test.afterAll(async () => {
    // The delete below waits up to 90 s for its toast, so the default 30 s hook
    // budget is too tight — give it room, else a slow delete fails teardown even
    // though the test body passed.
    test.setTimeout(T.afterAll);
    // Delete the building → removes its energy subtree, so the year doesn't leak.
    try {
      if (!page.isClosed()) {
        // The last test left us on the standalone /energy/:id route (no app shell,
        // so no Manage tab) — return to the shell first, else the click below hangs
        // until the hook timeout. Mirrors building-details.spec.ts cleanup.
        await page.goto("/");
        await openBuildingsList(page);
        const row = page.locator("li", { hasText: ADDR }).first();
        if (await row.count()) {
          await row.getByRole("button", { name: t("buildingDeleteAria") }).click();
          await confirmDialog(page, "Delete");
          await expect(page.getByText(t("buildingDeleted")).first())
            .toBeVisible({ timeout: T.action });
        }
      }
    } catch {
      // best-effort cleanup; never fail teardown
    } finally {
      await verifyAndReset(page, "energy-entry");
      await page.close();
    }
  });

  test("enter both an actual and a planned figure for a year", async () => {
    test.setTimeout(T.testSolo);
    await addEnergyYear(page, ADDR, YEAR, "88888", "actual");
    await addEnergyYear(page, ADDR, YEAR, "70000", "planned"); // "Planned (Soll)"
  });

  test("the actual figure flows into the building's energy view", async () => {
    test.setTimeout(T.testSolo);
    // The consolidated annual table shows our electricity figure de-DE formatted
    // at the metric's own precision (electricity is 0-decimals → "88.888"), so
    // match the value decimals-agnostically.
    await page.goto(buildingRoute("observation", id));
    await expect(page.getByText(/88\.888/).first())
      .toBeVisible({ timeout: T.action });
    // The migrated chart is a Recharts SVG (not a canvas) — assert it draws.
    await expect(page.locator("svg.recharts-surface").first())
      .toBeVisible({ timeout: T.action });
  });

  // The Soll-Ist comparison (AnnualEnergy's multi-year view) now lives on the
  // building's standalone observation page (`/observation/:id`) — the map is a
  // pure finder, so the old map "Energy data" detail tab is gone.
  test("the planned (Soll) figure shows beside actual in the comparison", async () => {
    test.setTimeout(T.testSolo);
    await page.goto(buildingRoute("observation", id));
    // hasPlanned adds a "<metric> (planned)" series to the chart legend — its
    // presence proves the entered planned dataset flowed back into the comparison.
    await expect(page.getByText(/\(planned\)/).first())
      .toBeVisible({ timeout: T.action });
  });

  test("adding a metric to an existing year keeps the earlier figures", async () => {
    test.setTimeout(T.testSolo);
    // Regression for the data-loss bug: a year was saved with only electricity,
    // Heat left blank. Re-opening to add Heat used to start the form empty, so
    // saving overwrote the dataset and dropped electricity. The dialog now
    // pre-loads the stored figures when you type a year that already exists.
    await addEnergyYear(page, ADDR, EDIT_YEAR, "55555"); // electricity only

    // The energy-year dialog now opens from the building's observation page
    // ("Edit energy years"), not a finder-row action.
    const openYearDialog = async () => {
      await page.goto(buildingRoute("observation", id));
      await page.getByRole("button", { name: t("btnEditEnergyYears") }).click();
      await page.getByRole("spinbutton", { name: t("lblYear"), exact: true })
        .fill(EDIT_YEAR);
    };

    // Re-open on that year: the stored electricity is pre-filled (not blank).
    await openYearDialog();
    await expect(page.getByText(tPattern("eyEditingNote")))
      .toBeVisible({ timeout: T.action });
    await expect(page.getByRole("spinbutton", { name: metricT("electricityConsumption") }))
      .toHaveValue("55555");
    // Add Heat WITHOUT re-typing electricity, then save.
    await page.getByRole("spinbutton", { name: metricT("heatConsumption") }).fill("33333");
    await page.getByRole("button", { name: t("btnSave"), exact: true }).click();
    await expect(page.getByText(t("energySaved")).first())
      .toBeVisible({ timeout: T.action });
    // Saving keeps the editor open now — close it (Close flips back to the charts view).
    await page.getByRole("button", { name: t("btnClose"), exact: true })
      .filter({ hasText: t("btnClose") }).click();
    await expect(page.getByRole("spinbutton", { name: t("lblYear"), exact: true }))
      .toBeHidden({ timeout: T.action });

    // Re-open once more: BOTH figures persisted — electricity was not zeroed.
    await openYearDialog();
    await expect(page.getByRole("spinbutton", { name: metricT("electricityConsumption") }))
      .toHaveValue("55555");
    await expect(page.getByRole("spinbutton", { name: metricT("heatConsumption") }))
      .toHaveValue("33333");
    await page.getByRole("button", { name: t("btnClose"), exact: true })
      .filter({ hasText: t("btnClose") }).click();
  });

  test("the dialog lists stored years and can delete one", async () => {
    test.setTimeout(T.testSolo);
    const DEL_YEAR = "2096";
    // Seed a throwaway year, then re-open: the read-back table shows it.
    await addEnergyYear(page, ADDR, DEL_YEAR, "12345");
    await page.goto(buildingRoute("observation", id));
    await page.getByRole("button", { name: t("btnEditEnergyYears") }).click();

    // The editor is inline now and replaces the charts while open, so its stored-years
    // table is the only table on the page.
    const table = page.getByRole("table");
    const yearRow = table.getByRole("row", {
      name: new RegExp(`\\b${DEL_YEAR}\\b`),
    });
    await expect(yearRow).toBeVisible({ timeout: T.action });

    // The row's Edit button loads that year's figures into the form (the
    // "edit afterwards" path, like editing a building) — the raw stored values,
    // not the de-DE-formatted table cells.
    await yearRow.getByRole("button", { name: t("eyEditYear") }).click();
    await expect(page.getByRole("spinbutton", { name: t("lblYear"), exact: true }))
      .toHaveValue(DEL_YEAR);
    await expect(page.getByRole("spinbutton", { name: metricT("electricityConsumption") }))
      .toHaveValue("12345");
    await expect(page.getByText(tPattern("eyEditingNote")))
      .toBeVisible({ timeout: T.action });

    // Delete it (the in-app confirm dialog asks first) — the row disappears.
    await yearRow.getByRole("button", { name: t("eyDeleteYear") }).click();
    await confirmDialog(page, "Delete");
    await expect(page.getByText(t("energyYearDeleted")).first())
      .toBeVisible({ timeout: T.action });
    await expect(yearRow).toBeHidden({ timeout: T.action });
    await page.getByRole("button", { name: t("btnClose"), exact: true })
      .filter({ hasText: t("btnClose") }).click();
  });

  test("a PV unit records its own per-year observation, separate from the building", async () => {
    test.setTimeout(T.testSolo);
    const PV_YEAR = "2095";

    // 1) Add a PV unit on the building page (Energy systems section) — only then does
    // the energy dialog offer it as a feature of interest.
    await page.goto(buildingRoute("building", id));
    const sysBtn = page
      .getByRole("heading", { name: t("secEnergySystems"), exact: true })
      .locator("xpath=..")
      .getByRole("button");
    await sysBtn.click();
    // The energy-systems editor is inline on the page now (no dialog).
    const addPv = page.getByRole("button", { name: t("btnAddPv"), exact: true });
    await expect(addPv).toBeVisible({ timeout: T.visible });
    await addPv.click();
    await page.getByLabel(t("lblSystemCapacityKW"), { exact: true }).fill("500");
    await page.getByRole("button", { name: t("btnSave"), exact: true }).click();
    await expect(page.getByText(t("buildingUpdated"))).toBeVisible({ timeout: T.action });

    // 2) Open the energy-year dialog; "Observe for" now offers the PV unit.
    await page.goto(buildingRoute("observation", id));
    await page.getByRole("button", { name: t("btnEditEnergyYears") }).click();
    // The energy-year editor is inline on the observation page now (no dialog).
    await page.getByLabel(t("eyObserveFor")).click();
    // The option label carries the capacity to disambiguate units ("PV system (500 kW)").
    await page.getByRole("option", { name: new RegExp(t("mdPvSystem")) }).click();

    // 3) Enter a generation figure for PV_YEAR and save — it attaches to <#pv> as the
    // feature of interest, NOT the building.
    await page.getByRole("spinbutton", { name: t("lblYear"), exact: true }).fill(PV_YEAR);
    await page.getByRole("spinbutton", { name: metricT("electricityGeneration") })
      .fill("240000");
    await page.getByRole("button", { name: t("btnSave"), exact: true }).click();
    await expect(page.getByText(t("energySaved")).first())
      .toBeVisible({ timeout: T.action });

    // 4) The PV scope lists the year. The editor's table is the FIRST table on the page;
    // the per-unit observations section (which also surfaces this PV figure) renders a
    // second table below it, so scope to `.first()` to avoid a strict-mode match.
    const table = page.getByRole("table").first();
    const pvRow = table.getByRole("row", { name: new RegExp(`\\b${PV_YEAR}\\b`) });
    await expect(pvRow).toBeVisible({ timeout: T.action });

    // 5) Switch "Observe for" back to the building → the PV year is NOT there,
    // proving per-unit observations are stored apart from the building's own.
    await page.getByLabel(t("eyObserveFor")).click();
    await page.getByRole("option", { name: t("eyFoiBuilding"), exact: true }).click();
    await expect(table.getByRole("row", { name: new RegExp(`\\b${PV_YEAR}\\b`) }))
      .toBeHidden({ timeout: T.action });

    // 6) Close the editor → the observation page surfaces the per-unit observations
    // section with the PV's figure (240.000 kWh, de-DE) under its own unit.
    await page.getByRole("button", { name: t("btnClose"), exact: true })
      .filter({ hasText: t("btnClose") }).click();
    await expect(page.getByRole("spinbutton", { name: t("lblYear"), exact: true }))
      .toBeHidden({ timeout: T.action });
    await expect(page.getByRole("heading", { name: t("unitObsHeading") }))
      .toBeVisible({ timeout: T.action });
    await expect(page.getByText(/240\.000/).first())
      .toBeVisible({ timeout: T.action });
    await page.goto("/");
  });

  // Runs last: the "Clear all data" row action on the Observations finder deletes every
  // dataset of the building (annual, planned, per-unit), so it drops out of the finder.
  test("clearing a building's observations removes it from the Observations finder", async () => {
    test.setTimeout(T.testSolo);
    // Reload, then retry tab→row until the post-restore building list has painted
    // (a single click can race the session restore + phase-1 load).
    await page.goto("/");
    const row = page.locator("li[data-building-id]", { hasText: ADDR }).first();
    await expect(async () => {
      // The Observations finder defaults to the Map view (energy moved here); the
      // building rows + the clear-data action live in the List view.
      await openObservationsView(page, "list");
      await expect(row).toBeVisible({ timeout: T.quick });
    }).toPass({ timeout: T.poll });

    // Clear all its observations (owner-only action), confirm the destructive prompt.
    await row.getByRole("button", { name: t("obsClearAria") }).click();
    await confirmDialog(page, "Delete");
    await expect(page.getByText(tPattern("obsCleared")).first())
      .toBeVisible({ timeout: T.action });

    // With no datasets left, the building leaves the Observations finder.
    await expect(row).toBeHidden({ timeout: T.action });
  });
});
