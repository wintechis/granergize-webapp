import { expect, type Page, test } from "@playwright/test";
import { t } from "../helpers/i18n.ts";
import { account, hasAccount, login } from "../helpers/login.ts";
import { newCapturedPage } from "../helpers/consoleLog.ts";
import { assertCleanStart, verifyAndReset } from "../helpers/cleanSlate.ts";
import { ensureDemoBuildings } from "../helpers/seed.ts";
import { openObservationsView } from "../helpers/manage.ts";
import { T } from "../helpers/timeouts.ts";

/**
 * Competency-question e2e for the cube's **pivot** guise — the Observations finder's
 * "Pivot" view (`?view=pivot`, row level `?rows=`, drill scope `?in=`;
 * `src/services/cube/pivot.ts` + `observationsAxes.ts`).
 *
 * CQ "How do my figures compare, rolled up a feature level?" → the pivot renders a
 * rows × years grid whose row level the user picks: buildings (the finest grain), or
 * their Gemeinde/Kreis/Land/Bund roll-up (Ø over the region's buildings). A
 * building-level cell drills into that building's `/observation` page, like the
 * over-time matrix's cells.
 *
 * Seed: the standard investor demo (`ensureDemoBuildings`) — multi-year annual
 * buildings, so the grid has rows × ≥2 year columns. Whether the demo buildings carry
 * a `regionAgs` depends on the geocoder at seed time, so at a region level the first
 * test accepts named region rows AND the "Without a region" bucket — both render region
 * (role=img) cells. The grid maths and the drill/scope axes are proved in
 * `pivot.test.ts`; this is the UI proof the grid renders, re-levels, and drills.
 *
 * The SECOND test covers the pivot's **drill-across** — the trailing "Official
 * statistics" section (`cube/regionalCells.ts`): external `qb:` cells from
 * linked-regionalstatistik rendered beside the live grid at a Kreis row level. Its
 * inputs are pinned with fixtures (the wrapper is an external host): the lau
 * `/contains` region lookup so every seeded building lands in ONE Kreis (09574), and
 * that Kreis's cube table. The other Kreis tables are left to 404 — a failing table
 * must simply be absent from the section, never sink it.
 *
 * The THIRD test covers the property axis's rollup rung — the derived `energyTotal`
 * pseudo-metric (electricity + heat, `energy/energyMetric.ts`): selecting it on the
 * measure axis writes `?m=energyTotal` and the grid's cells carry its label, so the
 * total is a labelled cell like any other (never an unexplained figure).
 *
 *   # tier 3 (local CSS, no creds):
 *   deno task e2e:local test/e2e/solo/cube-pivot.spec.ts
 *   # tier 4 (real Pods):
 *   source test/.env.e2e.local && deno task e2e:remote:spec test/e2e/solo/cube-pivot.spec.ts
 *
 * Runs against Alice (account A). Skipped without creds.
 */

const ACC = account("A"); // Alice -- solo specs use one account
const CORS = { "access-control-allow-origin": "*" };

// The Kreis every seeded building is geocoded into: Landkreis Roth (Bavaria). The
// stubbed lau `/contains` serves its 8-digit Gemeinde AGS, which the pivot slices to
// the 5-digit Kreis prefix for the `rows=kreis` row key.
const KREIS_AGS = "09574";
const GEMEINDE_AGS = "09574000";
const LAU_CONTAINS_TTL = `
@prefix skos: <http://www.w3.org/2004/02/skos/core#> .
@prefix lau: <https://wunderfacts.com/lau/lau/> .
lau:DE_${GEMEINDE_AGS} a skos:Concept ; skos:notation "DE_${GEMEINDE_AGS}" ;
  skos:prefLabel "Roth"@de .
`;

// The stored region reference is the LAU **concept** (`dcterms:spatial`), not the bare
// AGS — every region join dereferences it for its `dcterms:identifier`. So the concept
// document is stubbed too, else a loaded building has no resolvable region.
const LAU_CONCEPT_TTL = `
@prefix skos: <http://www.w3.org/2004/02/skos/core#> .
@prefix dcterms: <http://purl.org/dc/terms/> .
<https://wunderfacts.com/lau/lau/DE_${GEMEINDE_AGS}#it> a skos:Concept ;
  dcterms:identifier "${GEMEINDE_AGS}" ; skos:prefLabel "Roth"@de .
`;

