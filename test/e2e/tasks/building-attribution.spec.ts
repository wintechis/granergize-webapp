import { expect, type Page, test } from "@playwright/test";
import { t } from "../helpers/i18n.ts";
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
 * Building coordinate attribution e2e. Coordinates GEOCODED from OpenStreetMap
 * (via Nominatim) carry the OSM/ODbL provenance in the building Turtle
 * (`geo:Point prov:wasDerivedFrom`); the building page surfaces it as a
 * "Coordinates: OpenStreetMap … (ODbL)" line — shown ONLY when a
 * `geocodePrecision` is set. This stubs Nominatim, geocodes a building via the
 * Add dialog's "Get coordinates" button (precision set → line shown), and
 * contrasts a building whose coordinates were entered DIRECTLY (no precision →
 * no line, so coords from a file/import/manual entry make no false OSM claim).
 * Self-cleaning; Alice (account A).
 *
 *   deno task e2e:local test/e2e/tasks/building-attribution.spec.ts
 */

const ACC = account("A");
const GEOCODED = "Attribution Geocoded Strasse 1";
const MANUAL = "Attribution Manual Strasse 2";
const CORS = { "access-control-allow-origin": "*" };

test.describe.configure({ mode: "serial" });

test.describe("building coordinate attribution (OSM / Nominatim)", () => {
  test.skip(
    !hasAccount(ACC),
    `Set WEBID_A_USERNAME / WEBID_A_PASSWORD (a throwaway Solid Pod) to run the building-attribution e2e.`,
  );

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(T.setup);
    page = await newCapturedPage(browser, "building-attribution");
    page.on("dialog", (d) => d.accept().catch(() => {}));
    // Stub Nominatim: any address query resolves to fixed Nürnberg coordinates
    // (+ permissive CORS, since the prod build calls the absolute OSM host).
    await page.route(/nominatim\.openstreetmap\.org/, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: CORS,
        body: JSON.stringify([{ lat: "49.4521", lon: "11.0767" }]),
      }));
    await login(page, ACC);
    await assertCleanStart(page);
  });

  test.afterAll(async () => {
    await verifyAndReset(page, "building-attribution");
    await page.close();
  });

  test("geocoded coordinates show the OSM / ODbL attribution line", async () => {
    test.setTimeout(T.testSolo);

    // Add by ADDRESS only, then geocode via the dialog button — this is the only
    // path that sets geocodePrecision (and writes the prov:wasDerivedFrom).
    await openBuildingsList(page);
    await page.getByRole("button", { name: t("addBuildingBtn") }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByLabel(t("lblStreetAddress"))).toBeVisible({
      timeout: T.visible,
    });
    await dialog.getByLabel(t("lblStreetAddress")).fill(GEOCODED);
    await dialog.getByLabel(t("lblLocality")).fill("Nürnberg");
    await dialog.getByLabel(t("lblPostalCode")).fill("90451");
    await dialog.getByLabel(t("lblRegion")).fill("Bayern");
    // Geocode → the latitude field populates from the stubbed Nominatim response.
    await dialog.getByRole("button", { name: t("addGetCoordinates") }).click();
    await expect(dialog.getByLabel(t("lblLatitude"))).not.toHaveValue("", {
      timeout: T.action,
    });
    await dialog.getByRole("button", { name: t("addBuildingBtn") }).click();
    await expect(dialog).toBeHidden({ timeout: T.action });

    const row = page.locator("li[data-building-id]", { hasText: GEOCODED })
      .first();
    await expect(row).toBeVisible({ timeout: T.action });
    const id = await buildingIdOf(row);
    if (!id) throw new Error("building-attribution: missing geocoded building id");

    await page.goto(buildingRoute("building", id));
    // The coordinate attribution: "Coordinates: OpenStreetMap / Nominatim (ODbL)".
    await expect(page.getByText(t("coordsLabel"))).toBeVisible({
      timeout: T.action,
    });
    await expect(page.getByRole("link", { name: "OpenStreetMap / Nominatim" }))
      .toBeVisible();
    await expect(page.getByRole("link", { name: "ODbL" })).toBeVisible();

    await page.goto("/");
    await openBuildingsList(page);
    await deleteBuildingRow(page, id);
  });

  test("coordinates entered directly (no geocode) show NO OSM attribution", async () => {
    test.setTimeout(T.testSolo);

    // addBuilding fills lat/long DIRECTLY → no geocodePrecision → no OSM claim.
    await addBuilding(page, MANUAL);
    const row = page.locator("li[data-building-id]", { hasText: MANUAL }).first();
    await expect(row).toBeVisible({ timeout: T.action });
    const id = await buildingIdOf(row);
    if (!id) throw new Error("building-attribution: missing manual building id");

    await page.goto(buildingRoute("building", id));
    // The page rendered (ownership chip present) but carries no coordinate
    // attribution — the OSM line and its link are both absent.
    await expect(page.getByText(t("tierMine"))).toBeVisible({
      timeout: T.action,
    });
    await expect(page.getByText(t("coordsLabel"))).toHaveCount(0);
    await expect(page.getByRole("link", { name: "OpenStreetMap / Nominatim" }))
      .toHaveCount(0);

    await page.goto("/");
    await openBuildingsList(page);
    await deleteBuildingRow(page, id);
  });
});
