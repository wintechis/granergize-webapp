/**
 * A tiny framework-agnostic rolling history of the toasts the app has shown —
 * the notification counterpart to the request log in {@link networkActivity}.
 * `NotificationProvider.showNotification` feeds it every emitted notice (even the
 * ones the snackbar queue collapses as consecutive duplicates, so the log shows
 * what the app TRIED to say, not just what stayed on screen), and React reads it
 * with `useNotificationLog` (useSyncExternalStore). Like the request log it is a
 * developer-mode debug affordance.
 */
import type { NotificationSeverity } from "./notificationQueue.ts";

/** One toast that was shown, kept in a bounded rolling history. */
export interface LoggedNotice {
  /** Unique, monotonic — the React render key (same supplier as the snackbar). */
  key: number;
  message: string;
  severity: NotificationSeverity;
  /** When it was emitted (epoch ms). */
  at: number;
}

/** How many recent toasts to keep for the click-to-open debug log. */
const LOG_MAX = 100;

const log: LoggedNotice[] = []; // newest first
const listeners = new Set<() => void>();
let logSnapshot: LoggedNotice[] = [];

function emit(): void {
  logSnapshot = [...log];
  for (const l of listeners) l();
}

/** Record a shown toast (newest first; bounded to the last {@link LOG_MAX}). */
export function recordNotification(notice: LoggedNotice): void {
  log.unshift(notice);
  if (log.length > LOG_MAX) log.length = LOG_MAX;
  emit();
}

export function subscribeNotificationLog(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The rolling history of shown toasts (newest first). */
export function getNotificationLog(): LoggedNotice[] {
  return logSnapshot;
}

/** Clear the notification log (the indicator's "Clear" button). */
export function clearNotificationLog(): void {
  log.length = 0;
  emit();
}
