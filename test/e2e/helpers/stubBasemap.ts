import { type Page } from "@playwright/test";

/** A 1×1 transparent PNG — a valid image body for a stubbed map tile. */
const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

/**
 * Stub the basemap.de WMS tiles (`sgx.geodatenzentrum.de/wms_basemapde`) with a 1×1
 * PNG. The Buildings tab defaults to the Leaflet **Map**, so every visit fires ~100+
 * REAL external tile requests against `geodatenzentrum.de` — pure background no spec
 * asserts. Left un-stubbed, that external network/CPU load (×2 under the duo/trio's
 * two browser contexts) starves the local Pod fetches and flakes two-pod sharing with
 * a transient "Failed to fetch" on the inbox drain. Stubbing it removes the contention
 * (and speeds every spec).
 *
 * Applied at page creation (both the solo `newCapturedPage` and the duo/trio
 * `twoPod` factories). A spec that asserts the basemap can add its own `page.route`
 * for `geodatenzentrum.de` afterwards — a later handler takes precedence in Playwright.
 */
export async function stubBasemapTiles(page: Page): Promise<void> {
  await page.route(/geodatenzentrum\.de/, (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: PNG_1x1 }));
}
