import { expect, type Page, test } from "@playwright/test";
import { t } from "../helpers/i18n.ts";
import { account, hasAccount, login } from "../helpers/login.ts";
import { openBuildingsList } from "../helpers/manage.ts";
import { newCapturedPage } from "../helpers/consoleLog.ts";
import {
  assertCleanStart,
  clearFinderMemory,
  verifyAndReset,
} from "../helpers/cleanSlate.ts";
import { stubWhenLocal } from "../helpers/lane.ts";
import { T } from "../helpers/timeouts.ts";

/**
 * The open tier's opt-in **exploration** mode. With NO own building the open tier is empty
 * (the concentric default — nothing to anchor to). Toggling "Explore this area" + searching
 * a place anchors the open layers to the map viewport, so open data appears for that place.
 * LOCAL stubs the LoD2 `/nearby` summary + per-building roof deref and the Nominatim
 * geocode; REMOTE lets both fall through to the live hosts (Nürnberg sits on real LoD2
 * coverage). Self-cleaning; Alice (account A).
 *
 *   deno task e2e:local test/e2e/solo/map-explore.spec.ts
 */

const ACC = account("A");
const CORS = { "access-control-allow-origin": "*" };

// Two LoD2 buildings near Nürnberg — the geometry-only `/nearby` summary the parser reads
// (post-`point→nearby` rename; kWp is computed app-side from a per-building deref).
const LOD2_NEARBY = `
@prefix geo: <http://www.w3.org/2003/01/geo/wgs84_pos#> .
@prefix lod2: <https://wunderfacts.com/lod2-by/vocab#> .
<https://wunderfacts.com/lod2-by/building/DEBY1> a lod2:Building ;
  geo:lat 49.451 ; geo:long 11.081 .
<https://wunderfacts.com/lod2-by/building/DEBY2> a lod2:Building ;
  geo:lat 49.452 ; geo:long 11.082 .
`;

// A per-building deref: one south-facing roof surface → a positive installable kWp.
const LOD2_ROOF = `
@prefix geo: <http://www.w3.org/2003/01/geo/wgs84_pos#> .
@prefix lod2: <https://wunderfacts.com/lod2-by/vocab#> .
<#roof-0> a lod2:RoofSurface ; lod2:area 300 ; lod2:azimuth 180 ; lod2:tilt 35 .
<> a lod2:Building ; geo:lat 49.451 ; geo:long 11.081 ; lod2:buildingHeight 10 ;
  lod2:hasRoofSurface <#roof-0> .
`;

test.describe.configure({ mode: "serial" });

test.describe("open-data exploration mode", () => {
  test.skip(
    !hasAccount(ACC),
    `Set WEBID_A_USERNAME / WEBID_A_PASSWORD (a throwaway Solid Pod) to run the map-explore e2e.`,
  );

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(T.setup);
    page = await newCapturedPage(browser, "map-explore");
    page.on("dialog", (d) => d.accept().catch(() => {}));
    // LOCAL only: LoD2 `/nearby` summary + per-building roof deref; 404 anything else
    // under the base. REMOTE falls through to the live wrapper.
    await stubWhenLocal(page, /\/lod2-by\//, (route) => {
      const url = route.request().url();
      if (url.includes("/nearby")) {
        return route.fulfill({ status: 200, contentType: "text/turtle", headers: CORS, body: LOD2_NEARBY });
      }
      if (url.includes("/building/")) {
        return route.fulfill({ status: 200, contentType: "text/turtle", headers: CORS, body: LOD2_ROOF });
      }
      return route.fulfill({ status: 404, headers: CORS, body: "" });
    });
    // Nominatim geocode → Nürnberg (the keyword "search a place" hit). REMOTE hits live
    // Nominatim, which resolves "Nürnberg" to the same ~49.45/11.07 the `?c` check expects.
    await stubWhenLocal(page, /nominatim\.openstreetmap\.org/, (route) =>
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
    await page.unroute(/\/lod2-by\//).catch(() => {});
    await page.unroute(/nominatim\.openstreetmap\.org/).catch(() => {});
    await verifyAndReset(page, "map-explore");
    await page.close();
  });

  test("Explore + place search surfaces open data with no own building", async () => {
    test.setTimeout(T.testSolo);
    await clearFinderMemory(page);
    await openBuildingsList(page);

    const openRows = page.locator("li", { hasText: t("openBuildingLabel") });

    // Tick the open tier — but with no own building, the concentric anchor is empty, so
    // there are NO open rows (and the "add a located building" hint shows).
    await page
      .getByRole("group", { name: t("tierFilterAria") })
      .getByRole("button", { name: t("tierOpen") })
      .click();
    await expect(page.getByText(t("openNeedsOwnBuilding"))).toBeVisible({ timeout: T.action });
    await expect(openRows).toHaveCount(0);

    // Turn on exploration, then search a place → the map recentres there (`?c`/`?z`) and
    // the open layers fetch the viewport, so the stubbed rooftops appear.
    await page.getByRole("button", { name: t("exploreToggle") }).click();
    await page.getByPlaceholder(t("explorePlacePlaceholder")).fill("Nürnberg");
    await page.getByRole("button", { name: t("exploreSearchBtn"), exact: true }).click();

    await expect(page).toHaveURL(/[?&]explore=1/, { timeout: T.action });
    await expect(page).toHaveURL(/[?&]c=49\.45/, { timeout: T.action });
    await expect(openRows.first()).toBeVisible({ timeout: T.poll });
    expect(await openRows.count()).toBeGreaterThan(0);
  });
});
