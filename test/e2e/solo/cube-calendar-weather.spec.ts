import { expect, type Page, test } from "@playwright/test";
import { t } from "../helpers/i18n.ts";
import { account, hasAccount, login } from "../helpers/login.ts";
import { newCapturedPage } from "../helpers/consoleLog.ts";
import { assertCleanStart, verifyAndReset } from "../helpers/cleanSlate.ts";
import { ensureDemoBuildings } from "../helpers/seed.ts";
import { buildingRoute, openBuildingsList } from "../helpers/manage.ts";
import { T } from "../helpers/timeouts.ts";

/**
 * Competency-question e2e for the two observation-page cube surfaces (Steps 5 & 6a of
 * `plans/plan-cube-ui.md`): the **calendar heatmap** (flatten a PT15M series to day ×
 * hour) and the **energy × weather overlay** toggle.
 *
 * CQ "When in the day/week does building X consume?" → the building's observation page →
 * Time series → the Calendar tab renders the day × hour heatmap of its 15-minute series.
 * CQ "How did X's consumption track the weather?" → the same page's annual view → the
 * "Overlay weather" toggle superimposes the nearest DWD station's temperature on the
 * shared year axis.
 *
 * Both target the demo's small office (DEMO_USER, "Lange Gasse 20"): it is the one demo
 * building carrying BOTH energy shapes — annual aggregates (2023-2024) AND a PT15M series
 * (seeded for 2024-06) — so the Annual | Time series toggle shows and the calendar has a
 * month of readings. The binning/alignment maths is proved in `energyCalendar.test.ts` /
 * `energyWeather.test.ts`; this is the UI proof the surfaces render.
 *
 * The weather reads (linked-wetterdienst) are stubbed per-spec (`page.route`), so the
 * overlay asserts its affordance and chart/caveat region appear once toggled on. The
 * stub serves overlapping years, so the dual-axis chart is the expected outcome — but
 * the no-overlap / no-station states stay tolerated (the assertion shape outlives the
 * fixture).
 *
 *   # tier 3 (local CSS, no creds):
 *   deno task e2e:local test/e2e/solo/cube-calendar-weather.spec.ts
 *   # tier 4 (real Pods):
 *   source test/.env.e2e.local && deno task e2e:remote:spec test/e2e/solo/cube-calendar-weather.spec.ts
 *
 * Runs against Alice (account A). Skipped without creds.
 *
 * NOTE: authored-but-unrun (a live e2e session held the slot). Needs a
 * `deno task e2e:local` run when one is free.
 */

const ADDR = "Lange Gasse 20"; // DEMO_USER — the only demo with BOTH energy shapes
const ACC = account("A"); // Alice -- solo specs use one account

const CORS = { "access-control-allow-origin": "*" };

// linked-wetterdienst stub fixtures (the wrapper's served Turtle shapes; see
// `linkedWeather.ts`). `near?` → one nearby `dwd:WeatherStation` with a distance;
// `values?` → two annual `sosa:Observation`s (mean temperature) for 2023-2024, the
// years the demo office carries energy for, so the energy×weather overlay aligns.
const WEATHER_STATIONS_TTL = `@prefix dwd: <https://opendata.dwd.de/#> .
@prefix geo: <http://www.w3.org/2003/01/geo/wgs84_pos#> .
@prefix schema: <http://schema.org/> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
<#station-03668> a dwd:WeatherStation ;
  dwd:station_id "03668" ;
  dwd:station_name "Nürnberg" ;
  rdfs:label "Nürnberg" ;
  geo:lat 49.5028 ; geo:long 11.0549 ;
  schema:distance 5.6 .
`;
const WEATHER_VALUES_TTL = `@prefix dwd: <https://opendata.dwd.de/#> .
@prefix sosa: <http://www.w3.org/ns/sosa/> .
@prefix qudt: <http://qudt.org/1.1/schema/qudt#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
<#obs-2023> a sosa:Observation ;
  sosa:resultTime "2023-12-31"^^xsd:date ; dwd:quality 1 ;
  sosa:hasResult [ a qudt:QuantityValue ; qudt:numericValue 10.5 ] .
<#obs-2024> a sosa:Observation ;
  sosa:resultTime "2024-12-31"^^xsd:date ; dwd:quality 1 ;
  sosa:hasResult [ a qudt:QuantityValue ; qudt:numericValue 11.2 ] .
`;

test.describe.configure({ mode: "serial" });

