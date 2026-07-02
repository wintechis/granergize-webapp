import type { PodGateway } from "./podGateway.ts";
import type { Store } from "n3";
import { listDirectChildren } from "./podDelete.ts";
import { readStoreOrEmpty } from "./podFetch.ts";

/**
 * The shared primitives of every append-only event log (the sharing
 * `shared-in/`/`shared-out/` logs, the data-room membership logs): list a
 * container's EVENT children, and read one immutable event through a
 * per-gateway parse cache. One home so the logs cannot drift on the
 * server-quirk guards or re-invent the caching (dataRoom once hand-rolled
 * both).
 */

/**
 * The event resource IRIs in a log container — an empty array when the
 * container doesn't exist yet (fresh Pod). Filters out everything that is
 * never an event:
 * - sub-containers (trailing `/`);
 * - auxiliary sidecars (`.acl`/`.meta`): some servers (JSS) list them in
 *   `ldp:contains`, and folding one as an event is never right (fetching it
 *   is a wasted, uncacheable GET per fold);
 * - the caller's known in-place siblings (`exclude` — e.g. a room's `name`
 *   document), skipped by NAME rather than fetch-and-discarded.
 */
export async function listLogEvents(
  containerUri: string,
  gateway: PodGateway,
  opts: { exclude?: readonly string[] } = {},
): Promise<string[]> {
  const children = await listDirectChildren(containerUri, gateway);
  if (!children) return []; // container doesn't exist yet
  const excluded = new Set(opts.exclude ?? []);
  return children.filter((u) => {
    if (u.endsWith("/")) return false;
    const name = u.split("/").pop() ?? "";
    return !name.startsWith(".") && !excluded.has(name);
  });
}

/**
 * Parsed events per event URL, scoped per gateway (so a fresh login — or a
 * fresh fake gateway in tests — never sees another's entries). An event
 * resource is IMMUTABLE once POSTed (append-only log, server-minted IRI, never
 * rewritten), so its parse can be reused for the gateway's lifetime: a re-fold
 * then costs only the container listing, not one GET per event.
 */
const eventCacheByGateway = new WeakMap<PodGateway, Map<string, unknown>>();

/**
 * Read + parse one immutable event resource through the per-gateway cache.
 * `cacheable` guards what may be remembered: an empty/`null` parse can be a
 * TRANSIENT failure (`readStoreOrEmpty` degrades 403/throttle to an empty
 * store) and must stay retryable, so callers pass e.g. `(v) => v !== null`.
 */
export async function readEventCached<T>(
  eventUri: string,
  gateway: PodGateway,
  parse: (store: Store) => T,
  cacheable: (value: T) => boolean,
): Promise<T> {
  const cache = eventCacheByGateway.get(gateway) ?? new Map<string, unknown>();
  eventCacheByGateway.set(gateway, cache);
  const hit = cache.get(eventUri);
  if (hit !== undefined) return hit as T;
  const value = parse(await readStoreOrEmpty(eventUri, gateway));
  if (cacheable(value)) cache.set(eventUri, value);
  return value;
}
