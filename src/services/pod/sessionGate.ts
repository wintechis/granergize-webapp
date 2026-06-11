/**
 * A one-bit, framework-agnostic store for "the Solid session has expired".
 *
 * The transport ({@link instrumentSessionFetch}) trips this on the first
 * CONFIRMED own-Pod 401 (retried once to rule out a token-refresh race; foreign
 * Pods don't count — a revoked share 401s legitimately) and then short-circuits
 * every subsequent Pod request — so an expired token produces one 401 instead of
 * an N-concurrent volley (and another volley on every later mount/focus). The
 * library's `sessionExpired` event trips it too, when it fires at all. React
 * reads it with `useSyncExternalStore` and logs the user out.
 */

let expired = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

/** Mark the session expired (idempotent). Called by the transport on a 401. */
export function markSessionExpired(): void {
  if (expired) return;
  expired = true;
  emit();
}

/** Whether the session is currently known to be expired. */
export function isSessionExpired(): boolean {
  return expired;
}

/** Clear the gate — call on a fresh successful login. */
export function resetSessionGate(): void {
  if (!expired) return;
  expired = false;
  emit();
}

export function subscribeSessionGate(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSessionExpiredSnapshot(): boolean {
  return expired;
}
