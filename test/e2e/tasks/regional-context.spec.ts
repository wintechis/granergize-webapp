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
 * Regional-context section (linked-regionalstatistik) e2e. The wrapper is an
 * EXTERNAL host, so this STUBS its `…/data/{tableId}` cube response (the way
 * building-page stubs the external DOP20c WMS) and asserts the section renders
 * the Bundesland renewable-share figure. Self-cleaning; Alice (account A).
 *
 *   deno task e2e:local test/e2e/tasks/regional-context.spec.ts
 */

const ADDR = "Regional Context E2E Strasse 1";
const ACC = account("A");

// Fixture cube: one renewable-electricity-share observation for Bayern (ags/09).
// The dimension/measure predicates are table-scoped (matched by suffix); the geo
// dimension points at …/ags/09 (Bayern), which the building's region resolves to.
const CUBE_TTL = `
@prefix qb: <http://purl.org/linked-data/cube#> .
@prefix ds: <https://wunderfacts.com/regionalstatistik/ds/86251-Z-02#> .
@prefix ags: <https://wunderfacts.com/regionalstatistik/ags/> .
<#o1> a qb:Observation ;
  ds:dim-geo ags:09 ; ds:dim-TIME_PERIOD "2023" ;
  ds:measure-OBS_VALUE 61.5 ; ds:unit "Prozent" .
`;

test.describe.configure({ mode: "serial" });

test.describe("regional context (linked-regionalstatistik)", () => {
  test.skip(
    !hasAccount(ACC),
    `Set E2E_USERNAME_A / E2E_PASSWORD_A (a throwaway Solid Pod) to run the regional-context e2e.`,
  );

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(T.setup);
    page = await newCapturedPage(browser, "regional-context");
    page.on("dialog", (d) => d.accept().catch(() => {}));
    // Stub the external cube. The Tier-3 build points at the absolute wunderfacts
    // host (.env.production), so intercept that path and return the fixture +
    // permissive CORS so the mocked cross-origin response isn't blocked.
    await page.route(/\/regionalstatistik\/data\//, (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/turtle",
        headers: { "access-control-allow-origin": "*" },
        body: CUBE_TTL,
      }));
    await login(page, ACC);
    await assertCleanStart(page);
  });

  test.afterAll(async () => {
    await verifyAndReset(page, "regional-context");
    await page.close();
  });

  test("the observation page shows the Bundesland renewable-share figure", async () => {
    test.setTimeout(T.testSolo);

    await addBuilding(page, ADDR); // the helper fills region "Bayern"
    const row = page.locator("li[data-building-id]", { hasText: ADDR }).first();
    await expect(row).toBeVisible({ timeout: T.action });
    const id = await buildingIdOf(row);
    if (!id) throw new Error("regional-context: missing building id");

    // The observation page renders the standalone Regional-context section even
    // with no energy data (it's about the building's region, like weather).
    await page.goto(buildingRoute("observation", id));
    await expect(page.getByText(en("regContextTitle", { region: "Bayern" })))
      .toBeVisible({ timeout: T.action });
    // The metric's table: a column header (the metric label) + the year/value
    // cells, and the human data-source attribution beneath it.
    await expect(page.getByText(en("regRenewableShare"))).toBeVisible();
    await expect(page.getByRole("cell", { name: "2023" })).toBeVisible();
    await expect(page.getByRole("cell", { name: /61\.5\s*%/ })).toBeVisible();
    await expect(page.getByText(en("regDataSource"))).toBeVisible();

    // Cleanup: delete the throwaway building.
    await page.goto("/");
    await openBuildingsList(page);
    await deleteBuildingRow(page, id);
  });
});
