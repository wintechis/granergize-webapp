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
import { T } from "../helpers/timeouts.ts";

/**
 * The open tier's opt-in **exploration** mode. With NO own building the open tier is empty
 * (the concentric default — nothing to anchor to). Toggling "Explore this area" + searching
 * a place anchors the open layers to the map viewport, so open data appears for that place.
 * STUBS the LoD2 `/point` rooftops + Nominatim geocode. Self-cleaning; Alice (account A).
 *
 *   deno task e2e:local test/e2e/solo/map-explore.spec.ts
 */

const ACC = account("A");
const CORS = { "access-control-allow-origin": "*" };

// Two open rooftops near Nürnberg — served for any LoD2 `/point` query.
const LOD2_TTL = `
@prefix geo: <http://www.w3.org/2003/01/geo/wgs84_pos#> .
@prefix lod2: <https://w3id.org/linked-lod2-by/vocab#> .
<https://wunderfacts.com/lod2-by/see/DEBY1#it>
  geo:lat 49.451 ; geo:long 11.081 ; lod2:installableCapacity 42.5 .
<https://wunderfacts.com/lod2-by/see/DEBY2#it>
  geo:lat 49.452 ; geo:long 11.082 ; lod2:installableCapacity 18.0 .
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
    // LoD2 rooftops for any `/point`; 404 anything else under the base.
    await page.route(/\/lod2-by\//, (route) =>
      route.request().url().includes("/point")
        ? route.fulfill({ status: 200, contentType: "text/turtle", headers: CORS, body: LOD2_TTL })
        : route.fulfill({ status: 404, headers: CORS, body: "" }));
    // Nominatim geocode → Nürnberg (the keyword "search a place" hit).
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
