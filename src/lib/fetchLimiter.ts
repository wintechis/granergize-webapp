import { createLimiter } from "./pool.ts";

/**
 * Wrap a `fetch` so at most `max` calls are in flight at once; excess calls
 * queue (FIFO) and dispatch as slots free up.
 *
 * Why: the post-login load fans out one request per building file, energy
 * dataset and sharing-log entry. Over HTTP/2 the browser multiplexes them all
 * at once, and Cloudflare-fronted Pods (solidcommunity.net) answer such a burst
 * with 429s that can outlast the retry backoff — surfacing as "Failed to …"
 * toasts exactly when the user starts acting right after login (heike-5 #3).
 * Capping concurrency smooths the burst at the source AND makes early user
 * actions queue behind it instead of piling on.
 *
 * A slot is held from dispatch until the fetch settles — for a wrapped
 * retrying fetch that includes its backoff sleeps, which throttles the whole
 * pipeline exactly while the server is asking for relief. Settling means
 * headers arrived; streaming the body does NOT hold a slot.
 */
export const MAX_CONCURRENT_POD_REQUESTS = 6;

export function withConcurrencyLimit(
  fetchFn: typeof fetch,
  max: number = MAX_CONCURRENT_POD_REQUESTS,
): typeof fetch {
  // One shared gate for the wrapped fetch's lifetime — the same acquire/release
  // queue as every other bounded fan-out (lib/pool), not a re-implementation.
  const limit = createLimiter(max);
  return ((input: Parameters<typeof fetch>[0], init?: RequestInit) =>
    limit(() => fetchFn(input, init))) as typeof fetch;
}
