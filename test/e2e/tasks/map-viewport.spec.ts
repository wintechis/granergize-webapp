import { expect, type Page, test } from "@playwright/test";
import { account, hasAccount, login } from "../helpers/login.ts";
import { newCapturedPage } from "../helpers/consoleLog.ts";
import { assertCleanStart, verifyAndReset } from "../helpers/cleanSlate.ts";
import { T } from "../helpers/timeouts.ts";

/**
 * The map viewport is PRESERVED COMPONENT STATE (notes/ui-state.md §Preserved component
 * state): drilling into a standalone, shell-less detail route unmounts the finder, but
 * the `mapViewport` module store outlives it, so returning restores the exact view
 * instead of snapping to the all-buildings fit.
 *
 * This test ISOLATES the store: it returns to the finder via a URL with NO `?c`/`?z`, so
 * the only thing that can restore the viewport is the surviving store — not the URL
 * params (the old, fragile mechanism). The map writes its centre with 5 decimals
 * (`toFixed(5)`), distinct from the seed's `50.0`, so the assertion waits for the MAP's
 * own write, not the goto. Self-cleaning; Alice (account A).
 *
 *   deno task e2e:local test/e2e/tasks/map-viewport.spec.ts
 */

const ACC = account("A");
// A distinct seeded centre — well clear of the map's default Germany view (50.976,10.40)
// and of any fitted building — so "restored" vs "snapped to fit/default" is unambiguous.
const SEEDED = /[?&]c=50\.00000/;

test.describe.configure({ mode: "serial" });

test.describe("map viewport preservation", () => {
  test.skip(
    !hasAccount(ACC),
    `Set WEBID_A_USERNAME / WEBID_A_PASSWORD (a throwaway Solid Pod) to run the map-viewport e2e.`,
  );

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(T.setup);
    page = await newCapturedPage(browser, "map-viewport");
    page.on("dialog", (d) => d.accept().catch(() => {}));
    await login(page, ACC);
    await assertCleanStart(page);
  });

  test.afterAll(async () => {
    await verifyAndReset(page, "map-viewport");
    await page.close();
  });

  test("the map restores its viewport from the store after a detail drill", async () => {
    test.setTimeout(T.testSolo);

    // 1. Seed a distinct viewport on the Buildings map. The map applies it and writes the
    //    store on its settle — waiting for the 5-decimal `c=50.00000` proves the map's own
    //    write fired (so the store is set), not just the goto's `c=50.0`.
    await page.goto("/buildings?c=50.0,11.5&z=14");
    await expect(page).toHaveURL(SEEDED, { timeout: T.poll });

    // 2. Drill into a standalone, shell-less detail route — this UNMOUNTS the finder + map.
    await page.goto("/building?ref=map-viewport-e2e");
    await expect(page).toHaveURL(/\/building\?/, { timeout: T.action });

    // 3. Return to the finder via a URL with NO `?c`/`?z`. The map re-mounts; only the
    //    surviving store can restore the viewport, which the map then writes back.
    //    Without the store, the map would default to Germany / fit the markers — never 50.0.
    await page.goto("/buildings?space=map");
    await expect(page).toHaveURL(SEEDED, { timeout: T.poll });
  });
});
