import { Session } from "@inrupt/solid-client-authn-browser";
import { Parser, Store } from "n3";

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
export async function fetchFresh(
  url: string,
  session: Session,
): Promise<Response> {
  try {
    return await session.fetch(url, {
      cache: "no-cache",
      headers: { Accept: "text/turtle" },
    });
  } catch (e) {
    // A *thrown* fetch (vs a non-ok Response) is a network/CORS-level failure —
    // no HTTP status came back. The platform message ("NetworkError when
    // attempting to fetch resource" / "Failed to fetch") names no resource, so
    // annotate it with the URL being dereferenced for a useful error upstream.
    const detail = e instanceof Error ? e.message : String(e);
    throw new Error(`Network error fetching ${url}: ${detail}`, { cause: e });
  }
}

/**
 * GET a Pod resource and parse it (Turtle) into an n3 `Store`, with `baseIRI`
 * set to the resource URL. The one chokepoint for "read a resource I'm about to
 * n3-parse": it always goes through {@link fetchFresh}, so the read is fresh AND
 * carries `Accept: text/turtle`. (Raw `session.fetch()` reads silently relied on
 * the server's *default* serialization; a JSON-LD-native server like JSS then
 * returned JSON-LD that n3 rejects — the bug class this helper exists to prevent.)
 *
 * A non-ok response — whether the resource is missing (404) or inaccessible
 * (403) — yields an EMPTY `Store`. That's the Solid idiom "absent resource =
 * empty graph", and it lets a partial/permission failure degrade to "no data"
 * rather than throwing. Callers that must instead surface a hard read error
 * (e.g. fetching a building that is required to exist) keep their own status
 * check on `fetchFresh`.
 */
export async function readStoreOrEmpty(
  url: string,
  session: Session,
): Promise<Store> {
  const res = await fetchFresh(url, session);
  if (!res.ok) return new Store();
  return new Store(new Parser({ baseIRI: url }).parse(await res.text()));
}
