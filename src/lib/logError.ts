/**
 * Log a swallowed / best-effort error for debugging.
 *
 * Use this at every `catch` that would otherwise DISCARD the error — fire-and-forget
 * effects, cleanup/teardown, and fallbacks whose failure must not break the flow but
 * is still worth seeing. The app keeps its best-effort behaviour (the error is not
 * re-thrown), but the failure stops being invisible in the console, which is what
 * makes intermittent Pod/sharing/seed problems diagnosable.
 *
 * `context` is a short "what was being attempted" tag, e.g. "drain inbox" or
 * "revoke files-container access". It is NOT user-facing — transient user messages
 * still go through `NotificationContext` / `formatError`; this only feeds the
 * developer console.
 *
 * Reserve plain `catch {}` (no call here) for the handful of cases where the throw is
 * EXPECTED control flow and a log would be pure noise (e.g. "URL.parse failed → keep
 * the raw string"); add a comment there saying so.
 */
export function logError(context: string, err: unknown): void {
  console.error(`[granergize] ${context}:`, err);
}
