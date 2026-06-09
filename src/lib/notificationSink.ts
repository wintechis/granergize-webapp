/**
 * A tiny framework-agnostic bridge so non-React service code can raise a
 * user-facing notification through the one NotificationContext snackbar — the
 * same "non-React feeds it, React reads it" shape as the networkActivity store.
 *
 * The NotificationProvider registers the real `showNotification` at mount; until
 * then (unit tests, pre-mount) `emitNotification` is a no-op, so service code
 * never depends on React being present. Use this ONLY for events that originate
 * deep in the data layer (e.g. first-time container provisioning); React code
 * with context in hand should keep calling `showNotification` directly.
 */
export type NotificationSeverity = "error" | "warning" | "info" | "success";

let sink: ((message: string, severity: NotificationSeverity) => void) | null =
  null;

/** Register (or, with null, clear) the app's notifier. Called by NotificationProvider. */
export function setNotificationSink(
  fn: ((message: string, severity: NotificationSeverity) => void) | null,
): void {
  sink = fn;
}

/** Raise a notification from non-React code; a no-op when no sink is registered. */
export function emitNotification(
  message: string,
  severity: NotificationSeverity = "info",
): void {
  sink?.(message, severity);
}
