import { expect, type Page, test } from "@playwright/test";
import { account, hasAccount, login } from "../helpers/login.ts";
import { addBuilding, openBuildingsMap } from "../helpers/manage.ts";
import { newCapturedPage } from "../helpers/consoleLog.ts";
import {
  assertCleanStart,
  clearFinderMemory,
  verifyAndReset,
} from "../helpers/cleanSlate.ts";
import { watchAppErrors } from "../helpers/errorGuard.ts";
import { T } from "../helpers/timeouts.ts";

/**
 * The Buildings map's region level-of-detail (#2): below `CHOROPLETH_BELOW` zoom it shades
 * region polygons instead of drawing markers/clusters; zooming back in restores the pins.
 * STUBS the `linked-nuts` `/geojson` geometry (an EXTERNAL host) with one Bavaria polygon.
 * Asserts the swap both ways. Self-cleaning; Alice (account A).
 *
 *   deno task e2e:local test/e2e/tasks/map-region-choropleth.spec.ts
 */

const ACC = account("A");
const CORS = { "access-control-allow-origin": "*" };

// One region polygon (a box around Nürnberg) the choropleth can draw. `ags`/geometry are
// all `normalizeRegionGeometry` requires; shading needs each building's stored region AGS
// (unit-tested separately) — here the polygon renders grey, which still proves the LOD swap.
const NUTS_FC = JSON.stringify({
  type: "FeatureCollection",
  features: [{
    type: "Feature",
    properties: { ags: "09", code: "DE2", label: "Bayern", level: 1 },
    geometry: {
      type: "Polygon",
      coordinates: [[[10.5, 48.5], [12.5, 48.5], [12.5, 50.5], [10.5, 50.5], [10.5, 48.5]]],
    },
  }],
});

test.describe.configure({ mode: "serial" });

test.describe("map region choropleth (LOD)", () => {
  test.skip(
    !hasAccount(ACC),
    `Set WEBID_A_USERNAME / WEBID_A_PASSWORD (a throwaway Solid Pod) to run the map-region-choropleth e2e.`,
  );

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(T.setup);
    page = await newCapturedPage(browser, "map-region-choropleth");
    page.on("dialog", (d) => d.accept().catch(() => {}));
    await page.route(/\/nuts\/geojson/, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/geo+json",
        headers: CORS,
        body: NUTS_FC,
      }));
    await login(page, ACC);
    await assertCleanStart(page);
  });

  test.afterAll(async () => {
    await page.unroute(/\/nuts\/geojson/).catch(() => {});
    await verifyAndReset(page, "map-region-choropleth");
    await page.close();
  });

  test("zooming out swaps markers for a region choropleth, and back", async () => {
    test.setTimeout(T.testSolo);
    await clearFinderMemory(page);

    await addBuilding(page, "Choropleth E2E Strasse 1");
    await openBuildingsMap(page);
    // Street zoom (the single-building auto-fit, z≈18 ≥ CHOROPLETH_BELOW): a pin, no regions.
    await expect(page.locator(".pin-owned")).toHaveCount(1, { timeout: T.action });
    await expect(page.locator("path.leaflet-interactive")).toHaveCount(0);

    // Zoom OUT below the threshold → the region polygon appears and the pin is gone.
    const zoomOut = page.locator(".leaflet-control-zoom-out");
    await expect(async () => {
      await zoomOut.click();
      expect(await page.locator("path.leaflet-interactive").count()).toBeGreaterThan(0);
    }).toPass({ timeout: T.poll, intervals: [300] });
    await expect(page.locator(".pin-owned")).toHaveCount(0);

    // Zoom back IN past the threshold → the pin returns and the choropleth is gone.
    const zoomIn = page.locator(".leaflet-control-zoom-in");
    await expect(async () => {
      await zoomIn.click();
      expect(await page.locator(".pin-owned").count()).toBe(1);
    }).toPass({ timeout: T.poll, intervals: [300] });
    await expect(page.locator("path.leaflet-interactive")).toHaveCount(0);
  });
});

/**
 * Best-effort degrade: when the geometry wrapper is DOWN (every `/geojson` 404s — the
 * real-world squashfs-mount-lost / transient-outage case that tripped the logout spec),
 * the region choropleth is a decorative overlay, so its fetch is marked `meta.silent`
 * (QueryProvider) — the overlay simply doesn't draw and NO error toast is raised. This
 * is the deterministic regression for that fix: forcing the 404 rather than waiting for
 * the live wrapper to happen to be down. Alice (account A).
 */
test.describe("map region choropleth — geometry outage degrades silently", () => {
  test.skip(
    !hasAccount(ACC),
    `Set WEBID_A_USERNAME / WEBID_A_PASSWORD (a throwaway Solid Pod) to run the map-region-choropleth e2e.`,
  );

  let page: Page;
  let assertNoAppErrors: () => void;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(T.setup);
    page = await newCapturedPage(browser, "map-region-choropleth-outage");
    page.on("dialog", (d) => d.accept().catch(() => {}));
    ({ assertNoAppErrors } = watchAppErrors(page));
    // The geo wrapper is down: every region-geometry read (nuts/lau `/geojson`) 404s.
    await page.route(/\/(nuts|lau)\/geojson/, (route) =>
      route.fulfill({ status: 404, headers: CORS, body: "" }));
    await login(page, ACC);
    await assertCleanStart(page);
  });

  test.afterAll(async () => {
    await page.unroute(/\/(nuts|lau)\/geojson/).catch(() => {});
    await verifyAndReset(page, "map-region-choropleth-outage");
    await page.close();
  });

  test("a 404 from the geometry wrapper drops the choropleth without an error toast", async () => {
    test.setTimeout(T.testSolo);
    await clearFinderMemory(page);

    await addBuilding(page, "Outage E2E Strasse 1");
    await openBuildingsMap(page);
    await expect(page.locator(".pin-owned")).toHaveCount(1, { timeout: T.action });

    // Zoom OUT below the threshold → region-LOD fetches geometry, which 404s. The overlay
    // can't draw (no polygon) and the pin is hidden — but the read must stay silent.
    const zoomOut = page.locator(".leaflet-control-zoom-out");
    await expect(async () => {
      await zoomOut.click();
      expect(await page.locator(".pin-owned").count()).toBe(0);
    }).toPass({ timeout: T.poll, intervals: [300] });
    await expect(page.locator("path.leaflet-interactive")).toHaveCount(0);

    // The decisive assertion: the failed geometry read raised NO error notification
    // (pre-fix this toasted "HTTP 404 fetching region geometry (…)"). Grace period first
    // so a straggling toast — incl. the retried fetch's second failure — would surface.
    await page.waitForTimeout(1_000);
    assertNoAppErrors();

    // And the map is still usable — zoom back IN restores the pin.
    const zoomIn = page.locator(".leaflet-control-zoom-in");
    await expect(async () => {
      await zoomIn.click();
      expect(await page.locator(".pin-owned").count()).toBe(1);
    }).toPass({ timeout: T.poll, intervals: [300] });
  });
});
