/**
 * Standard phrasing for an error notification: `Failed to {action}: {detail}`.
 *
 * Use it so every error toast in the app reads the same way (UI-conventions: a
 * small, consistent message vocabulary instead of one-off "X failed" / "Error
 * X" / "Could not X" variants):
 *
 *   showNotification(formatError("save the building", err), "error");
 *
 * `action` is a lowercase verb phrase ("save the building", "revoke access").
 * `err` is unwrapped to its `.message` when it's an Error, else stringified.
 */
export function formatError(action: string, err: unknown): string {
  const detail = err instanceof Error ? err.message : String(err);
  return `Failed to ${action}: ${detail}`;
}
