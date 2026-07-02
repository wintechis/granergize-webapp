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
import { E2E_LOCAL, stubWhenLocal } from "../helpers/lane.ts";
import { T } from "../helpers/timeouts.ts";

/**
 * Neighbourhood energy-profile choropleth (the building observation page's
 * `NeighbourhoodEnergyMap`) e2e. For a Bavarian building it renders a small map of
 * the neighbour **Gemeinden** (from `linked-lau`, by viewport bbox) shaded by each
 * municipality's real rooftop-PV build-out (Ausbaugrad) from `linked-energieatlas`.
 * The building is added with Nürnberg (Bavaria) coordinates. LOCAL stubs both wrappers
 * → exactly two neighbour Gemeinden; REMOTE lets them reach the LIVE wrappers (the seed
 * sits on real coverage), so the neighbour count is nondeterministic and we assert only
 * that ≥2 polygons draw with distinct build-out shading. The page's OTHER external layers
 * (regionalstatistik, MaStR, weather, the regional NUTS map) are 404'd/emptied in BOTH
 * lanes — they aren't this test's subject, and suppressing them keeps the page-wide
 * polygon count attributable to the neighbourhood map. The widget lives on the building's
 * `/observation` page (which bootstraps cleanly). Self-cleaning; Alice (account A).
 *
 *   deno task e2e:local test/e2e/solo/neighbourhood-energy.spec.ts
 */

const ADDR = "Neighbourhood Energy E2E Strasse 1";
const ACC = account("A");
const CORS = { "access-control-allow-origin": "*" };

// Two neighbour Gemeinden near Nürnberg, with AGS join keys + square geometries.
const LAU_FC = JSON.stringify({
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: { code: "DE_09564000", ags: "09564000", label: "Nürnberg" },
      geometry: { type: "Polygon", coordinates: [[[11.0, 49.40], [11.16, 49.40], [11.16, 49.50], [11.0, 49.50], [11.0, 49.40]]] },
    },
    {
      type: "Feature",
      properties: { code: "DE_09574111", ags: "09574111", label: "Roth" },
      geometry: { type: "Polygon", coordinates: [[[11.0, 49.30], [11.16, 49.30], [11.16, 49.40], [11.0, 49.40], [11.0, 49.30]]] },
    },
  ],
});

// Per-Gemeinde Energie-Atlas potential, in the wrapper's RDF DATA CUBE shape
// (one qb:Observation per `#dim-indicator`, the form `readSingleRegionCube`
// parses — the flat vocab:AreaPotential shape predates the QB migration).
function eaTtl(ags: string, name: string, pct: number, installed: number, pot: number): string {
  const obs = (indicator: string, value: number) => `
<#obs-${indicator}> rdf:type qb:Observation ;
  qb:dataSet <../data/area#ds> ;
  <../ds/area#dim-TIME_PERIOD> "2024"^^xsd:gYear ;
  <../ds/area#dim-geo> <../ags/${ags}> ;
  <../ds/area#dim-indicator> <../cl/indicator#${indicator}> ;
  <../ds/area#measure-OBS_VALUE> "${value}"^^xsd:decimal .`;
  return `
@prefix rdf:   <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix qb:    <http://purl.org/linked-data/cube#> .
@prefix skos:  <http://www.w3.org/2004/02/skos/core#> .
@prefix vocab: <https://wunderfacts.com/energieatlas/vocab#> .
@prefix xsd:   <http://www.w3.org/2001/XMLSchema#> .
<#it> vocab:name "${name}" ; skos:notation "${ags}" .
${obs("developmentDegreePct", pct)}
${obs("installedCapacityMWp", installed)}
${obs("pvPotentialCapacityMWp", pot)}
${obs("remainingPotentialMWp", pot - installed)}
`;
}
const EA: Record<string, string> = {
  "09564000": eaTtl("09564000", "Nürnberg", 18.2, 95, 520),
  "09574111": eaTtl("09574111", "Roth", 24.3, 16, 67),
};

// 1×1 transparent PNG for the basemap WMS tiles — keeps the test hermetic.
const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

