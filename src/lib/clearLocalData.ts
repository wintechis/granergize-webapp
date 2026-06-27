/**
 * Wipe all client-side auth/session storage for this origin.
 *
 * The Solid auth library (`@inrupt/solid-client-authn-browser`) caches the
 * dynamic OIDC client registration and DPoP keys across `localStorage` AND
 * IndexedDB. When that registration goes stale the IdP rejects the silent
 * restore with an "Unknown client" error; the only client-side remedy is to
 * drop both stores so the next login registers afresh. `sessionStorage` is
 * cleared too for good measure.
 *
 * Best-effort: a store that refuses to clear is swallowed so the others still
 * run. Resolves once IndexedDB deletion has settled.
 */
/**
 * Whether there is any client-side storage that {@link clearLocalData} would wipe
 * — so the "Trouble signing in?" remedy is offered only when clearing would
 * actually do something. The sync stores are checked immediately; IndexedDB
 * (where the auth library keeps its OIDC client registration + DPoP keys) is
 * enumerated asynchronously. Best-effort: a store that refuses inspection is
 * treated as empty.
 */
export async function hasLocalData(): Promise<boolean> {
  try {
    if (localStorage.length > 0) return true;
  } catch {
    // ignore — try the next store
  }
  try {
    if (sessionStorage.length > 0) return true;
  } catch {
    // ignore
  }
  if (typeof indexedDB !== "undefined" && indexedDB.databases) {
    try {
      const dbs = await indexedDB.databases();
      if (dbs.some((d) => Boolean(d.name))) return true;
    } catch {
      // ignore — enumeration is best-effort
    }
  }
  return false;
}

export async function clearLocalData(): Promise<void> {
  try {
    localStorage.clear();
  } catch {
    // ignore — fall through to the other stores
  }
  try {
    sessionStorage.clear();
  } catch {
    // ignore
  }
  if (typeof indexedDB !== "undefined" && indexedDB.databases) {
    try {
      const dbs = await indexedDB.databases();
      await Promise.all(
        dbs
          .map((d) => d.name)
          .filter((name): name is string => Boolean(name))
          .map(
            (name) =>
              new Promise<void>((resolve) => {
                const req = indexedDB.deleteDatabase(name);
                req.onsuccess = req.onerror = req.onblocked = () => resolve();
              }),
          ),
      );
    } catch {
      // ignore — IndexedDB enumeration/deletion is best-effort
    }
  }
}
