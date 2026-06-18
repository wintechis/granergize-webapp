import { expect, type Page, test } from "@playwright/test";
import { en } from "../helpers/i18n.ts";
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
 * Neighbourhood energy-profile choropleth (the building observation page's
 * `NeighbourhoodEnergyMap`) e2e. For a Bavarian building it renders a small map of
 * the neighbour **Gemeinden** (from `linked-lau`, by viewport bbox) shaded by each
 * municipality's real rooftop-PV build-out (Ausbaugrad) from `linked-energieatlas`.
 * Both are EXTERNAL wrappers, so — like `regional-context.spec.ts` — this STUBS
 * them; the building is added with Nürnberg (Bavaria) coordinates. The widget lives
 * on the building's `/observation` page (which bootstraps cleanly), so this avoids
 * the standalone-route cold-load issue. Self-cleaning; Alice (account A).
 *
 *   deno task e2e:local test/e2e/tasks/neighbourhood-energy.spec.ts
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

// Per-Gemeinde Energie-Atlas potential (vocab:AreaPotential), keyed by AGS.
function eaTtl(ags: string, name: string, pct: number, installed: number, pot: number): string {
  return `
@prefix rdf:   <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix skos:  <http://www.w3.org/2004/02/skos/core#> .
@prefix vocab: <https://wunderfacts.com/energieatlas/vocab#> .
<#it> rdf:type vocab:AreaPotential ; skos:notation "${ags}" ; vocab:name "${name}" ;
  vocab:developmentDegreePct ${pct} ; vocab:installedCapacityMWp ${installed} ;
  vocab:pvPotentialCapacityMWp ${pot} ; vocab:remainingPotentialMWp ${pot - installed} .
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
    // Stub the external wrappers (the Tier-3 build points at the absolute wunderfacts
    // hosts). The widget needs linked-lau + linked-energieatlas; the rest of the
    // observation page's external layers (regionalstatistik, MaStR, weather) are
    // 404'd so they degrade silently and the test stays hermetic.
    await page.route(/\/lau\/geojson/, (route) =>
      route.fulfill({ status: 200, contentType: "application/geo+json", headers: CORS, body: LAU_FC }));
    await page.route(/\/energieatlas\/area\/(\d+)/, (route) => {
      const ags = route.request().url().match(/\/area\/(\d+)/)?.[1] ?? "";
      const body = EA[ags];
      return body
        ? route.fulfill({ status: 200, contentType: "text/turtle", headers: CORS, body })
        : route.fulfill({ status: 404, headers: CORS, body: "" });
    });
    await page.route(/\/(regionalstatistik|mastr|wetterdienst)\//, (route) =>
      route.fulfill({ status: 404, headers: CORS, body: "" }));
    // The building page also carries the regional-metrics map (NUTS geometry); stub
    // it empty so it adds no interactive polygons to the neighbourhood count.
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

  test("the building page shows the neighbour-Gemeinde rooftop-PV choropleth", async () => {
    test.setTimeout(T.testSolo);

    await addBuilding(page, ADDR); // fills region "Bayern" + Nürnberg coords
    const row = page.locator("li[data-building-id]", { hasText: ADDR }).first();
    await expect(row).toBeVisible({ timeout: T.action });
    const buildingId = await buildingIdOf(row);
    if (!buildingId) throw new Error("neighbourhood-energy: missing building id");
    id = buildingId;

    await page.goto(buildingRoute("building", id));

    // The widget renders its section title + a Leaflet map of the neighbour Gemeinden.
    await expect(page.getByText(en("neighbourhoodTitle"))).toBeVisible({ timeout: T.action });
    // The Gemeinde polygons (the building's location marker is non-interactive).
    const regions = page.locator("path.leaflet-interactive");
    await expect(regions.first()).toBeVisible({ timeout: T.action });
    await expect(regions).toHaveCount(2, { timeout: T.action });

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
