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

const profileDocUrl = (webId: string): string => webId.split("#")[0];

/** Parsed profile Stores by document URL. Only successful reads are cached. */
const cache = new Map<string, Store>();
/** In-flight fetches by document URL, so concurrent callers share one request. */
const inflight = new Map<string, Promise<Store | null>>();

/**
 * The logged-in user's WebID profile parsed into a Store, or null if unreadable.
 * Cached for the session; concurrent first-time calls share a single fetch.
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
 */
export function loadProfileStoreFor(
  webId: string,
  session: Session,
  opts: { fresh?: boolean } = {},
): Promise<Store | null> {
  const docUrl = profileDocUrl(webId);

  if (!opts.fresh) {
    const cached = cache.get(docUrl);
    if (cached) return Promise.resolve(cached);
    const pending = inflight.get(docUrl);
    if (pending) return pending;
  }

  const promise = (async (): Promise<Store | null> => {
    const res = await fetchFresh(docUrl, session);
    if (!res.ok) return null; // don't cache failures — let the next read retry
    const store = new Store(
      new Parser({ format: "text/turtle", baseIRI: docUrl }).parse(
        await res.text(),
      ),
    );
    cache.set(docUrl, store);
    return store;
  })();
  inflight.set(docUrl, promise);
  try {
    return promise;
  } finally {
    // Clear the in-flight slot once it settles (success already populated the
    // result cache; failure left it empty so the next call retries).
    promise.finally(() => {
      if (inflight.get(docUrl) === promise) inflight.delete(docUrl);
    });
  }
}

/**
 * Drop the cached profile so the next {@link loadProfileStore} re-fetches. Call
 * after writing the profile (org/logo). With no argument, clears everything
 * (e.g. on logout).
 */
export function invalidateProfile(webId?: string): void {
  if (webId) cache.delete(profileDocUrl(webId));
  else cache.clear();
}

/** Test seam: wipe all cached state between cases. */
export function _resetProfileCacheForTesting(): void {
  cache.clear();
  inflight.clear();
}
