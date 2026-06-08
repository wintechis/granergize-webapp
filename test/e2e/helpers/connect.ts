import { expect, type Page } from "@playwright/test";
import { T } from "./timeouts.ts";

/**
 * Connect-tab room/role helpers, shared by the cross-Pod specs (`share-building`,
 * `share-view`) and `data-room`. Extracted from the per-spec copies that were
 * byte-identical.
 */

/** On the Connect tab, ensure an ACTIVE room (host one if none) and return ITS
 * URI — the room A actually shares from. Must read the active-room section, not
 * any "/rooms/" link, since the bookmark list also renders room links. */
export async function hostRoomAndGetUri(page: Page): Promise<string> {
  await page.getByRole("tab", { name: "Connect" }).click();
  const leave = page.getByRole("button", { name: /leave data room/i });
  if (!(await leave.count())) {
    await page.getByRole("button", { name: /host a data room/i }).click();
    await expect(leave).toBeVisible({ timeout: T.action });
  }
  const activeRow = page.locator("li").filter({ has: leave });
  const activeLink = activeRow.locator('a[href*="/rooms/"]').first();
  await expect(activeLink).toBeVisible({ timeout: T.action });
  const uri = (await activeLink.getAttribute("href"))?.trim();
  expect(uri, "active room URI").toBeTruthy();
  await expect(leave).toBeEnabled({ timeout: T.action }).catch(() => {});
  return uri!;
}

/**
 * Assign the User role in the current room (MUI multi-select: open, tick, close,
 * save). Both A and B need a role: A to share targeted at the User role, B to
 * receive it.
 */
export async function assignUserRole(page: Page): Promise<void> {
  await page.getByRole("tab", { name: "Connect" }).click();
  await page.waitForLoadState("networkidle").catch(() => {});
  const select = page.getByRole("combobox", { name: "My role(s)" });
  await expect(select).toBeVisible({ timeout: T.visible });
  await select.click();
  const userOption = page.getByRole("option", { name: "User" });
  await expect(userOption).toBeVisible({ timeout: T.quick });
  const alreadyUser = (await userOption.getAttribute("aria-selected")) === "true";
  if (!alreadyUser) await userOption.click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("listbox")).toBeHidden({ timeout: T.quick }).catch(
    () => {},
  );
  if (alreadyUser) return;
  await expect(async () => {
    await page.getByRole("button", { name: /save roles/i }).click();
    await expect(page.getByText(/roles updated/i)).toBeVisible({
      timeout: T.quick,
    });
  }).toPass({ timeout: T.poll });
}

/** On the Connect tab, add+enter a room URI and assign the User role. */
export async function joinRoomAsUser(page: Page, roomUri: string): Promise<void> {
  await page.getByRole("tab", { name: "Connect" }).click();
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
  const enter = row.first().getByRole("button", { name: /enter data room/i });
  if (await enter.count()) await enter.click();
  await expect(page.getByRole("button", { name: /leave data room/i }))
    .toBeVisible({ timeout: T.action });
  await assignUserRole(page);
}
