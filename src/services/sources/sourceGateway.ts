/**
 * The **public-source transport port** — the read-only, unauthenticated peer of
 * {@link ../pod/podGateway.ts | PodGateway}. Where `PodGateway` abstracts the
 * authed Solid transport, `SourceGateway` abstracts the public external sources
 * (the `linked-*` wrappers, Nominatim, Wikidata/Commons): a non-DPoP, retried,
 * activity-tracked `fetch` plus base resolution by source id.
 *
 * It is the single injectable seam for external reads. In the app it wraps
 * {@link trackedFetch} + the `sourceBase` registry resolver
 * (`getSourceGateway()`); in unit/headless tests it is built from a fake `fetch`
 * serving in-memory fixtures (`sourceGateway(fakeFetch, …)`), so the same source
 * services run hermetically — closing the `headless:local` real-host gap.
 *
 * The capability vocabulary (`deref`/`search`/`bbox`/`point`/`contains`/`filter`)
 * lives as typed helpers OVER this port in `./capabilities.ts`, not on it — the
 * port stays as thin as `PodGateway`.
 */
import { type SourceId, sourceBase } from "../../constants/dataSources.ts";
import { trackedFetch } from "../../lib/networkActivity.ts";

/**
 * The public transport: the standard `fetch` shape plus an optional `label` (the
 * dev request-log description). `trackedFetch` matches this exactly; a test fake
 * supplies a `fetch` that ignores the label.
 */
export type SourceFetch = (
  input: string | URL | Request,
  init?: RequestInit,
  label?: string,
) => Promise<Response>;

/** The port: a flat `{ fetch, baseOf }`, mirroring `PodGateway`'s minimalism. */
export interface SourceGateway {
  /** The public (tracked, retried, non-DPoP) transport — never the authed session. */
  readonly fetch: SourceFetch;
  /** Resolve a source id to its base IRI (env-overridable, CORS-direct). */
  baseOf(source: SourceId): string;
}

/**
 * Build a gateway from a bare `fetch` (+ optional base resolver) — the headless /
 * test constructor, paralleling `podGateway(fetch, webId)`. Defaults `baseOf` to
 * the registry resolver so a test can override only the transport and still get
 * real base IRIs (or pass a fixture `baseOf` to redirect them).
 */
export function sourceGateway(
  fetch: SourceFetch,
  baseOf: (source: SourceId) => string = sourceBase,
): SourceGateway {
  return { fetch, baseOf };
}

/**
 * The real gateway: `trackedFetch` + the `sourceBase` registry resolver
 * (`import.meta.env` ?? `Deno.env` ?? registered base).
 */
export function defaultSourceGateway(): SourceGateway {
  return { fetch: trackedFetch, baseOf: sourceBase };
}

let override: SourceGateway | null = null;

/**
 * The composition root for external reads. Source services call this INTERNALLY
 * (the gateway is a process-global, read-only singleton — unlike `PodGateway`'s
 * per-session identity — so it is not threaded as a parameter, mirroring how Pod
 * code calls `getStorageRoot()`). Returns the real `trackedFetch` gateway unless
 * a test has installed a fake via {@link _setSourceGatewayForTesting}.
 */
export function getSourceGateway(): SourceGateway {
  return override ?? defaultSourceGateway();
}

/** Test seam: override (or clear, with null) the gateway source services read —
 *  the external-source peer of `_setSessionForTesting`. */
export function _setSourceGatewayForTesting(gw: SourceGateway | null): void {
  override = gw;
}
