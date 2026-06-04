import { Session } from "@inrupt/solid-client-authn-browser";

/**
 * GET a mutable Pod resource with forced revalidation, so reload-after-action
 * and read-modify-write operations see the current state rather than a stale
 * cached copy.
 *
 * `cache: "no-cache"` (revalidate) rather than the old `no-store` + `?t=` URL
 * cache-buster: it lets the conditional request carry `If-None-Match`, so an
 * unchanged resource comes back as a 304 with no body (the browser serves the
 * stored copy to us) — fresh, but cheaper than re-downloading. Dropping the
 * `?t=` also means a stable URL React Query / the HTTP cache can key on, instead
 * of a unique URL every call. (solidcommunity.net's Cloudflare reports these as
 * cf-cache-status: DYNAMIC, i.e. not edge-cached, so revalidation is honoured.)
 */
export function fetchFresh(url: string, session: Session): Promise<Response> {
  return session.fetch(url, {
    cache: "no-cache",
    headers: { Accept: "text/turtle" },
  });
}
