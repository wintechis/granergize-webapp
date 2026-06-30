import { SessionExpiredError } from "../services/turtleParsing.ts";
import { BuildingSourceError } from "../services/building/buildingSource.ts";
import { ConflictError } from "../services/pod/podWrite.ts";
import { formatError } from "../lib/formatError.ts";
import { type MessageId, translate } from "../lib/messages.ts";
import { getLanguage } from "../lib/language.ts";
import { isSessionExpired } from "../services/pod/sessionGate.ts";

export type ErrorSeverity = "error" | "warning";

/**
 * The HTTP status an error exposes, when one is recoverable from it — a
 * {@link BuildingSourceError} (its `.status`) or any read error whose message embeds
 * `HTTP <code>` (the shape `loadBuildingSource` and the bare Pod reads throw).
 * `undefined` when the error carries no attributable status.
 */
function httpStatusOf(error: unknown): number | undefined {
  if (error instanceof BuildingSourceError) return error.status;
  const message = error instanceof Error ? error.message : "";
  const m = /\bHTTP (\d{3})\b/.exec(message);
  return m ? Number(m[1]) : undefined;
}

/**
 * Whether `error` is a still-UNCONFIRMED own-Pod auth blip — a 401/403 that the
 * transport ({@link instrumentSessionFetch}) may yet recover from a background
 * token-refresh race. Mirrors the fetch wrapper's confirm-retry: until the session
 * gate is ACTUALLY tripped (`markSessionExpired`), such an error is "still
 * recovering", not a real expiry / no-access — so the UI should hold a neutral
 * loading state instead of flashing a scary "no access" / "session expired" message.
 *
 * A genuine expiry trips the gate first (the wrapper confirms an own-Pod 401 before
 * the error ever surfaces), so by the time that error arrives `isSessionExpired()`
 * is already true → `false` here → the message shows. A {@link SessionExpiredError}
 * is itself the CONFIRMED signal, so it is never treated as unconfirmed. The real
 * gap this closes is the 403 path, which the wrapper does NOT confirm-retry.
 */
export function isRecoveringSessionError(error: unknown): boolean {
  if (error == null) return false;
  if (error instanceof SessionExpiredError) return false; // already confirmed
  if (isSessionExpired()) return false; // gate tripped → no longer "recovering"
  const status = httpStatusOf(error);
  return status === 401 || status === 403;
}

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
  // A still-unconfirmed own-Pod 401/403 (a background token-refresh race the
  // transport may yet recover) must NOT toast — mirror the fetch wrapper's
  // confirm-retry and stay quiet until the session gate actually trips.
  if (isRecoveringSessionError(error)) return null;
  return classifyQueryError(error);
}
