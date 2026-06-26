// Test-only module: the offline-fixture fake SourceGateway, the external-source
// peer of fakeSession.ts. Never import from app code — it must stay out of the
// bundle. Lets unit/headless tests run the source modules with no network by
// serving canned wrapper responses by URL.
import {
  type SourceId,
  sourceBase,
} from "../../constants/dataSources.ts";
import type {
  SourceFetch,
  SourceGateway,
} from "../sources/sourceGateway.ts";

/** One recorded request (fragment stripped from `url`; query kept). */
export interface FakeSourceCall {
  method: string;
  url: string;
}

export interface FakeSourceGatewayOptions {
  /** Source id → base IRI. Defaults to the real registry resolver
   *  (`sourceBase`), so fixtures key off the production bases; pass a map to use
   *  short, readable test bases instead. */
  baseOf?: (source: SourceId) => string;
  /** Exact full-URL (query kept, fragment stripped) → response body. Served as
   *  `text/turtle` unless `contentType` is given. */
  resources?: Record<string, string>;
  /** Content-Type for `resources` bodies (default `text/turtle`); use
   *  `application/json` / `application/geo+json` for the non-RDF carve-outs. */
  contentType?: string;
  /** Escape hatch: runs first with the full URL (query kept); return a `Response`
   *  to short-circuit, or `undefined` to fall through to `resources` / 404. */
  respond?: (
    url: string,
    init?: RequestInit,
  ) => Response | undefined | Promise<Response | undefined>;
}

export interface FakeSourceGateway {
  /** The port to install via `_setSourceGatewayForTesting` or pass directly. */
  gateway: SourceGateway;
  /** Every request, in order. */
  calls: FakeSourceCall[];
}

/**
 * A fake `SourceGateway` serving in-memory wrapper responses. GET-only (external
 * sources are read-only): a request matches `respond` first, then an exact
 * `resources` entry, else 404. The query string is KEPT (external discovery
 * encodes its params there); only the fragment is stripped (a real fetch never
 * sends `#…`), so a `deref` of `…/see/123#it` matches a fixture keyed `…/see/123`.
 */
export function makeFakeSourceGateway(
  opts: FakeSourceGatewayOptions = {},
): FakeSourceGateway {
  const {
    baseOf = sourceBase,
    resources = {},
    contentType = "text/turtle",
    respond,
  } = opts;
  const calls: FakeSourceCall[] = [];

  const fetch: SourceFetch = async (input, init) => {
    const raw = typeof input === "string"
      ? input
      : input instanceof URL
      ? input.href
      : input.url;
    const url = raw.split("#")[0];
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({ method, url });

    const overridden = await respond?.(url, init);
    if (overridden) return overridden;

    const body = resources[url];
    if (body !== undefined) {
      return new Response(body, {
        status: 200,
        headers: { "Content-Type": contentType },
      });
    }
    return new Response("Not found", { status: 404, statusText: "Not Found" });
  };

  return { gateway: { fetch, baseOf }, calls };
}
