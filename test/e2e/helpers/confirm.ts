import { expect, type Page } from "@playwright/test";
import { T } from "./timeouts.ts";

/**
 * Click the primary button of the shared in-app confirm dialog (the MUI
 * `ConfirmProvider` that replaced the native `window.confirm` for destructive
 * actions). The button's accessible name is the action verb — "Delete",
 * "Revoke", "Remove all", "Restore" — none of which collides with a destructive
 * *trigger* button (those are "Delete building", "Revoke access", …), so an
 * exact-name match is unambiguous without scoping to the dialog.
 *
 * Triggering a destructive action used to need only a `page.on("dialog")`
 * auto-accept; now the spec must call this afterwards. (The Escape-while-dirty
 * "Discard your changes?" prompt is still a native dialog and still relies on
 * the `page.on("dialog")` handler.)
 */
export async function confirmDialog(
  page: Page,
  verb: "Delete" | "Revoke" | "Remove all" | "Restore" | "Confirm" = "Delete",
): Promise<void> {
  const button = page.getByRole("button", { name: verb, exact: true });
  await expect(button).toBeVisible({ timeout: T.action });
  await button.click();
}
