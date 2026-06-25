import { expect, type Page, test } from "@playwright/test";
import { account, hasAccount, login } from "../helpers/login.ts";
import { newCapturedPage } from "../helpers/consoleLog.ts";
import { assertCleanStart, verifyAndReset } from "../helpers/cleanSlate.ts";
import { T } from "../helpers/timeouts.ts";
import { t } from "../helpers/i18n.ts";

/**
 * The map viewport is PRESERVED COMPONENT STATE (notes/ui-state.md §Preserved component
 * state): navigating away from the Buildings finder unmounts the map, but the in-memory
 * `mapViewport` module store outlives the unmount, so returning restores the exact view
 * instead of snapping to the all-buildings fit. (A standalone detail drill is one such
 * unmount; switching finders is the same in-memory case, and simpler to isolate.)
 *
 * The away-and-back MUST be CLIENT-SIDE (react-router `navigate`, here via tab clicks),
 * never `page.goto` — a `page.goto` reloads the document and resets the module singleton,
 * which is exactly the in-memory state under test (it is NOT persisted, so it must not
 * survive a reload). This test ISOLATES the store: it returns to the finder via a URL with
 * NO `?c`/`?z`, so the only thing that can restore the viewport is the surviving store —
 * not the URL params (the old, fragile mechanism). The map writes its centre with 5
 * decimals (`toFixed(5)`), distinct from the seed's `50.0`, so the assertion waits for the
 * MAP's own write, not the goto. Self-cleaning; Alice (account A).
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

  test("the map restores its viewport from the store after navigating away and back", async () => {
    test.setTimeout(T.testSolo);

    // 1. Seed a distinct viewport on the Buildings map. The map applies it and writes the
    //    store on its settle — waiting for the 5-decimal `c=50.00000` proves the map's own
    //    write fired (so the store is set), not just the goto's `c=50.0`.
    await page.goto("/buildings?c=50.0,11.5&z=14");
    await expect(page).toHaveURL(SEEDED, { timeout: T.poll });

    // 2. Navigate away CLIENT-SIDE (a tab click → react-router `navigate`, NOT a
    //    `page.goto`) so the finder + map UNMOUNT while the in-memory `mapViewport` store
    //    survives. A `page.goto` would RELOAD the document and reset the module singleton —
    //    defeating the very in-memory preservation under test (the store is preserved
    //    component state, not persisted storage, so it must NOT outlive a reload).
    await page.getByRole("tab", { name: t("navObservations") }).click();
    await expect(page).toHaveURL(/\/observations/, { timeout: T.action });

    // 3. Return to the Buildings finder via the tab → `/buildings` with NO `?c`/`?z`, so the
    //    only thing that can restore the viewport is the surviving store, not URL params.
    //    The map re-mounts and writes the restored centre back. Without the store, the map
    //    would default to Germany / fit the markers — never 50.0.
    await page.getByRole("tab", { name: t("navBuildings") }).click();
    await expect(page).toHaveURL(SEEDED, { timeout: T.poll });
  });
});
