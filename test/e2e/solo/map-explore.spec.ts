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
    // The place-search geocode → Nürnberg. The app geocodes via the linked-osm Nominatim
    // proxy (`sourceBase("osm")` = osmwrap.ontologycentral.com/nominatim/search.json,
    // returning a GeoJSON FeatureCollection with `geometry.coordinates` = [lon, lat]) —
    // NOT nominatim.openstreetmap.org. Stubbed in BOTH lanes: geocoding is rate-limited
    // infra (the live proxy takes ~60 s, past the URL-recentre timeout), not the open-data
    // source this spec asserts — that's the LIVE LoD2 rooftop layer above (`stubWhenLocal`).
    await page.route(/\/nominatim\/search/, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/geo+json",
        headers: CORS,
        body: JSON.stringify({
          type: "FeatureCollection",
          features: [{
            type: "Feature",
            geometry: { type: "Point", coordinates: [11.0767, 49.4521] },
          }],
        }),
      }));
    await login(page, ACC);
    await assertCleanStart(page);
  });

  test.afterAll(async () => {
    await page.unroute(/\/lod2-by\//).catch(() => {});
    await page.unroute(/\/nominatim\/search/).catch(() => {});
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
    // the open layers fetch the viewport, so the open rooftops appear.
    await page.getByRole("button", { name: t("exploreToggle") }).click();
    await page.getByPlaceholder(t("explorePlacePlaceholder")).fill("Nürnberg");
    await page.getByRole("button", { name: t("exploreSearchBtn"), exact: true }).click();

    await expect(page).toHaveURL(/[?&]explore=1/, { timeout: T.action });
    // Recentred to the Nürnberg area (`49.4x`) — matches both the LOCAL per-spec geocode
    // stub (49.4521) and the REMOTE global Nominatim fake (hash-based 49.40–49.49; live
    // Nominatim stays stubbed as rate-limited infra, not the open-data source under test).
    await expect(page).toHaveURL(/[?&]c=49\.4/, { timeout: T.action });
    await expect(openRows.first()).toBeVisible({ timeout: T.poll });
    expect(await openRows.count()).toBeGreaterThan(0);
  });
});