test.describe("neighbourhood energy choropleth", () => {
  test.skip(!hasAccount(ACC), `Set E2E creds (account A) to run the neighbourhood-energy e2e.`);

  let page: Page;
  let id = "";

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(T.setup);
    page = await newCapturedPage(browser, "neighbourhood-energy");
    page.on("dialog", (d) => d.accept().catch(() => {}));
    // LOCAL only: stub the widget's OWN wrappers — linked-lau (neighbour geometry) +
    // linked-energieatlas (per-Gemeinde build-out). REMOTE lets both reach the live
    // hosts (the Tier-3/remote build points at the absolute wunderfacts hosts).
    await stubWhenLocal(page, /\/lau\/geojson/, (route) =>
      route.fulfill({ status: 200, contentType: "application/geo+json", headers: CORS, body: LAU_FC }));
    await stubWhenLocal(page, /\/energieatlas\/area\/(\d+)/, (route) => {
      const ags = route.request().url().match(/\/area\/(\d+)/)?.[1] ?? "";
      const body = EA[ags];
      return body
        ? route.fulfill({ status: 200, contentType: "text/turtle", headers: CORS, body })
        : route.fulfill({ status: 404, headers: CORS, body: "" });
    });
    // Suppress the observation page's OTHER external layers in BOTH lanes — they aren't
    // this test's subject, and 404'ing/emptying them keeps the page-wide interactive-path
    // count attributable to the neighbourhood map (regionalstatistik/MaStR/weather degrade
    // silently; the regional NUTS map draws no polygons).
    await page.route(/\/(regionalstatistik|mastr|wetterdienst)\//, (route) =>
      route.fulfill({ status: 404, headers: CORS, body: "" }));
    await page.route(/\/nuts\/geojson/, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/geo+json",
        headers: CORS,
        body: JSON.stringify({ type: "FeatureCollection", features: [] }),
      }));
    await page.route(/geodatenzentrum\.de/, (route) =>
      route.fulfill({ status: 200, contentType: "image/png", body: PNG_1x1 }));
    await login(page, ACC);
    await assertCleanStart(page);
  });

  test.afterAll(async () => {
    await verifyAndReset(page, "neighbourhood-energy");
    await page.close();
  });

  test("the observation page shows the neighbour-Gemeinde rooftop-PV choropleth", async () => {
    test.setTimeout(T.testSolo);

    await addBuilding(page, ADDR); // fills region "Bayern" + Nürnberg coords
    const row = page.locator("li[data-building-id]", { hasText: ADDR }).first();
    await expect(row).toBeVisible({ timeout: T.action });
    const buildingId = await buildingIdOf(row);
    if (!buildingId) throw new Error("neighbourhood-energy: missing building id");
    id = buildingId;

    // The neighbourhood choropleth is a building-location context layer on the observation
    // surface (sibling to weather + regional stats), not the bare master-data /building page.
    await page.goto(buildingRoute("observation", id));

    // The widget renders its section title + a Leaflet map of the neighbour Gemeinden.
    await expect(page.getByText(t("neighbourhoodTitle"))).toBeVisible({ timeout: T.action });
    // The Gemeinde polygons (the building's location marker is non-interactive). LOCAL
    // stubs exactly two neighbours; REMOTE hits live linked-lau (nondeterministic count).
    const regions = page.locator("path.leaflet-interactive");
    await expect(regions.first()).toBeVisible({ timeout: T.action });
    if (E2E_LOCAL) {
      await expect(regions).toHaveCount(2, { timeout: T.action });
    } else {
      await expect(async () => {
        expect(await regions.count()).toBeGreaterThanOrEqual(2);
      }).toPass({ timeout: T.action });
    }

    // The polygons are SHADED by each Gemeinde's Energie-Atlas build-out: the two
    // municipalities have different Ausbaugrad (18.2 % vs 24.3 %), so they get
    // DISTINCT magnitude colours once the per-Gemeinde figures load — a single grey
    // "no data" fill for both would mean the geometry↔Energie-Atlas join failed.
    await expect(async () => {
      const fills = await regions.evaluateAll((els) =>
        els.map((e) => e.getAttribute("fill"))
      );
      expect(new Set(fills.filter(Boolean)).size).toBeGreaterThan(1);
    }).toPass({ timeout: T.action });

    // Cleanup: delete the throwaway building.
    await page.goto("/");
    await openBuildingsList(page);
    await deleteBuildingRow(page, id);
  });
});
