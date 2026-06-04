import { SessionExpiredError } from "../services/TurtleParsingService.ts";
import { ConflictError } from "../services/utils/podWrite.ts";

export type ErrorSeverity = "error" | "warning";

/**
 * Map a query/mutation error to the user-facing notification it should produce.
 * Pure (no React) so it's unit-testable and shared by `QueryProvider`'s
 * query/mutation caches:
 * - `SessionExpiredError` (token expired) → a warning (keep data, prompt re-login).
 * - `ConflictError` (lost the optimistic-lock race) → a "reload & retry" warning.
 * - anything else → an error with its message.
 */
export function classifyQueryError(
  error: unknown,
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
    message: error instanceof Error ? error.message : String(error),
    severity: "error",
  };
}
