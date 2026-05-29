import { Session } from "@inrupt/solid-client-authn-browser";

/**
 * GET a mutable Pod resource while bypassing the HTTP cache, so reload-after-
 * action and read-modify-write operations see the current state rather than a
 * stale cached copy. The `?t=` cache-buster also defeats edge/CDN caching.
 *
 * Callers should keep parsing with the canonical (query-less) URL as the RDF
 * baseIRI — only the request URL carries the cache-buster.
 */
export function fetchFresh(url: string, session: Session): Promise<Response> {
  return session.fetch(`${url}?t=${Date.now()}`, {
    cache: "no-store",
    headers: { Accept: "text/turtle" },
  });
}
