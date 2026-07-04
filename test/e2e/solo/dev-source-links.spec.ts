import { expect, type Page, test } from "@playwright/test";
import { account, hasAccount, login } from "../helpers/login.ts";
import {
  addBuilding,
  buildingIdOf,
  buildingRoute,
  deleteBuildingRow,
  openBuildingsList,
} from "../helpers/manage.ts";
import { setDevMode } from "../helpers/accountMenu.ts";
import { newCapturedPage } from "../helpers/consoleLog.ts";
import { assertCleanStart, verifyAndReset } from "../helpers/cleanSlate.ts";
import { T } from "../helpers/timeouts.ts";
import { t } from "../helpers/i18n.ts";

/**
 * Developer-mode source links for the THREE external observation wrappers
 * (linked-regionalstatistik, linked-dwd, linked-mastr). In dev mode each
 * section must surface the ACTUAL dereferenced wrapper IRI as an absolute,
 * clickable, external link (MUI `<Link target=_blank>`), mirroring the Pod links —
 * so the data the app fetched is inspectable. All three wrappers are stubbed so the
 * sections render deterministically; we assert the links' absolute hrefs + that
 * they open externally. Self-cleaning; Alice (account A).
 *
 *   deno task e2e:local test/e2e/solo/dev-source-links.spec.ts
 */

const ADDR = "Dev Source Links E2E Strasse 1";
const ACC = account("A");
const CORS = { "access-control-allow-origin": "*" };
const ttl = (body: string) => ({
  status: 200,
  contentType: "text/turtle",
  headers: CORS,
  body,
});
// The building page also carries the energieatlas/lau/nuts/lod2 map widgets; stub them
// empty so the page is hermetic (this spec only asserts the wrappers' dev source links).
const EMPTY_FC = JSON.stringify({ type: "FeatureCollection", features: [] });
const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

const REGIO_TTL = `
@prefix qb: <http://purl.org/linked-data/cube#> .
@prefix ds: <https://wunderfacts.com/regionalstatistik/ds/86251-Z-02#> .
@prefix ags: <https://wunderfacts.com/regionalstatistik/ags/> .
<#o1> a qb:Observation ; ds:dim-geo ags:09 ; ds:dim-TIME_PERIOD "2023" ;
  ds:measure-OBS_VALUE 61.5 ; ds:unit "Prozent" .
`;

const MASTR_TTL = `
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix geo: <http://www.w3.org/2003/01/geo/wgs84_pos#> .
@prefix dcterms: <http://purl.org/dc/terms/> .
@prefix mastr: <https://wunderfacts.com/mastr/mastr#> .
<https://wunderfacts.com/mastr/see/1#it> rdfs:label "Solardach" ;
  geo:lat 49.451 ; geo:long 11.081 ;
  dcterms:spatial <https://wunderfacts.com/mastr/ags/09564000#it> ;
  mastr:Energietraeger "2495" .
`;

// Weather: a station (near?) + one observation (values?), enough for the panel to
// render its table — and thus the dev source link to the values?… query IRI.
const WEATHER_STATIONS_TTL = `
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix dwd: <https://opendata.dwd.de/#> .
@prefix geo: <http://www.w3.org/2003/01/geo/wgs84_pos#> .
@prefix schema: <http://schema.org/> .
<https://wunderfacts.com/dwd/station/03668> a dwd:WeatherStation ;
  dwd:station_id "03668" ; dwd:station_name "Nürnberg" ;
  geo:lat 49.50 ; geo:long 11.06 ; schema:distance 6 .
`;
const WEATHER_VALUES_TTL = `
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix sosa: <http://www.w3.org/ns/sosa/> .
@prefix qudt: <http://qudt.org/1.1/schema/qudt#> .
@prefix dwd: <https://opendata.dwd.de/#> .
<#obs1> a sosa:Observation ; sosa:observedProperty dwd:JA_TT ;
  sosa:resultTime "2023-12-31" ; dwd:quality 3 ;
  sosa:hasResult [ qudt:numericValue 9.8 ] .
`;

test.describe.configure({ mode: "serial" });