// The Kreis-grain cube (43531-01-02-4, industrial energy use): the geo dimension is
// #dim-DINSG → cl/DINSG#{ags} and the carrier dimension #dim-ENRNW1 is pinned by the
// app to ENRGTRNW4 (renewable). Two years inside the demo's 2022–2024 columns, plus a
// decoy carrier row the selector must exclude.
const KREIS_UNIT = "Tsd. MJ";
const KREIS_CUBE_TTL = `
@prefix qb: <http://purl.org/linked-data/cube#> .
@prefix ds: <https://wunderfacts.com/regionalstatistik/ds/43531-01-02-4#> .
@prefix dinsg: <https://wunderfacts.com/regionalstatistik/cl/DINSG#> .
@prefix enr: <https://wunderfacts.com/regionalstatistik/cl/ENRNW1#> .
<#k1> a qb:Observation ;
  ds:dim-DINSG dinsg:${KREIS_AGS} ; ds:dim-ENRNW1 enr:ENRGTRNW4 ;
  ds:dim-TIME_PERIOD "2023" ; ds:measure-OBS_VALUE 1100 ; ds:unit "${KREIS_UNIT}" .
<#k2> a qb:Observation ;
  ds:dim-DINSG dinsg:${KREIS_AGS} ; ds:dim-ENRNW1 enr:ENRGTRNW4 ;
  ds:dim-TIME_PERIOD "2024" ; ds:measure-OBS_VALUE 1234 ; ds:unit "${KREIS_UNIT}" .
<#k3> a qb:Observation ;
  ds:dim-DINSG dinsg:${KREIS_AGS} ; ds:dim-ENRNW1 enr:ENRGTRNW2 ;
  ds:dim-TIME_PERIOD "2024" ; ds:measure-OBS_VALUE 9999 ; ds:unit "${KREIS_UNIT}" .
`;

/** Escape a catalog string for use inside a locator RegExp (labels differ per
 *  `E2E_LANG` and may carry regex metacharacters, e.g. the French apostrophes). */
const rx = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

test.describe.configure({ mode: "serial" });

