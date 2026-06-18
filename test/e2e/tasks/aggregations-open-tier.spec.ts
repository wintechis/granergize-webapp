import { expect, type Page, test } from "@playwright/test";
import { en } from "../helpers/i18n.ts";
import { account, hasAccount, login } from "../helpers/login.ts";
import {
  addBuilding,
  buildingIdOf,
  deleteBuildingRow,
  openAggregations,
  openBuildingsList,
} from "../helpers/manage.ts";
import { newCapturedPage } from "../helpers/consoleLog.ts";
import { assertCleanStart, verifyAndReset } from "../helpers/cleanSlate.ts";
import { T } from "../helpers/timeouts.ts";

/**
 * The Aggregations finder's `open` source tier (public regionalstatistik
 * datasets, keyed to the regions of the user's buildings). The wrapper is an
 * EXTERNAL host, so this STUBS its `…/regionalstatistik/data/{table}` response
 * (mirroring regional-context.spec). A building in "Bayern" (the addBuilding
 * helper fills that region + Nürnberg coords) seeds one open dataset — renewable
 * electricity share for Bayern (table 86251-Z-02 → ags 09). The test asserts the
 * `open` tier toggle adds/removes the open row, and that opening it navigates to
 * the standalone read-only dataset page with the stubbed figure. Self-cleaning;
 * Alice (account A).
 *
 *   deno task e2e:local test/e2e/tasks/aggregations-open-tier.spec.ts
 */

const ADDR = "Open Tier E2E Strasse 1";
const ACC = account("A");
const CORS = { "access-control-allow-origin": "*" };

// Bundesland cube: one renewable-electricity-share observation for Bayern (ags/09),
// the region the building resolves to. Same shape as regional-context.spec.
const LAND_CUBE_TTL = `
@prefix qb: <http://purl.org/linked-data/cube#> .
@prefix ds: <https://wunderfacts.com/regionalstatistik/ds/86251-Z-02#> .
@prefix ags: <https://wunderfacts.com/regionalstatistik/ags/> .
<#o1> a qb:Observation ;
  ds:dim-geo ags:09 ; ds:dim-TIME_PERIOD "2023" ;
  ds:measure-OBS_VALUE 61.5 ; ds:unit "Prozent" .
`;

test.describe.configure({ mode: "serial" });

test.describe("aggregations open tier (regionalstatistik)", () => {
  test.skip(
    !hasAccount(ACC),
    `Set WEBID_A_USERNAME / WEBID_A_PASSWORD (a throwaway Solid Pod) to run the aggregations-open-tier e2e.`,
  );

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(T.setup);
    page = await newCapturedPage(browser, "aggregations-open-tier");
    page.on("dialog", (d) => d.accept().catch(() => {}));
    // Stub the external regionalstatistik wrapper: serve the Bayern cube for the
    // land table, 404 everything else (no live cross-origin call escapes).
    await page.route(/\/regionalstatistik\//, (route) => {
      const url = route.request().url();
      return url.includes("/data/86251-Z-02")
        ? route.fulfill({
          status: 200,
          contentType: "text/turtle",
          headers: CORS,
          body: LAND_CUBE_TTL,
        })
        : route.fulfill({ status: 404, headers: CORS, body: "" });
    });
    await login(page, ACC);
    await assertCleanStart(page);
  });

  test.afterAll(async () => {
    await verifyAndReset(page, "aggregations-open-tier");
    await page.close();
  });

  test("the open tier surfaces a regional dataset that opens its figures page", async () => {
    test.setTimeout(T.testSolo);

    // A building in Bayern seeds the open tier (region "Bayern" → ags 09).
    await addBuilding(page, ADDR);
    const row = page.locator("li[data-building-id]", { hasText: ADDR }).first();
    await expect(row).toBeVisible({ timeout: T.action });
    const id = await buildingIdOf(row);
    if (!id) throw new Error("aggregations-open-tier: missing building id");

    await openAggregations(page);

    // The open dataset row — "{renewable-share label} — Bayern" — is shown by
    // default (every tier selected). The tier selector offers an "Open data" tier.
    const tierFilter = page.getByRole("group", { name: en("tierFilterAria") });
    await expect(tierFilter.getByRole("button", { name: en("tierOpen") }))
      .toBeVisible({ timeout: T.action });
    const openRow = page.getByText(
      `${en("regRenewableShare")} — Bayern`,
    );
    await expect(openRow).toBeVisible({ timeout: T.action });

    // Unticking the "Open data" tier removes the open row (no own/shared
    // aggregations exist, so the collection empties); re-ticking restores it.
    await tierFilter.getByRole("button", { name: en("tierOpen") }).click();
    await expect(openRow).toHaveCount(0);
    await tierFilter.getByRole("button", { name: en("tierOpen") }).click();
    await expect(openRow).toBeVisible();

    // Opening the dataset navigates to its standalone read-only page, which fetches
    // and renders the stubbed Bayern figure (2023 → 61.5 %). Scope to the open row's
    // own details button — the open tier now lists several regional datasets.
    await page
      .getByRole("listitem")
      .filter({ hasText: `${en("regRenewableShare")} — Bayern` })
      .getByRole("button", { name: en("aggDetailsAria") })
      .click();
    await expect(
      page.getByRole("heading", { name: `${en("regRenewableShare")} — Bayern` }),
    ).toBeVisible({ timeout: T.action });
    await expect(page.getByRole("cell", { name: "2023" })).toBeVisible();
    await expect(page.getByRole("cell", { name: /61\.5\s*%/ })).toBeVisible();
    await expect(page.getByText(en("regDataSource"))).toBeVisible();

    // Cleanup: delete the throwaway building.
    await page.goto("/");
    await openBuildingsList(page);
    await deleteBuildingRow(page, id);
  });
});
