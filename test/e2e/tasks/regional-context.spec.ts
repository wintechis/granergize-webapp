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
 * Regional-context section (linked-regionalstatistik) e2e. The wrappers are
 * EXTERNAL hosts, so this STUBS their responses (the way building-page stubs the
 * external DOP20c WMS) and asserts the section renders BOTH grains:
 *   - the **Bundesland** renewable-share figure (table 86251-Z-02, from the
 *     building's region "Bayern" → ags 09), and
 *   - the **Kreis** renewable-energy figure (table 43531-01-02-4, carrier pinned
 *     to "Erneuerbare Energien"), whose Kreis is reverse-geocoded from the nearby
 *     MaStR units (also stubbed) and whose NAME comes from the cl/geo codelist.
 *
 * The Kreis is a LANDKREIS — `09574` (Roth) — deliberately a code that sits beyond
 * the real wrapper's ~100-concept `cl/geo` page, the exact case that surfaced the
 * truncation bug (figures showed a bare AGS instead of the district name). The
 * second test pins the DEGRADED path: when the codelist does NOT carry the Kreis
 * (mirroring the truncation), the data still renders but the caption falls back to
 * the bare AGS — proving the section degrades gracefully rather than breaking.
 * Self-cleaning; Alice (account A).
 *
 *   deno task e2e:local test/e2e/tasks/regional-context.spec.ts
 */

const ADDR = "Regional Context E2E Strasse 1";
const ACC = account("A");
const CORS = { "access-control-allow-origin": "*" };

// The building's reverse-geocoded Kreis: Landkreis Roth (Bavaria).
const KREIS_AGS = "09574";
const KREIS_NAME = "Roth, Landkreis";

// Bundesland cube: one renewable-electricity-share observation for Bayern (ags/09).
// The dimension/measure predicates are table-scoped (matched by suffix); the geo
// dimension points at …/ags/09 (Bayern), which the building's region resolves to.
const LAND_CUBE_TTL = `
@prefix qb: <http://purl.org/linked-data/cube#> .
@prefix ds: <https://wunderfacts.com/regionalstatistik/ds/86251-Z-02#> .
@prefix ags: <https://wunderfacts.com/regionalstatistik/ags/> .
<#o1> a qb:Observation ;
  ds:dim-geo ags:09 ; ds:dim-TIME_PERIOD "2023" ;
  ds:measure-OBS_VALUE 61.5 ; ds:unit "Prozent" .
`;

// Kreis cube (43531-01-02-4): a DIFFERENT geo dimension (#dim-DINSG → cl/DINSG#code)
// and an extra carrier dimension (#dim-ENRNW1) the app pins to ENRGTRNW4 (renewable
// energy). One row for Landkreis Roth (09574) with the renewable carrier; a decoy row
// for the same Kreis with a DIFFERENT carrier must be excluded by the selector.
const KREIS_CUBE_TTL = `
@prefix qb: <http://purl.org/linked-data/cube#> .
@prefix ds: <https://wunderfacts.com/regionalstatistik/ds/43531-01-02-4#> .
@prefix dinsg: <https://wunderfacts.com/regionalstatistik/cl/DINSG#> .
@prefix enr: <https://wunderfacts.com/regionalstatistik/cl/ENRNW1#> .
<#k1> a qb:Observation ;
  ds:dim-DINSG dinsg:09574 ; ds:dim-ENRNW1 enr:ENRGTRNW4 ;
  ds:dim-TIME_PERIOD "2024" ; ds:measure-OBS_VALUE 1234 ; ds:unit "Tsd. MJ" .
<#k2> a qb:Observation ;
  ds:dim-DINSG dinsg:09574 ; ds:dim-ENRNW1 enr:ENRGTRNW2 ;
  ds:dim-TIME_PERIOD "2024" ; ds:measure-OBS_VALUE 9999 ; ds:unit "Tsd. MJ" .
`;

// geo codelist: 09574 → the Kreis display name used in the Kreis caption.
const GEO_CL_TTL = `
@prefix skos: <http://www.w3.org/2004/02/skos/core#> .
@prefix ags: <https://wunderfacts.com/regionalstatistik/ags/> .
ags:09574 a skos:Concept ; skos:notation "09574" ;
  skos:prefLabel "Roth, Landkreis"@de .
`;

// The SAME codelist but WITHOUT the building's Kreis (09574) — mirrors the real
// wrapper truncating cl/geo at ~100 concepts, so this district is absent. A decoy
// concept keeps it non-empty (the codelist DID load, it just lacks 09574), so
// fetchKreisName returns null and the caller falls back to the bare AGS.
const GEO_CL_NO_KREIS_TTL = `
@prefix skos: <http://www.w3.org/2004/02/skos/core#> .
@prefix ags: <https://wunderfacts.com/regionalstatistik/ags/> .
ags:09563 a skos:Concept ; skos:notation "09563" ;
  skos:prefLabel "Weißenburg-Gunzenhausen, Landkreis"@de .
`;

// MaStR bbox: one renewable unit in Gemeinde 09574000 → Kreis 09574 (reverse-geocode).
const MASTR_TTL = `
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix geo: <http://www.w3.org/2003/01/geo/wgs84_pos#> .
@prefix dcterms: <http://purl.org/dc/terms/> .
@prefix mastr: <https://wunderfacts.com/mastr/mastr#> .
<https://wunderfacts.com/mastr/see/1#it> rdfs:label "Solardach" ;
  geo:lat 49.451 ; geo:long 11.081 ;
  dcterms:spatial <https://wunderfacts.com/mastr/ags/09574000#it> ;
  mastr:Energietraeger "2495" .
`;

test.describe.configure({ mode: "serial" });

test.describe("regional context (linked-regionalstatistik)", () => {
  test.skip(
    !hasAccount(ACC),
    `Set E2E_USERNAME_A / E2E_PASSWORD_A (a throwaway Solid Pod) to run the regional-context e2e.`,
  );

  let page: Page;
  let id = "";
  // Whether the stubbed cl/geo codelist carries the building's Kreis. The second
  // test flips this to false (then reloads to drop the session-cached codelist) to
  // exercise the bare-AGS fallback.
  let geoHasKreis = true;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(T.setup);
    page = await newCapturedPage(browser, "regional-context");
    page.on("dialog", (d) => d.accept().catch(() => {}));
    // Stub the external wrappers. The Tier-3 build points at the absolute
    // wunderfacts hosts (.env.production), so intercept those paths and return the
    // fixtures + permissive CORS so the mocked cross-origin responses aren't blocked.
    await page.route(/\/regionalstatistik\//, (route) => {
      const url = route.request().url();
      const body = url.includes("/data/86251-Z-02")
        ? LAND_CUBE_TTL
        : url.includes("/data/43531-01-02-4")
        ? KREIS_CUBE_TTL
        : url.includes("/cl/geo")
        ? (geoHasKreis ? GEO_CL_TTL : GEO_CL_NO_KREIS_TTL)
        : null;
      return body
        ? route.fulfill({ status: 200, contentType: "text/turtle", headers: CORS, body })
        : route.fulfill({ status: 404, headers: CORS, body: "" });
    });
    await page.route(/\/mastr\/bbox/, (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/turtle",
        headers: CORS,
        body: MASTR_TTL,
      }));
    await login(page, ACC);
    await assertCleanStart(page);
  });

  test.afterAll(async () => {
    await verifyAndReset(page, "regional-context");
    await page.close();
  });

  test("the observation page shows the Bundesland figure + the named Kreis figure", async () => {
    test.setTimeout(T.testSolo);

    await addBuilding(page, ADDR); // the helper fills region "Bayern" + Nürnberg coords
    const row = page.locator("li[data-building-id]", { hasText: ADDR }).first();
    await expect(row).toBeVisible({ timeout: T.action });
    const buildingId = await buildingIdOf(row);
    if (!buildingId) throw new Error("regional-context: missing building id");
    id = buildingId;

    // The observation page renders the standalone Regional-context section even
    // with no energy data (it's about the building's region, like weather).
    await page.goto(buildingRoute("observation", id));
    await expect(page.getByText(en("regContextTitle", { region: "Bayern" })))
      .toBeVisible({ timeout: T.action });

    // Bundesland grain: the renewable-share metric + its year/value + attribution.
    await expect(page.getByText(en("regRenewableShare"))).toBeVisible();
    await expect(page.getByRole("cell", { name: "2023" })).toBeVisible();
    await expect(page.getByRole("cell", { name: /61\.5\s*%/ })).toBeVisible();
    await expect(page.getByText(en("regDataSource"))).toBeVisible();

    // Kreis grain: the renewable-energy-use metric, joined via the building's Kreis
    // (reverse-geocoded from the stubbed MaStR unit → 09574). The decoy carrier row
    // (9999) must NOT appear; the Kreis caption carries the resolved Kreis NAME
    // (the codelist serves 09574 → "Roth, Landkreis").
    await expect(page.getByText(en("regKreisRenewableUse"))).toBeVisible({
      timeout: T.action,
    });
    await expect(page.getByRole("cell", { name: /1234\s*Tsd\. MJ/ })).toBeVisible();
    await expect(page.getByRole("cell", { name: /9999/ })).toHaveCount(0);
    await expect(
      page.getByText(en("regGeoCaptionKreis", { region: KREIS_NAME })),
    ).toBeVisible();
    // The bare AGS must NOT leak into the caption when the name resolved.
    await expect(
      page.getByText(en("regGeoCaptionKreis", { region: KREIS_AGS })),
    ).toHaveCount(0);
  });

  test("the Kreis caption falls back to the bare AGS when the codelist lacks it", async () => {
    test.setTimeout(T.testSolo);

    // Mirror the real wrapper truncating cl/geo so 09574 is ABSENT. A full reload
    // drops the session-cached codelist (the module-level `kreisNamesPromise` in
    // regionalCube.ts) + the React Query cache, so the section re-resolves the
    // Kreis name against the now-incomplete codelist and gets null.
    geoHasKreis = false;
    await page.reload();
    await page.goto(buildingRoute("observation", id));

    // The Kreis metric + figure STILL render — the data join is unaffected, only
    // the name lookup misses…
    await expect(page.getByText(en("regKreisRenewableUse"))).toBeVisible({
      timeout: T.action,
    });
    await expect(page.getByRole("cell", { name: /1234\s*Tsd\. MJ/ })).toBeVisible();
    // …so the caption degrades to the bare AGS, never the (now-unresolvable) name.
    await expect(
      page.getByText(en("regGeoCaptionKreis", { region: KREIS_AGS })),
    ).toBeVisible();
    await expect(
      page.getByText(en("regGeoCaptionKreis", { region: KREIS_NAME })),
    ).toHaveCount(0);

    // Cleanup: delete the throwaway building (it persisted from the first test).
    await page.goto("/");
    await openBuildingsList(page);
    await deleteBuildingRow(page, id);
  });
});
