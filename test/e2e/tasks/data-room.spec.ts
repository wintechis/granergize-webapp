import { expect, type Locator, type Page, test } from "@playwright/test";
import { account, hasAccount, login } from "../helpers/login.ts";

/**
 * Data-room lifecycle on the Connect tab, single account (a THROWAWAY Solid Pod
 * — never a real account; see e2e/README.md). Drives the real UI:
 *   1. host a room → enter/leave it back and forth;
 *   2. host a room → leave → re-enter → delete.
 * Each test hosts its own room and deletes it at the end, so it cleans up after
 * itself. Runs serially behind ONE login.
 *
 *   # tier 3 (local CSS, no creds):
 *   deno task e2e:local test/e2e/tasks/data-room.spec.ts
 *   # tier 4 (real Pods):
 *   source test/.env.e2e.local && deno task e2e:remote:spec test/e2e/tasks/data-room.spec.ts
 *
 * Runs against Alice (account A); skipped when its env vars are absent.
 */

const A = account("A"); // Alice — solo specs use one account
// Each room mutation does a Pod write + a re-read of the room log; on the
// throttled shared pod that can be slow, so allow a generous settle window.
const SETTLE = 45_000;

test.describe.configure({ mode: "serial" });

test.describe("data rooms", () => {
  test.skip(
    !hasAccount(A),
    `Set E2E_USERNAME_A / E2E_PASSWORD_A (Alice; a throwaway Solid Pod) to run the data-room tests.`,
  );

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(240_000); // login (IdP + consent) can be slow / retried
    page = await browser.newPage();
    // The "Delete data room" action asks for confirmation via window.confirm —
    // accept it automatically so the delete proceeds.
    page.on("dialog", (d) => d.accept());
    await login(page, A);
    await page.getByRole("tab", { name: "Connect" }).click();
  });

  test.afterAll(async () => {
    await page.close();
  });

  /** Wait for a success snackbar with the given text, then for it to clear (so
   * the next action's notification is unambiguous). */
  async function expectNotice(text: string) {
    const notice = page.getByText(text, { exact: false });
    await expect(notice.first()).toBeVisible({ timeout: SETTLE });
  }

  /**
   * All room URIs currently listed (to diff before/after a host). A room row is the
   * list item carrying an Enter/Leave action; its link text is the room URI. We
   * identify rooms by that UI affordance rather than the `/rooms/` storage path —
   * the path is an app-internal convention the spec shouldn't depend on (the room's
   * URI is its identity, but *where* it's stored is not the test's business).
   */
  const roomHrefs = () =>
    page.locator("li")
      .filter({
        has: page.locator(
          'button[aria-label="Enter data room"], button[aria-label="Leave data room"]',
        ),
      })
      .locator("a")
      .evaluateAll((els) =>
        els.map((e) => (e as HTMLAnchorElement).getAttribute("href") ?? "")
      );

  /**
   * Host a fresh room and return its row + URI. Robust to pre-existing rooms
   * (the pod may carry cruft): identifies the genuinely-new room by diffing the
   * list before/after, rather than trusting whichever room is currently active.
   */
  async function hostRoom(): Promise<{ row: Locator; uri: string }> {
    const before = new Set(await roomHrefs());
    await page.getByRole("button", { name: /host a data room/i }).click();
    await expectNotice("Data room created");
    let uri = "";
    await expect(async () => {
      uri = (await roomHrefs()).find((h) => h && !before.has(h)) ?? "";
      expect(uri, "a newly-hosted room should appear in the list").toBeTruthy();
      // …and it should be the active room.
      await expect(
        page.locator("li").filter({ hasText: uri }).getByRole("button", {
          name: "Leave data room",
        }),
      ).toBeVisible();
    }).toPass({ timeout: SETTLE });
    return { row: page.locator("li").filter({ hasText: uri }), uri };
  }

  async function leaveRoom(row: Locator) {
    await row.getByRole("button", { name: "Leave data room" }).click();
    await expectNotice("You left the data room");
    await expect(row.getByRole("button", { name: "Enter data room" }))
      .toBeVisible({ timeout: SETTLE });
  }

  async function enterRoom(row: Locator) {
    await row.getByRole("button", { name: "Enter data room" }).click();
    await expectNotice("You joined the data room");
    await expect(row.getByRole("button", { name: "Leave data room" }))
      .toBeVisible({ timeout: SETTLE });
  }

  test("host a data room, then enter/leave back and forth", async () => {
    test.setTimeout(240_000);
    const { row, uri } = await hostRoom();

    // Just hosted → we are in it.
    await expect(row.getByRole("button", { name: "Leave data room" }))
      .toBeVisible();

    // Toggle membership back and forth; the available action flips each time.
    for (let i = 0; i < 2; i++) {
      await leaveRoom(row);
      await enterRoom(row);
    }

    // Clean up: delete the room we created (confirm auto-accepted above).
    await row.getByRole("button", { name: "Delete data room" }).click();
    await expectNotice("Data room deleted");
    await expect(page.locator("li").filter({ hasText: uri }))
      .toHaveCount(0, { timeout: SETTLE });
  });

  test("switch the active room back and forth between two rooms", async () => {
    test.setTimeout(300_000);
    // Host two rooms. Hosting the second leaves the first, so room2 ends active.
    const a = await hostRoom();
    const b = await hostRoom();
    await expect(b.row.getByRole("button", { name: "Leave data room" }))
      .toBeVisible({ timeout: SETTLE });
    await expect(a.row.getByRole("button", { name: "Enter data room" }))
      .toBeVisible({ timeout: SETTLE });

    // Switching to a room must make it active AND deactivate the other one
    // (enterRoom leaves the previous current). The "other shows Enter" assertion
    // is the one that catches an unreliable switch.
    async function switchTo(target: Locator, other: Locator) {
      await target.getByRole("button", { name: "Enter data room" }).click();
      await expectNotice("You joined the data room");
      await expect(target.getByRole("button", { name: "Leave data room" }))
        .toBeVisible({ timeout: SETTLE });
      await expect(other.getByRole("button", { name: "Enter data room" }))
        .toBeVisible({ timeout: SETTLE });
    }

    for (let i = 0; i < 3; i++) {
      await switchTo(a.row, b.row); // room A active, room B inactive
      await switchTo(b.row, a.row); // room B active, room A inactive
    }

    // Clean up both rooms.
    await a.row.getByRole("button", { name: "Delete data room" }).click();
    await expectNotice("Data room deleted");
    await expect(page.locator("li").filter({ hasText: a.uri }))
      .toHaveCount(0, { timeout: SETTLE });
    await b.row.getByRole("button", { name: "Delete data room" }).click();
    await expectNotice("Data room deleted");
    await expect(page.locator("li").filter({ hasText: b.uri }))
      .toHaveCount(0, { timeout: SETTLE });
  });

  test("host a data room, leave, re-enter, then delete", async () => {
    test.setTimeout(240_000);
    const { row, uri } = await hostRoom();

    await leaveRoom(row);
    await enterRoom(row);

    await row.getByRole("button", { name: "Delete data room" }).click();
    await expectNotice("Data room deleted");
    await expect(page.locator("li").filter({ hasText: uri }))
      .toHaveCount(0, { timeout: SETTLE });
  });
});