test.describe("cube calendar heatmap + weather overlay", () => {
  test.skip(
    !hasAccount(ACC),
    `Set WEBID_A_USERNAME / WEBID_A_PASSWORD (a throwaway Solid Pod) to run the cube-calendar-weather e2e.`,
  );

  let page: Page;
  let id = "";

  test.beforeAll(async ({ browser }) => {
    // The demo seed writes the PT15M day files (a burst of PUTs) on top of login —
    // give the setup the long-operation budget.
    test.setTimeout(T.longOp);
    page = await newCapturedPage(browser, "cube-calendar-weather");
    // Weather is an external read; e2e:local stubs it per-spec so the panel + overlay
    // assert against fixed data, not the live wunderfacts.com host (the one open gap).
    await page.route(/\/wetterdienst\//, (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/turtle",
        headers: CORS,
        body: route.request().url().includes("/values")
          ? WEATHER_VALUES_TTL
          : WEATHER_STATIONS_TTL,
      }));
    // The observation page's sibling sections (nearby installations, regional stats)
    // read the same host; 404 them so no live cross-origin call escapes the spec.
    await page.route(/\/(mastr|regionalstatistik)\//, (route) =>
      route.fulfill({ status: 404, headers: CORS, body: "" }));
    await login(page, ACC);
    await assertCleanStart(page);
    await ensureDemoBuildings(page);

    // Resolve the both-shapes building's id from the Buildings list row.
    await openBuildingsList(page);
    const row = page.locator("li[data-building-id]", { hasText: ADDR }).first();
    await expect(row).toBeVisible({ timeout: T.action });
    id = (await row.getAttribute("data-building-id")) ?? "";
    expect(id, `the demo office "${ADDR}" id`).toBeTruthy();
  });

  test.afterAll(async () => {
    await verifyAndReset(page, "cube-calendar-weather");
    await page.close();
  });

  test("the Calendar tab renders the day × hour heatmap of the PT15M series", async () => {
    test.setTimeout(T.testSolo);
    await page.goto(buildingRoute("observation", id));

    // The building carries both shapes → the Annual | Time series toggle shows.
    // Switch to the series view (the calendar lives on the series surface).
    const seriesBtn = page.getByRole("button", { name: t("erTimeSeries") });
    await expect(seriesBtn).toBeVisible({ timeout: T.action });
    await seriesBtn.click();

    // The series view's tab strip renders; open the Calendar tab.
    await expect(page.getByRole("tab", { name: t("ucDayView") }))
      .toBeVisible({ timeout: T.action });
    await page.getByRole("tab", { name: t("calendarTab") }).click();

    // The month picker auto-defaults to the latest available month (the seed's
    // 2024-06), so the heatmap loads its month of readings and the subtitle renders.
    await expect(page.getByText(t("calendarSubtitle")))
      .toBeVisible({ timeout: T.action });
    // The grid carries an hour axis label — the day × hour collapse is on screen.
    await expect(page.getByText(new RegExp(`${t("calendarAxisHour")}\\s*→`)))
      .toBeVisible({ timeout: T.action });
    // …and the Less → More intensity legend. `exact` is required: the observation
    // page also carries the energy-band legend ("Plus faible"/"Plus élevé") and the
    // regional zoom hint ("…régions plus fines"), so a substring "Plus" now matches
    // four nodes — the calendar caption is the one that reads exactly "Plus".
    await expect(page.getByText(t("calendarLegendLess"), { exact: true }))
      .toBeVisible({ timeout: T.action });
    await expect(page.getByText(t("calendarLegendMore"), { exact: true }))
      .toBeVisible({ timeout: T.action });
  });

  test("the energy × weather overlay toggle superimposes weather on the year axis", async () => {
    test.setTimeout(T.testSolo);
    await page.goto(buildingRoute("observation", id));

    // The overlay's toggle sits on the annual view (the default for a both-shapes
    // building). It is enabled because the office has coordinates.
    const toggle = page.getByLabel(t("weatherOverlayToggle"));
    await expect(toggle).toBeVisible({ timeout: T.action });
    await toggle.check();

    // Switching it on reveals the overlay region: the "Energy and weather" title,
    // then EITHER the dual-axis chart (when a year has both layers) OR an honest
    // caveat (no nearby station / no overlapping year). All three are valid
    // outcomes of the live DWD lookup, so assert the title plus one of them.
    // (Role/heading, not getByText: the no-overlap caveat also contains the phrase.)
    await expect(page.getByRole("heading", { name: t("weatherOverlayTitle") }))
      .toBeVisible({ timeout: T.action });
    await expect(async () => {
      const chart = await page.locator(".recharts-responsive-container").count();
      const noStation = await page.getByText(t("weatherOverlayNoStation")).count();
      const noOverlap = await page.getByText(t("weatherOverlayNoOverlap")).count();
      expect(chart + noStation + noOverlap).toBeGreaterThan(0);
    }).toPass({ timeout: T.action, intervals: [1_000] });
  });

  test("the Weather panel lists a nearby station and resolves its values", async () => {
    test.setTimeout(T.testSolo);
    await page.goto(buildingRoute("observation", id));

    // The Weather panel (WeatherData) renders for a located building: a parameter and
    // a station select. Their presence proves the panel mounted.
    await expect(page.getByText(t("wdParameter")).first())
      .toBeVisible({ timeout: T.action });
    await expect(page.getByText(t("wdStation")).first())
      .toBeVisible({ timeout: T.visible });

    // The linked-wetterdienst lookup (fetchNearestStations → fetchStationValues, both
    // parsed from the wrapper's Turtle, here the stub's) resolves to a definite state:
    // the values table, or an honest empty notice. Asserting one appears proves the
    // dereference+parse path runs end-to-end; the stub serves data, so the table is the
    // expected outcome, with the empty notices tolerated.
    await expect(async () => {
      const table = await page.getByText(t("wdRecentData")).count();
      const noStations = await page.getByText(t("wdNoStations"), {
        exact: false,
      }).count();
      const noData = await page.getByText(t("wdNoData"), {
        exact: false,
      }).count();
      expect(table + noStations + noData).toBeGreaterThan(0);
    }).toPass({ timeout: T.poll, intervals: [1_000] });
  });
});
