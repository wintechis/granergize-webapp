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
 *
 * ## Why an ambient singleton (`getSourceGateway()`), not passed-in like `PodGateway`
 *
 * The two transports are reached differently *on purpose*; the split tracks
 * **identity**. `PodGateway` carries a *who* and so must be an explicit argument
 * (the intent cores take it; they never call `getSession()`):
 *   - several exist at once — the two-actor / two-pod tests run Alice's and Bob's
 *     authed sessions simultaneously, so a singleton couldn't answer "whose Pod?";
 *   - it is mutable over a session (login/logout/expiry/re-login as another user);
 *   - **mixing identities is a security bug**, so the identity belongs in the call,
 *     not in ambient state (the React Query keys are WebID-namespaced for the same
 *     reason — a re-login must not read the previous user's cache).
 *
 * `SourceGateway` carries **no** identity: it is unauthenticated, read-only, and
 * there is exactly one public external world (no "Alice's MaStR" vs "Bob's"). With
 * nothing to vary per caller and no cross-user leak possible, it is effectively
 * *configuration* (`baseOf` resolves from the static `dataSources.ts` registry +
 * env) — the canonical thing to reach ambiently. The only reason to inject it is
 * hermetic tests, met by {@link _setSourceGatewayForTesting}; you never need two
 * *different* source worlds live in one run.
 *
 * The accepted cost: an open-tier core's signature is then slightly dishonest — it
 * takes a `PodGateway` (e.g. to resolve a building's coords) while reaching this
 * singleton underneath, so the external dependency isn't visible/injectable at the
 * core boundary (the test override buys back testability, not signature clarity).
 * Rule of thumb: **thread the dependency that genuinely varies and whose mixing is
 * a bug (Pod identity); make ambient the single immutable public resource (sources).**
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
