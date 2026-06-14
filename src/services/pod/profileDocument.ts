import { Session } from "@inrupt/solid-client-authn-browser";
import { Parser, Store } from "n3";
import { fetchFresh } from "./podFetch.ts";

/**
 * One shared, session-lived cache of the logged-in user's WebID profile document
 * (`…/profile/card`), parsed into an n3 Store.
 *
 * Several independent subsystems read the same profile right after login —
 * storage-root resolution (`solidUtils.resolveStorageRoot`), the organisation
 * (`organizationManager`), and the avatar (`logoManager`) — and each used to
 * fetch + parse it on its own, so a single login GET the profile 4–5×. Routing
 * them all through {@link loadProfileStore} collapses that to one fetch: the
 * first caller fetches, the rest reuse the cached Store (and concurrent callers
 * share one in-flight request).
 *
 * The profile only changes when the app itself writes it (org/logo edits), so
 * those writes call {@link invalidateProfile} to drop the cache; the next read
 * re-fetches. Pass `{ fresh: true }` to force a re-fetch regardless.
 */

const profileDocUri = (webId: string): string => webId.split("#")[0];

/** Parsed profile Stores by document URL. Only successful reads are cached. */
const cache = new Map<string, Store>();
/** In-flight fetches by document URL, so concurrent callers share one request. */
const inflight = new Map<string, Promise<Store | null>>();

/**
 * The logged-in user's WebID profile parsed into a Store, or null if unreadable.
 * Cached for the session; concurrent first-time calls share a single fetch.
 * @operation query
 */
export function loadProfileStore(
  session: Session,
  opts: { fresh?: boolean } = {},
): Promise<Store | null> {
  const webId = session.info.webId;
  if (!webId) return Promise.resolve(null);
  return loadProfileStoreFor(webId, session, opts);
}

/**
 * An *arbitrary* agent's WebID profile parsed into a Store, or null if unreadable
 * (private/offline profiles are tolerated). Shares the same doc-URL-keyed cache
 * and in-flight dedup as {@link loadProfileStore}, so resolving a share recipient
 * or building operator reuses any profile already fetched.
 * @operation query
 */
export function loadProfileStoreFor(
  webId: string,
  session: Session,
  opts: { fresh?: boolean } = {},
): Promise<Store | null> {
  const docUri = profileDocUri(webId);

  if (!opts.fresh) {
    const cached = cache.get(docUri);
    if (cached) return Promise.resolve(cached);
    const pending = inflight.get(docUri);
    if (pending) return pending;
  }

  const promise = (async (): Promise<Store | null> => {
    // "Unreadable" is a null result, never a rejection: an HTTP error returns
    // !res.ok, and a NETWORK error (an unreachable/offline host — `fetchFresh`
    // throws) is caught here too. Resolving an arbitrary agent's WebID (a building
    // operator, a share recipient) routinely hits dead hosts, and an unhandled
    // rejection here would surface as an app-wide `pageerror`; callers expect a
    // graceful null + fragment-name fallback instead.
    let res: Response;
    try {
      res = await fetchFresh(docUri, session);
    } catch {
      return null;
    }
    if (!res.ok) return null; // don't cache failures — let the next read retry
    const store = new Store(
      new Parser({ format: "text/turtle", baseIRI: docUri }).parse(
        await res.text(),
      ),
    );
    cache.set(docUri, store);
    return store;
  })();
  inflight.set(docUri, promise);
  try {
    return promise;
  } finally {
    // Clear the in-flight slot once it settles (success already populated the
    // result cache; failure left it empty so the next call retries). The returned
    // `promise` delivers any rejection to the caller; this cleanup is a SEPARATE
    // branch, so swallow its rejection — a bare `.finally` would surface the same
    // failure a second time as an unhandled rejection (no-floating-promises caught it).
    promise
      .finally(() => {
        if (inflight.get(docUri) === promise) inflight.delete(docUri);
      })
      .catch(() => {});
  }
}

/**
 * Drop the cached profile so the next {@link loadProfileStore} re-fetches. Call
 * after writing the profile (org/logo). With no argument, clears everything
 * (e.g. on logout).
 */
export function invalidateProfile(webId?: string): void {
  if (webId) cache.delete(profileDocUri(webId));
  else cache.clear();
}

/** Test seam: wipe all cached state between cases. */
export function _resetProfileCacheForTesting(): void {
  cache.clear();
  inflight.clear();
}
