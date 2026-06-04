import {
  getDefaultSession,
  type Session,
} from "@inrupt/solid-client-authn-browser";

let override: Session | null = null;

/**
 * The active Solid session for the data hooks. Defaults to the
 * `@inrupt/solid-client-authn-browser` singleton; tests can substitute a fake
 * (offline-fixture) session via {@link _setSessionForTesting} — mirrors the
 * `_setStorageRootForTesting` seam in solidUtils.
 */
export function getSession(): Session {
  return override ?? getDefaultSession();
}

/** Test seam: override (or clear, with null) the session the hooks use. */
export function _setSessionForTesting(session: Session | null): void {
  override = session;
}
