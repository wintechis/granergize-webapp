// Test-only module: the shared offline-fixture fake Session for Tier-1 unit
// tests. Never import from app code — it must stay out of the bundle.
import type { Session } from "@inrupt/solid-client-authn-browser";

/** One recorded request (query string already stripped from `url`). */
export interface FakeSessionCall {
  method: string;
  url: string;
  body?: string;
}

export interface FakeSessionOptions {
  /** WebID reported by `session.info` (default `https://pod.example/profile/card#me`). */
  webId?: string;
  /** Initial url → Turtle bodies, copied into the live `store`. */
  resources?: Record<string, string>;
  /** Serve an incrementing `ETag` on GET hits (exercises If-Match writes); off by
   *  default so read-modify-write degrades to the plain-PUT path. */
  etags?: boolean;
  /** Synthesize an `ldp:contains` listing for a GET of a container IRI (ends `/`)
   *  that has no stored body, from the store's direct children. */
  listContainers?: boolean;
  /** Escape hatch for per-test quirks: runs first; return a `Response` to
   *  short-circuit, or `undefined` to fall through to the default behaviour
   *  (an async hook may also just delay/observe, then fall through). */
  respond?: (
    url: string,
    init?: RequestInit,
  ) => Response | undefined | Promise<Response | undefined>;
}

export interface FakeSession {
  session: Session;
  /** The live in-memory Pod: url → body. Mutate/inspect freely. */
  store: Record<string, string>;
  /** Every request, in order. */
  calls: FakeSessionCall[];
}

/**
 * A minimal in-memory Pod behind a fake logged-in `Session`, so data-layer
 * functions run end-to-end with no network. Defaults: GET serves the stored
 * body as `text/turtle` (404 when absent); PUT/POST store the body (201);
 * DELETE removes it (205, 404 when absent); HEAD is 200 iff the resource is
 * stored (or is a container under `listContainers`). The query string is
 * stripped, every call is recorded, and `respond` overrides per URL.
 */
export function makeFakeSession(opts: FakeSessionOptions = {}): FakeSession {
  const {
    webId = "https://pod.example/profile/card#me",
    etags = false,
    listContainers = false,
    respond,
  } = opts;
  const store: Record<string, string> = { ...opts.resources };
  const calls: FakeSessionCall[] = [];
  let seq = 0;

  const turtle = (body: string): Response => {
    const headers: Record<string, string> = { "Content-Type": "text/turtle" };
    if (etags) headers["ETag"] = `"etag-${++seq}"`;
    return new Response(body, { status: 200, headers });
  };

  /** Direct children of `container` derived from the stored keys. */
  const directChildren = (container: string): string[] => {
    const seen = new Set<string>();
    for (const key of Object.keys(store)) {
      if (!key.startsWith(container) || key === container) continue;
      const rest = key.slice(container.length);
      const slash = rest.indexOf("/");
      seen.add(slash === -1 ? key : `${container}${rest.slice(0, slash)}/`);
    }
    return [...seen];
  };

  const fetch = async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const raw = typeof input === "string"
      ? input
      : input instanceof URL
      ? input.href
      : input.url;
    // Strip query AND fragment: a real fetch never sends either to the server
    // (the fragment is client-side), so a fixture keyed by the resource IRI
    // must match a request URL that still carries `#…`.
    const url = raw.split("?")[0].split("#")[0];
    const method = (init?.method ?? "GET").toUpperCase();
    const body = init?.body != null ? String(init.body) : undefined;
    calls.push({ method, url, body });

    const overridden = await respond?.(url, init);
    if (overridden) return overridden;

    const isContainer = listContainers && url.endsWith("/");
    if (method === "PUT" || method === "POST") {
      if (body !== undefined) store[url] = body;
      return new Response(null, { status: 201 });
    }
    if (method === "DELETE") {
      const existed = url in store;
      delete store[url];
      return new Response(null, { status: existed ? 205 : 404 });
    }
    if (method === "HEAD") {
      const ok = url in store || isContainer;
      return new Response(null, { status: ok ? 200 : 404 });
    }
    // GET
    const stored = store[url];
    if (stored !== undefined) return turtle(stored);
    if (isContainer) {
      const refs = directChildren(url).map((c) => `<${c}>`).join(", ");
      return turtle(
        `@prefix ldp: <http://www.w3.org/ns/ldp#> .\n<${url}> a ldp:Container${
          refs ? ` ; ldp:contains ${refs}` : ""
        } .\n`,
      );
    }
    return new Response("Not found", { status: 404, statusText: "Not Found" });
  };

  return {
    session: { info: { isLoggedIn: true, webId }, fetch } as unknown as Session,
    store,
    calls,
  };
}
