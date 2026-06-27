import { SessionExpiredError } from "../services/TurtleParsing.ts";
import { ConflictError } from "../services/pod/podWrite.ts";
import { formatError } from "../lib/formatError.ts";
import { type MessageId, translate } from "../lib/messages.ts";
import { getLanguage } from "../lib/language.ts";
import { isSessionExpired } from "../services/pod/sessionGate.ts";

export type ErrorSeverity = "error" | "warning";

/**
 * The single sentence shown when the Solid session has expired, in the active UI
 * language. Reused by the session gate's logout toast (main.tsx) and every error
 * classified below as an expiry, so the notification queue collapses the duplicates
 * into one — both call this, so both get the identical string for that locale.
 */
export function sessionExpiredMessage(): string {
  return translate(getLanguage(), "sessionExpired");
}

/**
 * Meta a mutation hook declares to steer the central error toast
 * (`QueryProvider`'s MutationCache): `action` is the catalog message id (an
 * `action*` key) for the standard `"Failed to {action}: {detail}"` shape; `silent` suppresses the
 * toast entirely for mutations whose canonical error surface is an inline
 * `<Alert>` (the share dialogs' confirm step) — the component then renders
 * `mutation.error` through {@link classifyQueryError} so the wording can't fork.
 */
export interface MutationNotificationMeta {
  action?: MessageId;
  silent?: boolean;
}

/**
 * Meta a query declares to steer the central error toast (`QueryProvider`'s
 * QueryCache): `silent` suppresses the toast for a **best-effort** read whose
 * failure should degrade in place rather than alarm the user — e.g. the
 * decorative region-choropleth geometry, which simply omits the overlay when the
 * geo wrapper is unreachable. The query-side peer of `MutationNotificationMeta`'s
 * `silent`.
 */
export interface QueryNotificationMeta {
  silent?: boolean;
}

declare module "@tanstack/react-query" {
  interface Register {
    mutationMeta: MutationNotificationMeta;
    queryMeta: QueryNotificationMeta;
  }
}

/**
 * Map a query/mutation error to the user-facing notification it should produce.
 * Pure (no React) so it's unit-testable and shared by `QueryProvider`'s
 * query/mutation caches:
 * - `SessionExpiredError` (token expired) → a warning (keep data, prompt re-login).
 * - `ConflictError` (lost the optimistic-lock race) → a "reload & retry" warning.
 * - anything else → an error; with an `action` it reads
 *   `"Failed to {action}: {detail}"` ({@link formatError}), else the raw message.
 *
 * The two classified warnings ignore `action` on purpose: they are complete
 * sentences about an app-level state, not about the failed action.
 */
export function classifyQueryError(
  error: unknown,
  action?: MessageId,
): { message: string; severity: ErrorSeverity } {
  // Once the session-expiry gate has tripped, EVERY in-flight query/mutation is
  // doomed to a 401 — but only the buildings loader converts that into a
  // SessionExpiredError; a mutation or other query throws a generic
  // "… HTTP 401". Treating any error-while-expired as the expiry warning
  // (rather than a "Failed to {action}" error) stops a redundant, alarming toast
  // stacking on the gate's own logout warning. Checked before the type tests so a
  // ConflictError racing the expiry is moot too.
  if (error instanceof SessionExpiredError || isSessionExpired()) {
    // Fixed wording (not error.message, which carries HTTP detail for the log):
    // same sentence as the session-gate logout toast in main.tsx, so the
    // notification queue collapses the duplicates into one.
    return {
      message: sessionExpiredMessage(),
      severity: "warning",
    };
  }
  if (error instanceof ConflictError) {
    return {
      message: translate(getLanguage(), "conflictReload"),
      severity: "warning",
    };
  }
  return {
    message: action
      ? formatError(action, error)
      : error instanceof Error
      ? error.message
      : String(error),
    severity: "error",
  };
}

/**
 * The central mutation-error → notification mapping: honours the mutation's
 * {@link MutationNotificationMeta} (`silent` → no toast, `action` → the
 * standard phrasing). Returns `null` when nothing should be shown.
 */
export function classifyMutationError(
  error: unknown,
  meta?: MutationNotificationMeta,
): { message: string; severity: ErrorSeverity } | null {
  if (meta?.silent) return null;
  return classifyQueryError(error, meta?.action);
}

/**
 * The central query-error → notification mapping: honours the query's
 * {@link QueryNotificationMeta} (`silent` → no toast). Returns `null` when
 * nothing should be shown. The query-side peer of {@link classifyMutationError}.
 */
export function classifyQueryNotification(
  error: unknown,
  meta?: QueryNotificationMeta,
): { message: string; severity: ErrorSeverity } | null {
  if (meta?.silent) return null;
  return classifyQueryError(error);
}
