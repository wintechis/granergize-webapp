import { expect, type Page, test } from "@playwright/test";
import { account, hasAccount, login } from "../helpers/login.ts";
import { newCapturedPage } from "../helpers/consoleLog.ts";
import { assertCleanStart, verifyAndReset } from "../helpers/cleanSlate.ts";
import { ensureDemoBuildings } from "../helpers/seed.ts";
import { T } from "../helpers/timeouts.ts";

/**
 * Energy-map categorisation "in practice" (browser) — the handbuch's third
 * Praxisbeispiel, "Vertriebsoptimierung": the map can colour each building by its
 * energy intensity so a logistics object reads, at a glance, as more or less
 * efficient than its neighbours.
 *
 * Seeds the investor demo set (`ensureDemoBuildings("investor")`), which ships
 * three annual buildings of distinct floor area + multi-year energy (so their
 * kWh/m² intensities differ) plus two electricity *series* buildings (no annual
 * aggregate → uncategorised). The energy is baked in at seed time, so there is no
 * write-then-link lag for the map's bulk energy load to chase. The test switches
 * the map's colour lens from Ownership to Energy and asserts the categorisation
 * spans the range — at least one `energy-efficient` (green) and one
 * `energy-inefficient` (red) marker (terciles over three distinct intensities give
 * one of each). Using the shared demo seed mirrors `view-data.spec.ts`, which the
 * Tier-3 suite already relies on.
 *
 * The intensity / tercile maths is proved exhaustively in the Tier-1
 * `energyCategory.test.ts`; this is the UI proof that the lens toggle re-tints the
 * markers and the categories reach the DOM.
 *
 *   # tier 3 (local CSS, no creds):
 *   deno task e2e:local test/e2e/tasks/map-energy-lens.spec.ts
 *   # tier 4 (real Pods):
 *   source test/.env.e2e.local && deno task e2e:remote:spec test/e2e/tasks/map-energy-lens.spec.ts
 *
 * Runs against Alice (account A). Skipped without creds.
 */

const ACC = account("A"); // Alice -- solo specs use one account

test.describe.configure({ mode: "serial" });

test.describe("map energy lens (Vertriebsoptimierung)", () => {
  test.skip(
    !hasAccount(ACC),
    `Set E2E_USERNAME_A / E2E_PASSWORD_A (a throwaway Solid Pod) to run the map-energy-lens e2e.`,
  );

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(T.setup);
    page = await newCapturedPage(browser, "map-energy-lens");
    await login(page, ACC);
    await assertCleanStart(page);
    // The investor demo seeds three distinct-intensity annual buildings (+ two
    // series buildings) with energy baked in — the shape this lens categorises.
    await ensureDemoBuildings(page);
  });

  test.afterAll(async () => {
    await verifyAndReset(page, "map-energy-lens");
    await page.close();
  });

  test("the energy lens tints buildings across the efficiency range", async () => {
    test.setTimeout(T.setup);
    // The map's bulk energy load is read through the buildings query, which under
    // `staleTime: 0` refetches eagerly — so the per-building energy can take a
    // couple of load cycles to flow into the categorisation. Reload-and-retry
    // until the categories span the range: each fresh load re-runs
    // loadBuildings/loadEnergy against the now-consistent Pod (the standard Tier-3
    // write-read convergence pattern).
    await expect(async () => {
      await page.goto("/#/");
      await page.getByRole("tab", { name: "Explore" }).click();
      // Markers paint under the default (ownership) lens — the standard pins.
      await expect(page.locator("img.leaflet-marker-icon").first())
        .toBeVisible({ timeout: T.action });
      // Switch the colour lens to Energy. (The "Energy data" detail tab only
      // exists once a building is selected, so "Energy" exact is unambiguous.)
      await page.getByRole("button", { name: "Energy", exact: true }).click();
      // Across three distinct intensities the terciles give at least one efficient
      // (green) and one inefficient (red) marker — the category is on the className.
      await expect(page.locator(".energy-marker.energy-efficient").first())
        .toBeAttached({ timeout: T.action });
      await expect(page.locator(".energy-marker.energy-inefficient").first())
        .toBeAttached({ timeout: T.action });
    }).toPass({ timeout: T.setup, intervals: [2_000] });

    // The legend swatches followed the active lens.
    await expect(page.getByText("More efficient")).toBeVisible({ timeout: T.action });
    await expect(page.getByText("Less efficient")).toBeVisible({ timeout: T.action });
  });
});
