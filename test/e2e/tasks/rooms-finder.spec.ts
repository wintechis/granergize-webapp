import { expect, type Page, test } from "@playwright/test";
import { t } from "../helpers/i18n.ts";
import { account, hasAccount, login } from "../helpers/login.ts";
import { newCapturedPage } from "../helpers/consoleLog.ts";
import { assertCleanStart, verifyAndReset } from "../helpers/cleanSlate.ts";
import { confirmDialog } from "../helpers/confirm.ts";
import { T } from "../helpers/timeouts.ts";

/**
 * The Rooms (Meet) finder header + room naming. Closes the finder-header coverage
 * gap and proves the room-name feature end to end: hosting a NAMED room makes the
 * finder show its human name (`rdfs:label`) instead of the long room URI, and the
 * `FinderHeader` title carries the bespoke heading. Self-cleaning; runs against
 * Alice (a throwaway Pod — never a real account; see e2e/README.md).
 *
 *   deno task e2e:local test/e2e/tasks/rooms-finder.spec.ts
 */
const A = account("A");

test.describe.configure({ mode: "serial" });

test.describe("rooms finder", () => {
  test.skip(
    !hasAccount(A),
    `Set WEBID_A_USERNAME / WEBID_A_PASSWORD (Alice; a throwaway Solid Pod) to run the rooms-finder e2e.`,
  );

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(T.setup);
    page = await newCapturedPage(browser, "rooms-finder");
    // "Delete data room" confirms via window.confirm — accept automatically.
    page.on("dialog", (d) => d.accept());
    await login(page, A);
    await assertCleanStart(page);
    await page.getByRole("tab", { name: t("navMeet") }).click();
  });

  test.afterAll(async () => {
    await verifyAndReset(page, "rooms-finder");
    await page.close();
  });

  test("the heading renders and a hosted room shows its name, not its URI", async () => {
    test.setTimeout(T.testSolo);
    const NAME = "Rooms Finder E2E Room";

    // The shared FinderHeader renders the bespoke heading (empty-state, no count).
    await expect(page.getByRole("heading", { name: t("headingYourRooms") }))
      .toBeVisible({ timeout: T.action });

    // Host a NAMED room: fill the name field, then Host.
    await page.getByLabel(t("roomNameLabel"), { exact: true }).fill(NAME);
    await page.getByRole("button", { name: t("roomHostBtn") }).click();
    // Hosting lands on the new room's standalone page; return to the finder.
    await expect(page).toHaveURL(/\/room\?/, { timeout: T.action });
    await page.goto("/rooms");
    await page.getByRole("tab", { name: t("navMeet") }).click();

    // The row shows the human NAME as its link — not the raw room URI.
    const row = page.locator("li").filter({ hasText: NAME });
    await expect(row).toBeVisible({ timeout: T.action });
    await expect(row.getByRole("link", { name: NAME })).toBeVisible();

    // Cleanup: delete the room from its row.
    await row.getByRole("button", { name: t("roomDeleteAria") }).click();
    await confirmDialog(page, "Delete");
    await expect(page.locator("li").filter({ hasText: NAME }))
      .toHaveCount(0, { timeout: T.action });
  });
});
