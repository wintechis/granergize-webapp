import { t } from "../helpers/i18n.ts";
import { expect, type Page, test } from "@playwright/test";
import { account, hasAccount, login } from "../helpers/login.ts";
import { newCapturedPage } from "../helpers/consoleLog.ts";
import { setDevMode } from "../helpers/accountMenu.ts";
import { ensureDemoBuildings } from "../helpers/seed.ts";
import { buildingIds, buildingRoute, openBuildingsList } from "../helpers/manage.ts";
import { assertCleanStart, clearFinderMemory, verifyAndReset } from "../helpers/cleanSlate.ts";
import { T } from "../helpers/timeouts.ts";

/**
 * Redesign e2e — the master-detail building page (the read-first `/building/:id`
 * page) and its reachability from the dashboard. Verifies, end-to-end in a real
 * browser, what the central build can't: that the building page renders its sections, that
 * inline master-data edit toggles, that it links to the full observation page,
 * and that the Manage list + Explore pane navigate into it.
 *
 *   # tier 3 (local CSS, no creds):
 *   deno task e2e:local test/e2e/solo/building-page.spec.ts
 *
 * Runs against Alice (account A); self-cleaning.
 */
const ACC = account("A");

test.describe.configure({ mode: "serial" });

test.describe("redesign: building page", () => {
  test.skip(
    !hasAccount(ACC),
    `Set WEBID_A_USERNAME / WEBID_A_PASSWORD (a throwaway Solid Pod) to run the building-page e2e.`,
  );

  let page: Page;
  let id: string;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(T.setup);
    page = await newCapturedPage(browser, "building-page");
    page.on("dialog", (d) => d.accept().catch(() => {}));
    await login(page, ACC);
    await assertCleanStart(page);
    await ensureDemoBuildings(page);
    const ids = await buildingIds(page);
    id = ids[0] ?? "";
    expect(id, "a demo building exists after seeding").toBeTruthy();
  });

  test.beforeEach(async () => {
    // The finder view/tier session memory is sticky; reset it so each test starts from
    // the hardcoded defaults (a sibling test's toggle must not leak in).
    await clearFinderMemory(page);
  });

  test.afterAll(async () => {
    await verifyAndReset(page, "building-page");
    await page.close();
  });

  test("the building page renders its read-first sections", async () => {
    await page.goto(buildingRoute("building", id));
    // Owned badge in the header, plus the section headings of the scrolling building page.
    // exact:true so the chip ("Owned") doesn't also match the master-data "Owned by"
    // row label (which renders once ownedBy converges) — strict-mode-ambiguous otherwise.
    await expect(page.getByText(t("tierMine"), { exact: true }))
      .toBeVisible({ timeout: T.action });
    // exact:true so "Energy" doesn't also match the "Location energy profile" panel
    // heading (substring) — strict-mode-ambiguous otherwise.
    await expect(page.getByRole("heading", { name: t("secEnergy"), exact: true }))
      .toBeVisible();
    await expect(page.getByRole("heading", { name: t("secFiles") })).toBeVisible();
    await expect(page.getByRole("heading", { name: t("secSharing") })).toBeVisible();
  });

  test("master data edits inline on the page (no modal)", async () => {
    await page.goto(buildingRoute("building", id));
    await page.getByRole("button", { name: t("btnEdit"), exact: true }).first().click();
    // Inline edit: editable fields appear on the page; Save/Cancel present.
    await expect(page.locator("input, textarea").first()).toBeVisible({
      timeout: T.action,
    });
    await expect(page.getByRole("button", { name: t("btnSave"), exact: true }).first())
      .toBeVisible();
    await page.getByRole("button", { name: t("btnCancel"), exact: true }).first().click();
  });

  test("the building page links to the full observation (energy) page", async () => {
    await page.goto(buildingRoute("building", id));
    // The Energy section is minimal here and links to /observation/:id for full charts.
    await page.locator("a[href*=\"observation\"]")
      .first().click();
    await expect(page).toHaveURL(/\/observation\?/, { timeout: T.action });
    await expect(page.getByRole("button", { name: t("btnEditEnergyYears") }))
      .toBeVisible();
  });

  test("clicking a building name in the Buildings list opens the building page", async () => {
    await page.goto("/buildings");
    // The Buildings finder lands on Map; switch to the List view to get the rows.
    await page.getByRole("button", { name: t("btnList") }).click();
    const row = page.locator(`li[data-building-id="${id}"]`);
    await expect(row).toBeVisible({ timeout: T.action });
    await row.getByRole("link").first().click();
    await expect(page).toHaveURL(/\/building\?/, { timeout: T.action });
    await expect(page.getByRole("heading", { name: t("secFiles") })).toBeVisible();
  });

  test("the list row is a finder — navigate + Delete only (other actions on the page)", async () => {
    // /building/:id is a standalone route (no app-shell tabs) — return to the shell.
    await page.goto("/");
    await openBuildingsList(page);
    const row = page.locator(`li[data-building-id="${id}"]`);
    await expect(row).toBeVisible({ timeout: T.action });
    // The one residual per-row action is Delete; per-object actions moved to the page.
    await expect(row.getByRole("button", { name: t("buildingDeleteAria") })).toBeVisible();
    for (
      const gone of ["Share building data", "Manage files", "Add or edit energy year"]
    ) {
      await expect(row.getByRole("button", { name: gone })).toHaveCount(0);
    }
  });

  test("the building page header offers the workbook download", async () => {
    await page.goto(buildingRoute("building", id));
    await expect(
      page.getByRole("button", { name: t("bhDownloadData") }),
    ).toBeVisible({ timeout: T.action });
  });

  test("the locator map requests the Bavaria DOP20c orthophoto for a Nürnberg building", async () => {
    // The demo buildings are in Nürnberg (Bavaria), so the building-page locator
    // thumbnail uses the Bavaria DOP20c orthophoto layer. Assert the app REQUESTS
    // it, kept HERMETIC by stubbing the external WMS with a 1×1 png (Tier-3 must
    // not depend on geoservices.bayern.de). The base-layer choice itself is
    // unit-tested in src/lib/orthophoto.test.ts.
    const PNG_1x1 = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      "base64",
    );
    const wms = /geoservices\.bayern\.de\/.*dop20/i;
    let requestedDop20c = false;
    await page.route(wms, async (route) => {
      if (/by_dop20c/i.test(route.request().url())) requestedDop20c = true;
      await route.fulfill({ status: 200, contentType: "image/png", body: PNG_1x1 });
    });
    try {
      await page.goto(buildingRoute("building", id));
      // exact:true — the chip "Owned" must not also match the "Owned by" row label.
      await expect(page.getByText(t("tierMine"), { exact: true }))
        .toBeVisible({ timeout: T.action });
      // Leaflet fires the thumbnail's tile requests asynchronously; poll for one.
      await expect.poll(() => requestedDop20c, { timeout: T.action }).toBe(true);
    } finally {
      await page.unroute(wms);
    }
  });

  test("Developer mode reveals the row's backing-resource IRI (self-hidden otherwise)", async () => {
    // The Buildings list row's source IRI goes through the one `RdfSourceLink`
    // (muted, self-hiding) like every other backing-resource link — no bespoke
    // render. Off by default, shown under the row name in Developer mode.
    await page.goto("/");
    await openBuildingsList(page);
    const row = page.locator(`li[data-building-id="${id}"]`);
    await expect(row).toBeVisible({ timeout: T.action });
    // A building's IRI lives under its own buildings/ container; the link text
    // IS the IRI. Hidden while Developer mode is off.
    const sourceLink = row.getByRole("link", { name: /\/buildings\// });
    await expect(sourceLink).toHaveCount(0);

    await setDevMode(page, true);
    await expect(sourceLink.first()).toBeVisible({ timeout: T.action });

    // Leave Developer mode as we found it (the afterAll reset doesn't touch it).
    await setDevMode(page, false);
    await expect(row.getByRole("link", { name: /\/buildings\// })).toHaveCount(0);
  });
});
