import { expect, type Page } from "@playwright/test";
import { t } from "./i18n.ts";
import { T } from "./timeouts.ts";
import { roomRoute } from "../../../src/routes.ts";

/**
 * Room membership helpers, shared by the cross-Pod specs (`share-aggregation`,
 * `peer-benchmark`) and `data-room`.
 *
 * A room is a WebID **directory**: it lists who is in it so you can find someone
 * to share with. It is never itself a share target, so these helpers only get
 * people INTO a room — the sharing is done by WebID (`shareByWebId`).
 *
 * Hosting and the room *list* are Rooms-finder actions (the redesign split the
 * old Connect tab into the Rooms and Contacts finders); per-room detail —
 * entering, members, the invite QR — lives on the standalone room page
 * (`/room?uri=<room URI>`). So `hostRoomAndGetUri` stays on the Rooms finder,
 * while `joinRoom` drives the room page; navigating to a room page enters it
 * (the page calls `openRoom` on mount). Room detail URLs come from the app's
 * own `roomRoute` builder (`/room?uri=<encoded room URI>` — a room URI is absolute).
 */

/** Open the Rooms finder (`/rooms`). The room detail page is a STANDALONE route
 * with no app-shell tabs, so first land on the shell when we're on a room page —
 * clicking the Rooms tab directly from there would never find the tab. */
async function gotoRooms(page: Page): Promise<void> {
  if (/\/room\?/.test(page.url())) await page.goto("/rooms");
  await page.getByRole("tab", { name: t("navMeet") }).click();
}

/** On the Connect tab, ensure a room exists (host one if none) and return ITS
 * URI — the room A actually shares from. Rooms are listed as a clickable link
 * whose text is the room URI; we read that text rather than an href (the row link
 * is a button now). Robust to pre-existing rooms: if a room is already listed we
 * reuse the first one. */
export async function hostRoomAndGetUri(page: Page): Promise<string> {
  await gotoRooms(page);
  // A room row carries a delete/remove action; the room URI is the row's "open"
  // link text (the link routes to that room's detail page).
  const roomLink = page.locator("li")
    .filter({
      has: page.locator(
        `button[aria-label="${t("roomDeleteAria")}"], button[aria-label="${t("roomRemoveAria")}"]`,
      ),
    })
    .getByRole("link")
    .first();
  if (!(await roomLink.count())) {
    await page.getByRole("button", { name: t("roomHostBtn") }).click();
    // Hosting navigates to the new room's page; go back to Connect to read it.
    await expect(page).toHaveURL(/\/room\?/, { timeout: T.action });
    await gotoRooms(page);
    await expect(roomLink).toBeVisible({ timeout: T.action });
  }
  const uri = (await roomLink.textContent())?.trim();
  expect(uri, "hosted room URI").toBeTruthy();
  return uri!;
}

/**
 * Enter a room: navigating to its page joins it (the page calls `openRoom` on
 * mount), which is what puts you in the member list others read WebIDs from.
 */
export async function enterRoomPage(
  page: Page,
  roomUri: string,
): Promise<void> {
  await page.goto(roomRoute(roomUri));
  await expect(page.getByRole("heading", { name: t("secMembers") }))
    .toBeVisible({ timeout: T.visible });
  // Return to the app shell: the room page is a standalone route with no tabs, so
  // a caller's next shell action (a building/share tab click) would hang here.
  await page.goto("/");
}

/**
 * Add a room URI to the list on the Rooms finder, then open its page (which
 * enters the room). The add step is needed so an invite-only room shows in B's
 * list; opening the page is what registers B as a member.
 */
export async function joinRoom(
  page: Page,
  roomUri: string,
): Promise<void> {
  await gotoRooms(page);
  const row = page.locator("li").filter({ hasText: roomUri });
  if (!(await row.count())) {
    const uriField = page.getByLabel(t("roomUriLabel"));
    const add = page.getByRole("button", { name: t("btnAdd"), exact: true });
    await expect(async () => {
      if (await row.count()) return;
      await uriField.fill(roomUri);
      await expect(add).toBeEnabled({ timeout: T.quick });
      await add.click();
      await expect(row.first()).toBeVisible({ timeout: T.quick });
    }).toPass({ timeout: T.poll });
  }
  await enterRoomPage(page, roomUri);
}
