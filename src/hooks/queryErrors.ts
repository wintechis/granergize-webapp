import { SessionExpiredError } from "../services/TurtleParsingService.ts";
import { ConflictError } from "../services/pod/podWrite.ts";
import { formatError } from "../lib/formatError.ts";

export type ErrorSeverity = "error" | "warning";

/**
 * Meta a mutation hook declares to steer the central error toast
 * (`QueryProvider`'s MutationCache): `action` is the lowercase verb phrase for
 * the standard `"Failed to {action}: {detail}"` shape; `silent` suppresses the
 * toast entirely for mutations whose canonical error surface is an inline
 * `<Alert>` (the share dialogs' confirm step) — the component then renders
 * `mutation.error` through {@link classifyQueryError} so the wording can't fork.
 */
export interface MutationNotificationMeta {
  action?: string;
  silent?: boolean;
}

declare module "@tanstack/react-query" {
  interface Register {
    mutationMeta: MutationNotificationMeta;
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
  action?: string,
): { message: string; severity: ErrorSeverity } {
  if (error instanceof SessionExpiredError) {
    return { message: error.message, severity: "warning" };
  }
  if (error instanceof ConflictError) {
    return {
      message: "This changed elsewhere — please reload and try again.",
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
