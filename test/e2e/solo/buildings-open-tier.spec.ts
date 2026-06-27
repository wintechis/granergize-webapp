import { expect, type Page, test } from "@playwright/test";
import { t } from "../helpers/i18n.ts";
import { account, hasAccount, login } from "../helpers/login.ts";
import {
  addBuilding,
  openBuildingsList,
  openBuildingsMap,
} from "../helpers/manage.ts";
import { newCapturedPage } from "../helpers/consoleLog.ts";
import { assertCleanStart, verifyAndReset } from "../helpers/cleanSlate.ts";
import { T } from "../helpers/timeouts.ts";

/**
 * The Buildings finder's `open` source tier — public open-data buildings from LoD2
 * (`linked-lod2-by`), fetched around the user's OWN buildings (`ownDataAnchor`). The
 * wrapper is an EXTERNAL host, so this STUBS its `…/lod2-by/point` response (mirroring
 * nearby-installations / aggregations-open-tier). An owned building in Nürnberg/Bayern
 * (with coordinates) anchors the open fetch over LoD2 coverage; the stub returns two
 * rooftops. The test asserts the open tier populates — green (`pin-open`) markers on the
 * map + the Open count — and that the open buildings are read-only (a List row with no
 * action buttons). Self-cleaning; Alice (account A).
 *
 *   deno task e2e:local test/e2e/solo/buildings-open-tier.spec.ts
 */

const ADDR = "Open Tier Buildings E2E Strasse 1";
const ACC = account("A");
const CORS = { "access-control-allow-origin": "*" };

// Two LoD2 rooftops near the seeded building (geo:lat/long + installable kWp — the lean
// `point` summary the parser reads). Coordinates ≈ the Nürnberg building.
const LOD2_TTL = `
@prefix geo: <http://www.w3.org/2003/01/geo/wgs84_pos#> .
@prefix lod2: <https://w3id.org/linked-lod2-by/vocab#> .
<https://wunderfacts.com/lod2-by/see/DEBY1#it>
  geo:lat 49.451 ; geo:long 11.081 ; lod2:installableCapacity 42.5 .
<https://wunderfacts.com/lod2-by/see/DEBY2#it>
  geo:lat 49.452 ; geo:long 11.082 ; lod2:installableCapacity 18.0 .
`;

test.describe.configure({ mode: "serial" });

test.describe("buildings open tier (LoD2)", () => {
  test.skip(
    !hasAccount(ACC),
    `Set WEBID_A_USERNAME / WEBID_A_PASSWORD (a throwaway Solid Pod) to run the buildings-open-tier e2e.`,
  );

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(T.setup);
    page = await newCapturedPage(browser, "buildings-open-tier");
    page.on("dialog", (d) => d.accept().catch(() => {}));
    // Stub the external LoD2 wrapper: serve the two rooftops for any `point` query,
    // 404 anything else under the base (no live cross-origin call escapes).
    await page.route(/\/lod2-by\//, (route) => {
      const url = route.request().url();
      return url.includes("/point")
        ? route.fulfill({
          status: 200,
          contentType: "text/turtle",
          headers: CORS,
          body: LOD2_TTL,
        })
        : route.fulfill({ status: 404, headers: CORS, body: "" });
    });
    await login(page, ACC);
    await assertCleanStart(page);
  });

  test.afterAll(async () => {
    await verifyAndReset(page, "buildings-open-tier");
    await page.close();
  });

  test("the open tier surfaces read-only LoD2 buildings on the map + list", async () => {
    test.setTimeout(T.testSolo);

    // A building in Nürnberg/Bayern frames the Buildings map over LoD2 coverage → the
    // viewport `?c` is written, so the open fetch has a centre once it's enabled.
    await addBuilding(page, ADDR);

    // Switch to the Map view (markers live there; the map is mounted-hidden on List),
    // which frames on the building and writes `?c`.
    await openBuildingsMap(page);

    // The owned building's pin confirms the map rendered + framed (so `?c` is set).
    await expect(page.locator(".pin-owned").first())
      .toBeVisible({ timeout: T.action });

    // Open data is opt-in (off by default) — tick the "Open data" tier to load it.
    await page
      .getByRole("group", { name: t("tierFilterAria") })
      .getByRole("button", { name: t("tierOpen") })
      .click();

    // The two stubbed open buildings render as green (`pin-open`) markers once the
    // fetch returns. Retry — the fetch rides the viewport sync.
    const openMarkers = page.locator(".pin-open");
    await expect(async () => {
      expect(await openMarkers.count()).toBeGreaterThan(0);
    }).toPass({ timeout: T.poll, intervals: [1_000] });

    // The Open tier chip carries the count of fetched open buildings (2).
    await expect(
      page.getByRole("button", { name: new RegExp(`${t("tierOpen")} \\(2\\)`) }),
    ).toBeVisible({ timeout: T.action });

    // In the List, an open building is READ-ONLY: a row labelled "Open building" with
    // no action buttons (can't share/edit/delete public off-Pod data).
    await openBuildingsList(page);
    const openRow = page.locator("li", { hasText: t("openBuildingLabel") })
      .first();
    await expect(openRow).toBeVisible({ timeout: T.action });
    expect(await openRow.getByRole("button").count()).toBe(0);
    // The row label is now an in-app drill (a link to `/building?uri=`, the read-only
    // rooftop detail) rather than the upstream-doc click-out — the drill itself is
    // exercised end-to-end by open-observations.spec.ts (same off-Pod resolution).
    await expect(openRow.getByRole("link").first()).toBeVisible({ timeout: T.action });
  });
});
