import { type Page } from "@playwright/test";
import { E2E_LOCAL } from "./lane.ts";

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
  // basemap.de WMS (every map) + the Bavaria orthophoto WMS (the building-detail
  // locator thumbnail's base layer) — both pure background imagery no spec asserts.
  await page.route(
    /geodatenzentrum\.de|geoservices\.bayern\.de/,
    (route) =>
      route.fulfill({ status: 200, contentType: "image/png", body: PNG_1x1 }),
  );
}

/** CORS headers so a stubbed cross-origin GET resolves like the real wrapper would. */
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

/**
 * Stub the EXTERNAL open-data / enrichment hosts the app fetches around the map — the
 * regional + open-data tiers the redesign added: the linked-data wrappers on
 * `wunderfacts.com` (mastr / lod2-by / energieatlas / regionalstatistik / nuts / lau /
 * wetterdienst) and Wikidata/Commons logos. Every map visit fires dozens of slow REAL
 * cross-internet GETs that no spec asserts; left un-stubbed they keep the app busy and
 * starve the lane. A 404 lets the app fall back (every enrichment is best-effort).
 *
 * **Nominatim geocoding is the exception** — it is NOT best-effort: building add / demo
 * seed geocode the address to coordinates, and a building with no coords paints no map
 * marker. So Nominatim is stubbed with deterministic FAKE coords (Nuremberg area, spread
 * by a hash of the query so distinct addresses don't stack), keeping the lane hermetic
 * *and* giving every seeded/added building a point. (Kept faked in BOTH lanes: live
 * Nominatim rate-limits to ~1 req/s and geocoding is infra, not an open-data source a
 * remote spec asserts — see the per-spec open-data stubs' `stubWhenLocal`.)
 *
 * The wrapper 404 catch-all is applied **only in the LOCAL lane**: `e2e:remote` is meant
 * to exercise the LIVE wrappers end-to-end (the open-data specs gate their own fixtures on
 * `stubWhenLocal`, so without lane-gating this global 404 would win in remote and silently
 * empty every wrapper read — masking the very live behaviour the remote lane exists to
 * check). Basemap tiles + Nominatim stay stubbed in both lanes (infra noise).
 *
 * Applied at page creation alongside {@link stubBasemapTiles}. A spec that asserts a
 * specific source (e.g. the open-tier specs stubbing `/lod2-by/` or `/regionalstatistik/`,
 * or the geocode specs stubbing Nominatim with real-address coords) registers its own
 * `page.route` AFTERWARDS — a later handler wins in Playwright.
 */
export async function stubExternalData(page: Page): Promise<void> {
  // Nominatim → fake but valid coords so geocoded buildings get a marker.
  await page.route(/nominatim\.openstreetmap\.org/, (route) => {
    const q = decodeURIComponent(
      route.request().url().match(/[?&]q=([^&]*)/)?.[1] ?? "",
    );
    let h = 0;
    for (let i = 0; i < q.length; i++) h = (h * 31 + q.charCodeAt(i)) >>> 0;
    const lat = (49.40 + (h % 100) / 1000).toFixed(6); // ~49.40–49.50
    const lon = (11.00 + (Math.floor(h / 100) % 100) / 1000).toFixed(6); // ~11.00–11.10
    return route.fulfill({
      status: 200,
      headers: { ...CORS, "Content-Type": "application/json" },
      body: JSON.stringify([{ lat, lon }]),
    });
  });
  // The open-data / regional wrappers + logos → 404 (best-effort enrichment; the app
  // falls back). Scoped to the specific wrapper PATHS, NOT the whole `wunderfacts.com`
  // host — `/wetterdienst/` is deliberately left live (cube-calendar-weather asserts the
  // real DWD adapter's outcome), and per-spec stubs (`/mastr/`, `/lod2-by/`, …) register
  // later and win where a spec wants fixture data.
  //
  // LOCAL ONLY: on `e2e:remote` the wrappers are left LIVE (the open-data specs assert
  // real wrapper behaviour there; their per-spec `stubWhenLocal` fixtures are no-ops in
  // remote, so this catch-all must not 404 the live reads out from under them).
  //
  // NB: `*.example` (seed/demo WebIDs like `operator.example` / `contact-page-e2e.example`)
  // is deliberately NOT stubbed here. Stubbing it 404 broke contact-page (the agent
  // name-resolution falls back to the IRI fragment on a network error but NOT on a 404),
  // and it didn't reduce the JSS crashes anyway. So the `*.example` DNS-fail retry noise
  // is left as-is (documented in plans/flakes.md); fixing it cleanly would mean the app
  // falling back to the fragment on a 404 too — out of scope here.
  if (E2E_LOCAL) {
    await page.route(
      /wunderfacts\.com\/(mastr|lod2-by|energieatlas|regionalstatistik|nuts|lau|netztransparenz)\/|wikidata\.org|commons\.wikimedia\.org/,
      (route) => route.fulfill({ status: 404, headers: CORS, body: "" }),
    );
  }
}
