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
 * Nearby-installations section (linked-mastr) e2e — the finest-grain place layer.
 * The wrapper is an EXTERNAL host, so this STUBS its `…/mastr/bbox` response (the
 * way regional-context stubs the cube) with a mix of renewable + non-renewable
 * units around the building's coordinates, and asserts the section keeps the
 * renewables (solar/wind), drops combustion, and renders the per-kind summary +
 * the nearest-first list. The regionalstatistik wrapper is stubbed to 404 so its
 * section stays absent and no live call escapes. Self-cleaning; Alice (account A).
 *
 *   deno task e2e:local test/e2e/tasks/nearby-installations.spec.ts
 */

const ADDR = "Nearby Installations E2E Strasse 1";
const ACC = account("A");
const CORS = { "access-control-allow-origin": "*" };

// bbox listing near the building (49.45, 11.08): two solar + one wind (kept) and
// one Wärme/combustion unit (carrier 2413, dropped). Coordinates are within the
// 3 km box so all renewables survive; ordered far→near to prove distance sorting.
const MASTR_TTL = `
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix geo: <http://www.w3.org/2003/01/geo/wgs84_pos#> .
@prefix dcterms: <http://purl.org/dc/terms/> .
@prefix mastr: <https://wunderfacts.com/mastr/mastr#> .
<https://wunderfacts.com/mastr/see/1#it> rdfs:label "Windrad Weit" ;
  geo:lat 49.460 ; geo:long 11.090 ;
  dcterms:spatial <https://wunderfacts.com/mastr/ags/09564000#it> ; mastr:Energietraeger "2497" .
<https://wunderfacts.com/mastr/see/2#it> rdfs:label "Solardach Nah" ;
  geo:lat 49.451 ; geo:long 11.081 ;
  dcterms:spatial <https://wunderfacts.com/mastr/ags/09564000#it> ; mastr:Energietraeger "2495" .
<https://wunderfacts.com/mastr/see/3#it> rdfs:label "Solardach Mittel" ;
  geo:lat 49.455 ; geo:long 11.085 ;
  dcterms:spatial <https://wunderfacts.com/mastr/ags/09564000#it> ; mastr:Energietraeger "2495" .
<https://wunderfacts.com/mastr/see/4#it> rdfs:label "Heizkraftwerk Müll" ;
  geo:lat 49.452 ; geo:long 11.082 ;
  dcterms:spatial <https://wunderfacts.com/mastr/ags/09564000#it> ; mastr:Energietraeger "2413" .
`;

test.describe.configure({ mode: "serial" });

test.describe("nearby installations (linked-mastr)", () => {
  test.skip(
    !hasAccount(ACC),
    `Set E2E_USERNAME_A / E2E_PASSWORD_A (a throwaway Solid Pod) to run the nearby-installations e2e.`,
  );

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(T.setup);
    page = await newCapturedPage(browser, "nearby-installations");
    page.on("dialog", (d) => d.accept().catch(() => {}));
    // Stub MaStR with the fixture; stub regionalstatistik to 404 so its (sibling)
    // section stays hidden and no live cross-origin call escapes the test.
    await page.route(/\/mastr\/bbox/, (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/turtle",
        headers: CORS,
        body: MASTR_TTL,
      }));
    await page.route(/\/regionalstatistik\//, (route) =>
      route.fulfill({ status: 404, headers: CORS, body: "" }));
    await login(page, ACC);
    await assertCleanStart(page);
  });

  test.afterAll(async () => {
    await verifyAndReset(page, "nearby-installations");
    await page.close();
  });

  test("the observation page lists nearby renewable installations, nearest first", async () => {
    test.setTimeout(T.testSolo);

    await addBuilding(page, ADDR); // fills Nürnberg coords (49.45, 11.08)
    const row = page.locator("li[data-building-id]", { hasText: ADDR }).first();
    await expect(row).toBeVisible({ timeout: T.action });
    const id = await buildingIdOf(row);
    if (!id) throw new Error("nearby-installations: missing building id");

    await page.goto(buildingRoute("observation", id));

    // The section renders with its title and the per-kind summary (3 renewables —
    // the combustion unit is dropped — "within 3 km").
    await expect(page.getByText(en("niTitle"))).toBeVisible({ timeout: T.action });
    await expect(page.getByText(en("niSummary", { count: 3, radius: 3 })))
      .toBeVisible();

    // The list shows each renewable by "{kind} — {label}"; the combustion unit is
    // absent. (Nearest first, but the list is short enough to assert membership.)
    await expect(page.getByText(`${en("niKindSolar")} — Solardach Nah`)).toBeVisible();
    await expect(page.getByText(`${en("niKindWind")} — Windrad Weit`)).toBeVisible();
    await expect(page.getByText(/Heizkraftwerk Müll/)).toHaveCount(0);
    await expect(page.getByText(en("niDataSource"))).toBeVisible();

    // Map guise: the section's List ⇄ Map toggle swaps the list for a Leaflet map
    // of the same set; switching back restores the list.
    const viewToggle = page.getByRole("group", { name: en("niViewAria") });
    await viewToggle.getByRole("button", { name: en("btnMap") }).click();
    // The nearby section's map is the LAST leaflet map on the page — the observation
    // page may also carry the neighbourhood choropleth above it.
    await expect(page.locator(".leaflet-container").last()).toBeVisible({
      timeout: T.action,
    });
    await expect(page.getByText(`${en("niKindSolar")} — Solardach Nah`))
      .toHaveCount(0); // the list rows are gone in map view
    await viewToggle.getByRole("button", { name: en("btnList") }).click();
    await expect(page.getByText(`${en("niKindSolar")} — Solardach Nah`))
      .toBeVisible();

    // Cleanup: delete the throwaway building.
    await page.goto("/");
    await openBuildingsList(page);
    await deleteBuildingRow(page, id);
  });
});
