import { expect, type Locator, type Page, test } from "@playwright/test";
import { t } from "../helpers/i18n.ts";
import { account, hasAccount, login, webIdOf } from "../helpers/login.ts";
import { newCapturedPage } from "../helpers/consoleLog.ts";
import { assertCleanStart, verifyAndReset } from "../helpers/cleanSlate.ts";
import { confirmDialog } from "../helpers/confirm.ts";
import { reloadUntil } from "../helpers/reloadUntil.ts";
import { T } from "../helpers/timeouts.ts";
import { roomRoute } from "../../../src/routes.ts";

/**
 * Data-room lifecycle, single account (a THROWAWAY Solid Pod — never a real
 * account; see e2e/README.md). Drives the real UI across the two surfaces of the
 * redesigned room feature:
 *   • the Connect tab is the room FINDER — host a room, list rooms, delete one;
 *   • `/room/<uri>` is the room DETAIL page — navigating there ENTERS the room
 *     (the page calls `openRoom` on mount), and it carries the roles + members.
 *
 * Each test hosts its own room and deletes it at the end, so it cleans up after
 * itself. Runs serially behind ONE login.
 *
 *   # tier 3 (local CSS, no creds):
 *   deno task e2e:local test/e2e/solo/data-room.spec.ts
 *   # tier 4 (real Pods):
 *   source test/.env.e2e.local && deno task e2e:remote:spec test/e2e/solo/data-room.spec.ts
 *
 * Runs against Alice (account A); skipped when its env vars are absent.
 */

const A = account("A"); // Alice — solo specs use one account
// Each room mutation does a Pod write + a re-read of the room log; on the
// throttled shared pod that can be slow, so allow a generous settle window.
const SETTLE = T.action;

test.describe.configure({ mode: "serial" });

