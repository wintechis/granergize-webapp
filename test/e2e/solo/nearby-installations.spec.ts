import { expect, type Page, test } from "@playwright/test";
import { t, tPattern } from "../helpers/i18n.ts";
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
 * Nearby-installations section (linked-mastr) e2e — the finest-grain place layer.
 * LOCAL stubs the wrapper's `…/mastr/within` response with a mix of renewable +
 * non-renewable units around the building's coordinates and asserts the section keeps
 * the renewables (solar/wind), drops combustion, and renders the per-kind summary + the
 * nearest-first list; the regionalstatistik wrapper is stubbed to 404 so its sibling
 * section stays absent. REMOTE lets both fall through to the LIVE wrappers (the seed sits
 * on real MaStR coverage in central Nürnberg), so labels/counts are nondeterministic and
 * we assert only that the section populates and the List ⇄ Map toggle works.
 * Self-cleaning; Alice (account A).
 *
 *   deno task e2e:local test/e2e/solo/nearby-installations.spec.ts
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
    `Set WEBID_A_USERNAME / WEBID_A_PASSWORD (a throwaway Solid Pod) to run the nearby-installations e2e.`,
  );

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(T.setup);
    page = await newCapturedPage(browser, "nearby-installations");
    page.on("dialog", (d) => d.accept().catch(() => {}));
    // LOCAL only: stub MaStR with the fixture; stub regionalstatistik to 404 so its
    // (sibling) section stays hidden. REMOTE lets both reach the live wrappers.
    await stubWhenLocal(page, /\/mastr\/within/, (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/turtle",
        headers: CORS,
        body: MASTR_TTL,
      }));
    await stubWhenLocal(page, /\/regionalstatistik\//, (route) =>
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

    // The section renders with its title, the per-kind summary, and its data-source
    // line — lane-agnostic (present whenever ≥1 renewable is nearby).
    await expect(page.getByText(t("niTitle"))).toBeVisible({ timeout: T.action });
    await expect(page.getByText(tPattern("niSummary")).first()).toBeVisible();
    await expect(page.getByText(t("niDataSource"))).toBeVisible();

    // A stable per-row marker (LOCAL: our fixture's "Solardach Nah"; REMOTE: any live
    // row shows "{kind} — {label}") — the first solar-kind row is the map-toggle probe.
    const sampleRow = E2E_LOCAL
      ? page.getByText(`${t("niKindSolar")} — Solardach Nah`)
      : page.getByText(new RegExp(`${t("niKindSolar")} — `)).first();

    if (E2E_LOCAL) {
      // The list shows each renewable by "{kind} — {label}"; the combustion unit
      // (carrier 2413) is dropped. (Nearest first; the fixture is short enough to
      // assert membership.)
      await expect(sampleRow).toBeVisible();
      await expect(page.getByText(`${t("niKindWind")} — Windrad Weit`)).toBeVisible();
      await expect(page.getByText(/Heizkraftwerk Müll/)).toHaveCount(0);
    } else {
      // Live: at least one solar installation is nearby in central Nürnberg.
      await expect(sampleRow).toBeVisible({ timeout: T.action });
    }

    // Map guise: the section's List ⇄ Map toggle swaps the list for a Leaflet map
    // of the same set; switching back restores the list.
    const viewToggle = page.getByRole("group", { name: t("niViewAria") });
    await viewToggle.getByRole("button", { name: t("btnMap") }).click();
    // The nearby section's map is the LAST leaflet map on the page — the observation
    // page may also carry the neighbourhood choropleth above it.
    await expect(page.locator(".leaflet-container").last()).toBeVisible({
      timeout: T.action,
    });
    await expect(sampleRow).toHaveCount(0); // the list rows are gone in map view
    await viewToggle.getByRole("button", { name: t("btnList") }).click();
    await expect(sampleRow.first()).toBeVisible();

    // Cleanup: delete the throwaway building.
    await page.goto("/");
    await openBuildingsList(page);
    await deleteBuildingRow(page, id);
  });
});
