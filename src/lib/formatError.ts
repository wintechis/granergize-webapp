import { getLanguage } from "./language.ts";
import { type MessageId, translate } from "./messages.ts";

/**
 * Standard phrasing for an error notification: `Failed to {action}: {detail}` —
 * now locale-aware. `action` is a catalog message id naming the failed operation
 * (e.g. `"actionSaveEnergy"`); both the template and the action phrase come from
 * the message catalog in the active UI language, so every error toast reads the
 * same way and translates at once (UI-conventions: one small message vocabulary).
 *
 *   showNotification(formatError("actionAddAgent", err), "error");
 *
 * Pure (reads the active locale from the `language` store, no React) so it works
 * in services and the central mutation-error handler alike. `err` is unwrapped to
 * its `.message` when it's an Error, else stringified.
 */
export function formatError(action: MessageId, err: unknown): string {
  const detail = err instanceof Error ? err.message : String(err);
  const lang = getLanguage();
  return translate(lang, "failedTo", { action: translate(lang, action), detail });
}
