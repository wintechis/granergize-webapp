import { type Page } from "@playwright/test";

/** Open the header Account menu and click the item matching `name` (the menu holds
 *  Profile/Organisation and, when Developer mode is on, the dev account actions). */
export async function menuAction(page: Page, name: RegExp): Promise<void> {
  await page.getByRole("button", { name: /Account menu/ }).click();
  await page.getByRole("menuitem", { name }).click();
}

/**
 * Set Developer mode on/off via its Switch `MenuItem` in the Account menu, then close
 * the menu. Dev mode is persisted (localStorage), so once on, the dev-only menu items
 * (archive, "Remove all app data") are reachable via {@link menuAction}.
 *
 * Idempotent and self-contained: it reads the current state from whether a dev-only
 * item ("Remove all app data") is present, and toggles only if needed — robust to the
 * Switch's accessible-name quirks. (The toggle item uses `e.stopPropagation()`, so it
 * flips in place and keeps the menu open; Escape dismisses it.)
 */
export async function setDevMode(page: Page, on: boolean): Promise<void> {
  await page.getByRole("button", { name: /Account menu/ }).click();
  // Wait for the menu to actually open before reading state, or the dev-only item's
  // visibility races the open animation and could mis-toggle.
  const devToggle = page.getByRole("menuitem", { name: /Developer mode/i });
  await devToggle.waitFor({ state: "visible" });
  const isOn = await page.getByRole("menuitem", { name: /Remove all app data/i })
    .isVisible().catch(() => false);
  if (isOn !== on) await devToggle.click();
  await page.keyboard.press("Escape");
}