test.describe("dev-mode external source links", () => {
  test.skip(
    !hasAccount(ACC),
    `Set WEBID_A_USERNAME / WEBID_A_PASSWORD (a throwaway Solid Pod) to run the dev-source-links e2e.`,
  );

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(T.setup);
    page = await newCapturedPage(browser, "dev-source-links");
    page.on("dialog", (d) => d.accept().catch(() => {}));
    await page.route(/\/regionalstatistik\//, (route) =>
      route.fulfill(ttl(REGIO_TTL)));
    await page.route(/\/mastr\/within/, (route) => route.fulfill(ttl(MASTR_TTL)));
    await page.route(/\/dwd\//, (route) => {
      const url = route.request().url();
      return route.fulfill(
        ttl(url.includes("values?") ? WEATHER_VALUES_TTL : WEATHER_STATIONS_TTL),
      );
    });
    // The other building-page widgets — stub empty so they don't hit live wrappers.
    await page.route(/\/(nuts|lau)\/geojson/, (route) =>
      route.fulfill({ status: 200, contentType: "application/geo+json", headers: CORS, body: EMPTY_FC }));
    await page.route(/\/(energieatlas\/area|lod2-by)\//, (route) =>
      route.fulfill({ status: 404, headers: CORS, body: "" }));
    await page.route(/geodatenzentrum\.de/, (route) =>
      route.fulfill({ status: 200, contentType: "image/png", body: PNG_1x1 }));
    await login(page, ACC);
    await assertCleanStart(page);
  });

  test.afterAll(async () => {
    await verifyAndReset(page, "dev-source-links");
    await page.close();
  });

  test("each wrapper's IRI is shown as an absolute external link in dev mode", async () => {
    test.setTimeout(T.testSolo);

    // Dev mode is toggled from the app-shell Account menu (the standalone
    // observation route has no header), so enable it before navigating.
    await setDevMode(page, true);

    await addBuilding(page, ADDR); // Nürnberg coords + region "Bayern"
    const row = page.locator("li[data-building-id]", { hasText: ADDR }).first();
    await expect(row).toBeVisible({ timeout: T.action });
    const id = await buildingIdOf(row);
    if (!id) throw new Error("dev-source-links: missing building id");

    // Each section surfaces the ACTUAL dereferenced wrapper IRI (absolute, external).
    // The region-grain layers — regional statistics, weather — live on the
    // observation (energy) page; the nearby installations moved to the BUILDING
    // page's Surroundings section. The regional figures are map-first, so switch
    // to the figures table to surface its source link.
    const regioLink = 'a[href^="https://wunderfacts.com/regionalstatistik/data/86251-Z-02"]';
    const onObservation = {
      weather: 'a[href^="https://wunderfacts.com/dwd/values?"]',
      regionalstatistik: regioLink,
    };
    const onBuilding = {
      mastr: 'a[href^="https://wunderfacts.com/mastr/within?"]',
    };
    const assertLinks = async (where: Record<string, string>) => {
      for (const [name, sel] of Object.entries(where)) {
        const link = page.locator(sel).first();
        await expect(link, `${name} dev source link visible`).toBeVisible({
          timeout: T.action,
        });
        // Absolute + opens externally (the "blue external URI" affordance).
        await expect(link).toHaveAttribute("target", "_blank");
        await expect(link).toHaveAttribute("rel", /noopener/);
      }
    };
    // Reveal the regional figures table (map-first) so its dev source link renders.
    const showRegionalTable = () =>
      page.getByRole("button", { name: t("btnTable"), exact: true }).click();
    await page.goto(buildingRoute("observation", id));
    await showRegionalTable();
    await assertLinks(onObservation);
    await page.goto(buildingRoute("building", id));
    await assertLinks(onBuilding);

    // Sanity: the same links are HIDDEN once dev mode is off (self-hiding affordance).
    await page.goto("/");
    await setDevMode(page, false);
    await page.goto(buildingRoute("observation", id));
    await showRegionalTable();
    await expect(page.locator(onObservation.regionalstatistik)).toHaveCount(0);
    await page.goto(buildingRoute("building", id));
    await expect(page.locator(onBuilding.mastr)).toHaveCount(0);

    // Cleanup.
    await page.goto("/");
    await openBuildingsList(page);
    await deleteBuildingRow(page, id);
  });
});