test.describe("cube pivot (feature-ladder roll-up)", () => {
  test.skip(
    !hasAccount(ACC),
    `Set WEBID_A_USERNAME / WEBID_A_PASSWORD (a throwaway Solid Pod) to run the cube-pivot e2e.`,
  );

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(T.setup);
    page = await newCapturedPage(browser, "cube-pivot");
    // Pin the two external inputs of the drill-across section BEFORE the seed geocodes:
    // the region lookup (so every demo building carries the same Kreis) and the Kreis
    // cube table. Registered after page creation, so they win over the lane's stubs.
    await page.route(/\/lau\/contains/, (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/turtle",
        headers: CORS,
        body: LAU_CONTAINS_TTL,
      }));
    await page.route(/\/lau\/lau\/DE_/, (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/turtle",
        headers: CORS,
        body: LAU_CONCEPT_TTL,
      }));
    await page.route(/\/regionalstatistik\/data\/43531-01-02-4/, (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/turtle",
        headers: CORS,
        body: KREIS_CUBE_TTL,
      }));
    await login(page, ACC);
    await assertCleanStart(page);
    await ensureDemoBuildings(page);
  });

  test.afterAll(async () => {
    await verifyAndReset(page, "cube-pivot");
    await page.close();
  });

  test("the pivot renders building rows, rolls up to a region level, and a cell drills into the observation", async () => {
    test.setTimeout(T.testSolo);
    await page.goto("/");

    await openObservationsView(page, "pivot");

    // Building level (the default): each (building, year) cell is a role=button with
    // an aria-label "<name> — <metric> <year>: …". The bulk energy cube loads through
    // the buildings query, so retry until at least one cell has rendered.
    const cells = page.getByRole("button", { name: /—\s.*\d{4}\s*:/ });
    await expect(async () => {
      expect(await cells.count()).toBeGreaterThan(0);
    }).toPass({ timeout: T.poll, intervals: [1_500] });

    // The multi-year demo yields ≥1 populated cell (a numeric value, not the
    // no-data label).
    const valueCells = page.getByRole("button", {
      name: new RegExp(`—\\s.*\\d{4}\\s*:.*(?!${t("lensBandNoData")})\\d`),
    });
    await expect(valueCells.first()).toBeVisible({ timeout: T.action });

    // Roll up: pick the Land level. Region cells are labelled graphics (role=img),
    // not buttons — a roll-up is not a resource to open. The demo set appears either
    // under its geocoded Länder or in the "Without a region" bucket; both are rows.
    await page
      .getByRole("combobox", { name: t("pivotRowsLabel") })
      .click();
    await page
      .getByRole("option", { name: t("choroplethLevelLand"), exact: true })
      .click();
    await expect(page).toHaveURL(/rows=land/, { timeout: T.action });
    const regionCells = page.getByRole("img", { name: /—\s.*\d{4}\s*:/ });
    await expect(async () => {
      expect(await regionCells.count()).toBeGreaterThan(0);
    }).toPass({ timeout: T.poll, intervals: [1_500] });

    // Back at the finest grain, a populated cell hands off to that building's
    // OBSERVATION (energy) page — the same drill the over-time matrix does.
    await page
      .getByRole("combobox", { name: t("pivotRowsLabel") })
      .click();
    await page
      .getByRole("option", { name: t("pivotRowsBuilding"), exact: true })
      .click();
    await expect(valueCells.first()).toBeVisible({ timeout: T.action });
    await valueCells.first().click();
    await expect(page).toHaveURL(/\/observation\?/, { timeout: T.action });
  });

  test("at a Kreis row level the pivot carries the official-statistics rows, and drops them at building level", async () => {
    test.setTimeout(T.testSolo);
    await page.goto("/");
    await openObservationsView(page, "pivot");

    // Roll up to the Kreis level — the grain the external cube publishes, so the two
    // cubes meet there (a building level has no counterpart).
    await page.getByRole("combobox", { name: t("pivotRowsLabel") }).click();
    await page
      .getByRole("option", { name: t("choroplethLevelKreis"), exact: true })
      .click();
    await expect(page).toHaveURL(/rows=kreis/, { timeout: T.action });

    // The trailing section: one labelled row per (Kreis, indicator), naming the
    // indicator and ITS unit — not the grid's selected metric.
    await expect(page.getByText(t("pivotOfficial"))).toBeVisible({ timeout: T.poll });
    await expect(
      page.getByText(
        t("pivotOfficialRow", {
          region: KREIS_AGS,
          indicator: t("regKreisRenewableUse"),
          unit: KREIS_UNIT,
        }),
      ),
    ).toBeVisible();

    // The cells are labelled graphics (no drill), each stating the full coordinate +
    // figure + unit. The decoy carrier row (9999) is excluded by the table's selector.
    const cell = page.getByRole("img", {
      name: new RegExp(
        `${rx(t("regKreisRenewableUse"))}\\s+2024\\s*:\\s*1[.,\\s]?234\\s*${rx(KREIS_UNIT)}`,
      ),
    });
    await expect(cell).toHaveCount(1);
    await expect(page.getByRole("img", { name: /9\W?999/ })).toHaveCount(0);

    // Provenance: the statistical offices are cited under the section.
    await expect(page.getByText(t("regDataSource"))).toBeVisible();

    // Back at building level the two cubes no longer meet — the section is gone
    // (no approximation of a Kreis figure onto a building row).
    await page.getByRole("combobox", { name: t("pivotRowsLabel") }).click();
    await page
      .getByRole("option", { name: t("pivotRowsBuilding"), exact: true })
      .click();
    // (`building` is the default level, so it leaves no `rows=` param behind.)
    await expect(page).not.toHaveURL(/rows=kreis/, { timeout: T.action });
    await expect(page.getByRole("button", { name: /—\s.*\d{4}\s*:/ }).first())
      .toBeVisible({ timeout: T.action });
    await expect(page.getByText(t("pivotOfficial"))).toHaveCount(0);
  });

  test("the derived total is selectable on ?m= and labels its cells", async () => {
    test.setTimeout(T.testSolo);
    await page.goto("/");
    await openObservationsView(page, "pivot");

    // The property ladder's rollup rung, restored as a LABELLED pseudo-metric: pick
    // "Total energy (electricity + heat)" from the same measure-axis selector every
    // other metric uses.
    const metricSelect = page.getByRole("combobox", { name: t("metricSelectLabel") });
    await metricSelect.click();
    await page
      .getByRole("option", { name: t("metricEnergyTotal"), exact: true })
      .click();
    // It is a first-class value of the measure axis (shareable, reload-proof).
    await expect.poll(() => new URL(page.url()).searchParams.get("m"), {
      timeout: T.action,
    }).toBe("energyTotal");
    await expect(metricSelect)
      .toHaveText(new RegExp(rx(t("metricEnergyTotal"))), { timeout: T.action });

    // …and the grid's cells NAME it — a total is never an unexplained figure. At least
    // one carries a per-m² value (the demo buildings carry electricity and/or heat).
    const totalCells = page.getByRole("button", {
      name: new RegExp(`—\\s*${rx(t("metricEnergyTotal"))}\\s+\\d{4}\\s*:\\s*\\d`),
    });
    await expect(async () => {
      expect(await totalCells.count()).toBeGreaterThan(0);
    }).toPass({ timeout: T.poll, intervals: [1_500] });
  });
});
