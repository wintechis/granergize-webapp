import { expect, type Page, test } from "@playwright/test";
import { account, hasAccount, login } from "../helpers/login.ts";
import { menuAction, setDevMode } from "../helpers/accountMenu.ts";
import { newCapturedPage } from "../helpers/consoleLog.ts";
import { assertCleanStart, verifyAndReset } from "../helpers/cleanSlate.ts";
import { t } from "../helpers/i18n.ts";
import { T } from "../helpers/timeouts.ts";

/**
 * The dev-mode demo-seed menu flow, end to end on a real Pod: log in, then drive
 * the Account-menu item a developer clicks to populate a fresh Pod with the
 * layout/paging fixtures — "Add example contacts and rooms" (seedDemoAgents +
 * seedDemoRooms) — and assert each seeds in FULL, i.e. the success notification
 * rather than the "Added {n} of {total}" partial warning.
 *
 * This guards a gap: the contacts/rooms seeders had only a unit test, so a
 * partial-seed regression on a real Pod went unseen. The one menu item fires BOTH
 * mutations from a single click (`AppShell.tsx`), so this also exercises them
 * running concurrently against `prefs.ttl`/`bookmarks.ttl`.
 *
 * (Example BUILDINGS are no longer seeded programmatically — they arrive through
 * the file importer; `excel-import.spec.ts` and `importExampleBuildings` cover
 * that path.)
 *
 * Solo, Alice (account A). Self-cleaning via verifyAndReset.
 *
 *   source test/.env.trio.local && deno task e2e:remote:spec test/e2e/solo/seed-demos.spec.ts
 */

const ACC = account("A");

test.describe.configure({ mode: "serial" });

test.describe("dev-mode demo seeding (contacts + rooms)", () => {
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

  test("the menu item seeds contacts and rooms in full", async () => {
    test.setTimeout(T.testSolo);

    await setDevMode(page, true);

    // One click fires BOTH seeders concurrently; they read-modify-write shared
    // app resources (`bookmarks.ttl`/`prefs.ttl`), so an overlapping run races the
    // conditional PUT and can drop writes → a "Added {n} of {total}" partial.
    // Each must still seed in full.
    await menuAction(page, new RegExp(t("menuAddAgents")));

    // The data actually lands: agents + rooms in their finders. These also wait
    // out the concurrent seeders before we read the log.
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
    // keeps both regardless of order/timing (see notes: assert outcomes, not toasts).
    await page.getByRole("button", { name: t("nlShowLog") }).click();
    const log = page.getByRole("dialog");
    await expect(
      log.getByText(t("demoAgentsAdded")),
      "all demo agents seeded (no partial warning)",
    ).toBeVisible({ timeout: T.action });
    // Both seeders get the full action budget: with the buildings seeder gone
    // there is no longer a slower sibling whose wait covers them, and the rooms
    // seeder (21 rooms, each a container + membership log) routinely lands after
    // the agents one — the default 5 s expect timeout raced it.
    await expect(
      log.getByText(t("demoRoomsAdded")),
      "all demo data rooms seeded (no partial warning)",
    ).toBeVisible({ timeout: T.action });
  });
});
