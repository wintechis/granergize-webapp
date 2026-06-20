import { expect, type Page } from "@playwright/test";
import { T } from "./timeouts.ts";
import { t } from "./i18n.ts";
import type { MessageId } from "../../../src/lib/messages.ts";

/** Confirm-button verb → catalog id, so the helper resolves to the RUN's language
 * (the app labels the button via `msg("btn…")`, so French renders "Supprimer", not
 * "Delete"). Keep in sync with the `confirmLabel:` call sites in the app. */
const VERB_ID: Record<Verb, MessageId> = {
  "Delete": "btnDelete",
  "Revoke": "confirmRevoke",
  "Remove all": "btnRemoveAll",
  "Restore": "btnRestore",
  "Confirm": "btnConfirm",
};

type Verb = "Delete" | "Revoke" | "Remove all" | "Restore" | "Confirm";

/**
 * Click the primary button of the shared in-app confirm dialog (the MUI
 * `ConfirmProvider` that replaced the native `window.confirm` for destructive
 * actions). The button's accessible name is the action verb — given here in
 * English (`"Delete"`, "Revoke", …) but resolved to the RUN's language via the
 * catalog, so the helper works in any `E2E_LANG`. None of the verbs collides with
 * a destructive *trigger* button (those are "Delete building", "Revoke access", …),
 * so an exact-name match is unambiguous without scoping to the dialog.
 *
 * Triggering a destructive action used to need only a `page.on("dialog")`
 * auto-accept; now the spec must call this afterwards. (The Escape-while-dirty
 * "Discard your changes?" prompt is still a native dialog and still relies on
 * the `page.on("dialog")` handler.)
 */
export async function confirmDialog(
  page: Page,
  verb: Verb = "Delete",
): Promise<void> {
  const button = page.getByRole("button", { name: t(VERB_ID[verb]), exact: true });
  await expect(button).toBeVisible({ timeout: T.action });
  await button.click();
}
