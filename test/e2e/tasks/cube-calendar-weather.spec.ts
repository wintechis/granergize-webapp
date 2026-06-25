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
 * The weather overlay calls the live DWD adapter, so the spec asserts the overlay's
 * affordance and chart/caveat region appear once toggled on — not specific temperatures
 * (which depend on a live external service). The no-overlap / no-station states are
 * tolerated as valid outcomes of the toggle.
 *
 *   # tier 3 (local CSS, no creds):
 *   deno task e2e:local test/e2e/tasks/cube-calendar-weather.spec.ts
 *   # tier 4 (real Pods):
 *   source test/.env.e2e.local && deno task e2e:remote:spec test/e2e/tasks/cube-calendar-weather.spec.ts
 *
 * Runs against Alice (account A). Skipped without creds.
 *
 * NOTE: authored-but-unrun (a live e2e session held the slot). Needs a
 * `deno task e2e:local` run when one is free.
 */

const ADDR = "Lange Gasse 20"; // DEMO_USER — the only demo with BOTH energy shapes
const ACC = account("A"); // Alice -- solo specs use one account

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

    // The live linked-wetterdienst lookup (fetchNearestStations → fetchStationValues,
    // both parsed from the wrapper's Turtle) resolves to a definite state: the values
    // table, or an honest empty notice. Asserting one appears proves the
    // dereference+parse path runs end-to-end against the wrapper (specific values
    // depend on a live external service, so are not asserted).
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
