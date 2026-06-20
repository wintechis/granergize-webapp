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
 *   2. "Add example contacts and rooms"          (seedDemoContacts + seedDemoRooms)
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
 *   source test/.env.trio.local && deno task e2e:remote:spec test/e2e/tasks/seed-demos.spec.ts
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
    await menuAction(page, new RegExp(t("menuAddContacts")));

    // All three success toasts must appear — a partial warning instead means a
    // concurrent write was lost. (The captured console log records which writes
    // failed and their HTTP status.)
    await expect(
      page.getByText(t("demoBuildingsAdded")),
      "buildings seeded in full (no partial warning)",
    ).toBeVisible({ timeout: T.poll });
    await expect(
      page.getByText(t("demoContactsAdded")),
      "all demo contacts seeded (no partial warning)",
    ).toBeVisible({ timeout: T.poll });
    await expect(
      page.getByText(t("demoRoomsAdded")),
      "all demo data rooms seeded (no partial warning)",
    ).toBeVisible({ timeout: T.poll });

    // …and the data actually lands: buildings on the list, contacts + rooms in
    // their finders (first page; full count guarded by the toasts above).
    await openBuildingsList(page);
    await expect(page.locator("li[data-building-id]").first())
      .toBeVisible({ timeout: T.action });

    await page.getByRole("tab", { name: t("navContacts") }).click();
    await expect(
      page.getByRole("list", { name: t("navContacts") }).locator("li").first(),
    ).toBeVisible({ timeout: T.action });

    await page.getByRole("tab", { name: t("navMeet") }).click();
    await expect(page.locator("li").getByRole("link").first())
      .toBeVisible({ timeout: T.action });
  });
});
