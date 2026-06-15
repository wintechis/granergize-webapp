import { expect, type Page } from "@playwright/test";
import { T } from "./timeouts.ts";

/**
 * Room/role helpers, shared by the cross-Pod specs (`share-building`,
 * `share-aggregation`, `share-files`, `peer-benchmark`) and `data-room`.
 *
 * Hosting and the room *list* are Rooms-finder actions (the redesign split the
 * old Connect tab into the Rooms and Contacts finders); per-room detail —
 * entering, roles, members, the invite QR — lives on the standalone room page
 * (`/room/<encoded room URI>`). So `hostRoomAndGetUri` stays on the Rooms finder,
 * while `assignUserRole` drives the room page; navigating to a room page enters
 * it (the page calls `openRoom` on mount).
 */

/** Real-path route to a room's detail page (mirrors manage.ts's `buildingRoute`). */
function roomRoute(roomUri: string): string {
  return `/room/${encodeURIComponent(roomUri)}`;
}

/** Open the Rooms finder (`/rooms`). The room detail page is a STANDALONE route
 * with no app-shell tabs, so first land on the shell when we're on a room page —
 * clicking the Rooms tab directly from there would never find the tab. */
async function gotoRooms(page: Page): Promise<void> {
  if (/\/room\//.test(page.url())) await page.goto("/rooms");
  await page.getByRole("tab", { name: "Meet" }).click();
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
        'button[aria-label="Delete data room"], button[aria-label="Remove data room"]',
      ),
    })
    .getByRole("link")
    .first();
  if (!(await roomLink.count())) {
    await page.getByRole("button", { name: /host a data room/i }).click();
    // Hosting navigates to the new room's page; go back to Connect to read it.
    await expect(page).toHaveURL(/\/room\//, { timeout: T.action });
    await gotoRooms(page);
    await expect(roomLink).toBeVisible({ timeout: T.action });
  }
  const uri = (await roomLink.textContent())?.trim();
  expect(uri, "hosted room URI").toBeTruthy();
  return uri!;
}

/**
 * Assign the User role in a room: navigate to the room page (which enters the
 * room on mount), open the "My role(s)" multi-select, tick User, save. Both A and
 * B need a role: A to share targeted at the User role, B to receive it.
 */
export async function assignUserRole(
  page: Page,
  roomUri: string,
): Promise<void> {
  await page.goto(roomRoute(roomUri));
  const select = page.getByRole("combobox", { name: "My role(s)" });
  await expect(select).toBeVisible({ timeout: T.visible });
  await select.click();
  const userOption = page.getByRole("option", { name: "User", exact: true });
  await expect(userOption).toBeVisible({ timeout: T.quick });
  const alreadyUser =
    (await userOption.getAttribute("aria-selected")) === "true";
  if (!alreadyUser) await userOption.click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("listbox")).toBeHidden({ timeout: T.quick })
    .catch(() => {});
  if (!alreadyUser) {
    await expect(async () => {
      await page.getByRole("button", { name: /save roles/i }).click();
      await expect(page.getByText(/roles updated/i)).toBeVisible({
        timeout: T.quick,
      });
    }).toPass({ timeout: T.poll });
  }
  // Return to the app shell: the room page is a standalone route with no tabs, so
  // a caller's next shell action (a building/share tab click) would hang here.
  await page.goto("/");
}

/**
 * Add a room URI to the list on Connect, then assign the User role on its page
 * (navigating to the page enters the room). The add step is needed so an
 * invite-only room shows in B's list; the role assignment doubles as the enter.
 */
export async function joinRoomAsUser(
  page: Page,
  roomUri: string,
): Promise<void> {
  await gotoRooms(page);
  const row = page.locator("li").filter({ hasText: roomUri });
  if (!(await row.count())) {
    const uriField = page.getByLabel(/data room uri/i);
    const add = page.getByRole("button", { name: /^add$/i });
    await expect(async () => {
      if (await row.count()) return;
      await uriField.fill(roomUri);
      await expect(add).toBeEnabled({ timeout: T.quick });
      await add.click();
      await expect(row.first()).toBeVisible({ timeout: T.quick });
    }).toPass({ timeout: T.poll });
  }
  await assignUserRole(page, roomUri);
}