test.describe("data rooms", () => {
  test.skip(
    !hasAccount(A),
    `Set WEBID_A_USERNAME / WEBID_A_PASSWORD (Alice; a throwaway Solid Pod) to run the data-room tests.`,
  );

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(T.setup); // login (IdP + consent) can be slow / retried
    page = await newCapturedPage(browser, "data-room");
    // The "Delete data room" action asks for confirmation via window.confirm —
    // accept it automatically so the delete proceeds.
    page.on("dialog", (d) => d.accept());
    await login(page, A);
    await assertCleanStart(page);
    await page.getByRole("tab", { name: t("navMeet") }).click();
  });

  test.afterAll(async () => {
    await verifyAndReset(page, "data-room");
    await page.close();
  });

  /** Every room row currently listed on Connect. A room row carries a
   * delete/remove action; the room URI is the row's "open" link text (the link
   * routes to that room's detail page). We identify rooms by that UI affordance
   * rather than the `/rooms/` storage path — where a room is stored is an
   * app-internal convention the spec shouldn't depend on. */
  const roomRow = () =>
    page.locator("li").filter({
      has: page.locator(
        `button[aria-label="${t("roomDeleteAria")}"], button[aria-label="${t("roomRemoveAria")}"]`,
      ),
    });

  const roomUris = () =>
    roomRow().getByRole("link").evaluateAll((els) =>
      els.map((e) => (e.textContent ?? "").trim())
    );

  /** Open the Rooms finder (`/rooms`). The room detail page is a STANDALONE route
   * with no app-shell tabs, so first land on the shell — clicking the Rooms tab
   * directly from a room page would never find the tab. */
  async function openConnect() {
    if (/\/room\?/.test(page.url())) await page.goto("/rooms");
    await page.getByRole("tab", { name: t("navMeet") }).click();
  }

  /**
   * Host a fresh room on Connect and return its row + URI. Robust to pre-existing
   * rooms: identifies the genuinely-new room by diffing the list before/after.
   * Hosting navigates to the new room's page, so we return to Connect to read it.
   */
  async function hostRoom(): Promise<{ row: Locator; uri: string }> {
    await openConnect();
    const before = new Set(await roomUris());
    await page.getByRole("button", { name: t("roomHostBtn") }).click();
    // Hosting lands on the new room's STANDALONE detail page (no app-shell tabs);
    // return to the shell before reading the Connect list.
    await expect(page).toHaveURL(/\/room\?/, { timeout: SETTLE });
    await openConnect();
    let uri = "";
    await expect(async () => {
      uri = (await roomUris()).find((h) => h && !before.has(h)) ?? "";
      expect(uri, "a newly-hosted room should appear in the list").toBeTruthy();
    }).toPass({ timeout: SETTLE });
    return { row: page.locator("li").filter({ hasText: uri }), uri };
  }

  /** Open a room's detail page (which enters it on mount) and confirm it loaded. */
  async function openRoomPage(uri: string) {
    await page.goto(roomRoute(uri));
    await expect(page.getByRole("heading", { name: uri })).toBeVisible({
      timeout: SETTLE,
    });
    // The page ENTERS the room on mount via an async POST. Under BrowserRouter the
    // next navigation is a full document reload that would ABORT an in-flight
    // enter (a real user clicks a link → client-side nav, which never aborts
    // fetches; only the test's `goto` reloads). Let the network settle so the
    // enter persists to the Pod before we navigate away to read the active room.
    await page.waitForLoadState("networkidle").catch(() => {});
  }

  /** Delete a room from its row on Connect and wait for it to drop out. */
  async function deleteRoom(uri: string) {
    await openConnect();
    const row = page.locator("li").filter({ hasText: uri });
    await row.getByRole("button", { name: t("roomDeleteAria") }).click();
    await confirmDialog(page, "Delete");
    await expect(page.locator("li").filter({ hasText: uri }))
      .toHaveCount(0, { timeout: SETTLE });
  }

  test("host a data room, open its page, leave, then delete", async () => {
    test.setTimeout(T.testSolo);
    const { uri } = await hostRoom();

    // The room page is its detail surface: navigating there enters the room (the
    // page's openRoom-on-mount). It carries the invite QR and the members list.
    await openRoomPage(uri);
    await expect(page.getByRole("heading", { name: t("secMembers") }))
      .toBeVisible({ timeout: SETTLE });

    // Leave from the page footer; on success it navigates back off the room page
    // (the durable signal). The room itself persists (we still host it) — clean
    // it up by deleting from its Connect row.
    await page.getByRole("button", { name: t("roomLeaveBtn") }).click();
    await expect(page).not.toHaveURL(/\/room\?/, { timeout: SETTLE });

    await deleteRoom(uri);
  });

  test("the members list is a WebID directory: my WebID, copyable", async () => {
    test.setTimeout(T.testSolo);
    // A room's whole job: show WHO is in it and the WebID you'd share with. Host a
    // room, open its page (→ openRoom-on-mount joins us), and assert our own WebID
    // is listed verbatim next to our name, with a copy affordance. The WebID stays
    // visible outside Developer mode — it is identity, not storage plumbing.
    // Read our WebID from the app SHELL: `webIdOf` scrapes the account-menu
    // button, which the standalone room page doesn't render.
    await page.goto("/");
    const webId = await webIdOf(page);

    const { uri } = await hostRoom();
    await openRoomPage(uri);

    // The join that hosting performs is an async POST folded on the NEXT read, so
    // the member row can lag the first paint — reload until the directory shows us.
    await reloadUntil(page, async () => {
      await expect(page.getByText(webId, { exact: true }))
        .toBeVisible({ timeout: T.quick });
      await expect(
        page.getByRole("button", { name: t("roomCopyWebId") }).first(),
      ).toBeVisible({ timeout: T.quick });
    });

    await deleteRoom(uri);
  });

  test("navigate between two rooms — each becomes the active room", async () => {
    test.setTimeout(T.testSolo);
    // The active room is whichever room page you last opened (openRoom-on-mount
    // enters it, leaving the previous one). Drive that through the room pages and
    // verify each becomes active in turn. The active room is reflected on Connect
    // as the row's "active" sub-line.
    const a = await hostRoom();
    const b = await hostRoom();

    /** Open a room page, then confirm Connect marks exactly that room active. */
    async function activate(uri: string, other: string) {
      await openRoomPage(uri);
      // The active room is folded from the Pod membership log; re-read Connect
      // (each openConnect reloads) until the just-entered room shows active and
      // the other doesn't — robust to the fold propagating a beat after the enter.
      await expect(async () => {
        await openConnect();
        const activeRow = page.locator("li").filter({ hasText: uri });
        const otherRow = page.locator("li").filter({ hasText: other });
        await expect(activeRow.getByText(t("roomActive")))
          .toBeVisible({ timeout: SETTLE });
        // The other room must NOT be active (left when we entered this one).
        await expect(otherRow.getByText(t("roomActive")))
          .toBeHidden({ timeout: SETTLE });
      }).toPass({ timeout: T.poll });
    }

    for (let i = 0; i < 3; i++) {
      await activate(a.uri, b.uri);
      await activate(b.uri, a.uri);
    }

    // Clean up both rooms. Assert the durable OUTCOME (the row disappears), never
    // a transient toast — notifications are a single FIFO snackbar with a 6 s
    // auto-hide, so a burst backs up and a later toast can be delayed past SETTLE
    // even though its action succeeded immediately.
    await deleteRoom(a.uri);
    await deleteRoom(b.uri);
  });

  test("host a data room, re-open its page, then delete", async () => {
    test.setTimeout(T.testSolo);
    const { uri } = await hostRoom();

    // Re-opening the page re-enters the room (idempotent openRoom).
    await openRoomPage(uri);
    await openRoomPage(uri);

    await deleteRoom(uri);
  });
});
