import { expect, type Page, test } from "@playwright/test";
import { account, hasAccount, login } from "../helpers/login.ts";
import { menuAction, setDevMode } from "../helpers/accountMenu.ts";
import { openBuildingsList } from "../helpers/manage.ts";
import { newCapturedPage } from "../helpers/consoleLog.ts";
import { assertCleanStart, verifyAndReset } from "../helpers/cleanSlate.ts";
import { t } from "../helpers/i18n.ts";
import { T } from "../helpers/timeouts.ts";

/**
 * The dev-mode demo-seed menu flow, end to end on a real Pod: log in, then drive
 * the two Account-menu items a developer clicks to populate a fresh Pod —
 *   1. "Add example buildings and energy data"  (seedDemoBuildings)
 *   2. "Add example contacts and rooms"          (seedDemoAgents + seedDemoRooms)
 * — and assert each seeds in FULL, i.e. the success notification rather than the
 * "Added {n} of {total}" partial warning.
 *
 * This guards a gap: `seedDemoBuildings` was only ever reached via the fresh-Pod
 * onboarding banner (`ensureDemoBuildings`), and the contacts/rooms seeders had only
 * a unit test — the menu path was uncovered, so a partial-seed regression on a real
 * Pod went unseen. The second menu item fires BOTH mutations from one click
 * (`AppShell.tsx`), so this also exercises them running concurrently.
 *
 * Solo, Alice (account A). Self-cleaning via verifyAndReset.
 *
 *   source test/.env.trio.local && deno task e2e:remote:spec test/e2e/solo/seed-demos.spec.ts
 */

const ACC = account("A");

test.describe.configure({ mode: "serial" });

test.describe("dev-mode demo seeding (buildings + contacts + rooms)", () => {
  test.skip(
    !hasAccount(ACC),
    `Set WEBID_A_USERNAME / WEBID_A_PASSWORD (a throwaway Solid Pod) to run the seed-demos e2e.`,
  );

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(T.setup);
    page = await newCapturedPage(browser, "seed-demos");
    page.on("dialog", (d) => d.accept().catch(() => {}));
    await login(page, ACC);
    await assertCleanStart(page);
  });

  test.afterAll(async () => {
    await verifyAndReset(page, "seed-demos");
    await page.close();
  });

  test("both menu items seed their demo data in full", async () => {
    test.setTimeout(T.testSolo);

    await setDevMode(page, true);

    // Fire the two menu items back-to-back WITHOUT waiting for the first to
    // finish — the way a developer actually clicks them. So all three seeders
    // (buildings, contacts, rooms) run CONCURRENTLY; `seedDemoBuildings` and
    // `seedDemoRooms` both read-modify-write `prefs.ttl`, so an overlapping run
    // races the conditional PUT and can drop writes → a "Added {n} of {total}"
    // partial. Each must still seed in full.
    await menuAction(page, new RegExp(t("menuAddBuildings")));
    await menuAction(page, new RegExp(t("menuAddAgents")));

    // The data actually lands: buildings on the list, agents + rooms in their
    // finders. These also wait out the concurrent seeders before we read the log.
    await openBuildingsList(page);
    await expect(page.locator("li[data-building-id]").first())
      .toBeVisible({ timeout: T.action });

    await page.getByRole("tab", { name: t("navAgents") }).click();
    await expect(
      page.getByRole("list", { name: t("navAgents") }).locator("li").first(),
    ).toBeVisible({ timeout: T.action });

    await page.getByRole("tab", { name: t("navMeet") }).click();
    await expect(page.locator("li").getByRole("link").first())
      .toBeVisible({ timeout: T.action });

    // "Seeded in full" (no partial): each seeder emits a SUCCESS toast (seeded ==
    // total) or a "{n} of {total}" PARTIAL. Assert via the persistent notification
    // LOG, not the 6 s auto-hide snackbar — the snackbar shows toasts one at a time
    // in completion order, so a fixed-order point-in-time check races the concurrent
    // seeders (the faster seeder's toast can come and go before the check). The log
    // keeps all three regardless of order/timing (see notes: assert outcomes, not toasts).
    await page.getByRole("button", { name: t("nlShowLog") }).click();
    const log = page.getByRole("dialog");
    await expect(
      log.getByText(t("demoBuildingsAdded")),
      "buildings seeded in full (no partial warning)",
    ).toBeVisible({ timeout: T.action });
    await expect(
      log.getByText(t("demoAgentsAdded")),
      "all demo agents seeded (no partial warning)",
    ).toBeVisible();
    await expect(
      log.getByText(t("demoRoomsAdded")),
      "all demo data rooms seeded (no partial warning)",
    ).toBeVisible();
  });
});
