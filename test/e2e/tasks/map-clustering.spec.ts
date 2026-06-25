import { expect, type Page, test } from "@playwright/test";
import { account, hasAccount, login } from "../helpers/login.ts";
import { addBuilding, openBuildingsMap } from "../helpers/manage.ts";
import { newCapturedPage } from "../helpers/consoleLog.ts";
import {
  assertCleanStart,
  clearFinderMemory,
  verifyAndReset,
} from "../helpers/cleanSlate.ts";
import { T } from "../helpers/timeouts.ts";

/**
 * The buildings map clusters dense markers (`leaflet.markercluster`, via
 * `MarkerClusterGroup`). Three own buildings at the SAME coordinate (the create dialog's
 * fixed test coords) collapse into one count bubble at regional zoom and split back into
 * individual `pin-owned` markers at street zoom (`disableClusteringAtZoom: 16`). Asserts
 * both directions. Self-cleaning; Alice (account A).
 *
 *   deno task e2e:local test/e2e/tasks/map-clustering.spec.ts
 */

const ACC = account("A");
// Three buildings ~150 m apart (DISTINCT points, not the dialog's fixed coord): they
// auto-fit at street zoom as individual pins, then merge into one bubble when zoomed out
// below the declustering threshold.
const SEEDS = [
  { street: "Cluster E2E Strasse 1", lat: 49.4500, long: 11.0800 },
  { street: "Cluster E2E Strasse 2", lat: 49.4510, long: 11.0810 },
  { street: "Cluster E2E Strasse 3", lat: 49.4505, long: 11.0795 },
];

test.describe.configure({ mode: "serial" });

test.describe("map marker clustering", () => {
  test.skip(
    !hasAccount(ACC),
    `Set WEBID_A_USERNAME / WEBID_A_PASSWORD (a throwaway Solid Pod) to run the map-clustering e2e.`,
  );

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(T.setup);
    page = await newCapturedPage(browser, "map-clustering");
    page.on("dialog", (d) => d.accept().catch(() => {}));
    await login(page, ACC);
    await assertCleanStart(page);
  });

  test.afterAll(async () => {
    await verifyAndReset(page, "map-clustering");
    await page.close();
  });

  test("dense pins collapse into a count bubble and split again on zoom-in", async () => {
    test.setTimeout(T.testSolo);
    await clearFinderMemory(page);

    for (const s of SEEDS) {
      await addBuilding(page, s.street, { lat: s.lat, long: s.long });
    }

    await openBuildingsMap(page);
    // The auto-fit frames the three ~150 m-apart points at street zoom (≥
    // disableClusteringAtZoom), so they begin as individual owned pins.
    await expect(page.locator(".pin-owned")).toHaveCount(3, { timeout: T.action });

    // Zoom OUT below the declustering threshold → the three collapse into one bubble.
    const zoomOut = page.locator(".leaflet-control-zoom-out");
    await expect(async () => {
      await zoomOut.click();
      expect(await page.locator(".marker-cluster").count()).toBeGreaterThan(0);
    }).toPass({ timeout: T.poll, intervals: [300] });
    // The bubble carries the child count, and no individual owned pin is in the DOM.
    await expect(page.locator(".marker-cluster")).toContainText("3");
    await expect(page.locator(".pin-owned")).toHaveCount(0);

    // Zoom back IN past the threshold → the bubble splits into the three pins again.
    const zoomIn = page.locator(".leaflet-control-zoom-in");
    await expect(async () => {
      await zoomIn.click();
      expect(await page.locator(".marker-cluster").count()).toBe(0);
    }).toPass({ timeout: T.poll, intervals: [300] });
    await expect(page.locator(".pin-owned")).toHaveCount(3, { timeout: T.action });
  });
});
