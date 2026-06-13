/**
 * Map over `items` running `fn` with at most `limit` calls in flight at once,
 * preserving result order.
 *
 * Bounds concurrency so we don't fire a burst of Pod requests in parallel: CDNs /
 * rate-limiters (e.g. Cloudflare in front of solidcommunity.net) answer bursts
 * with HTTP 429, and those 429 responses carry no `Access-Control-Allow-Origin`
 * header — so in the browser they surface as opaque CORS / "Failed to fetch"
 * errors rather than a retryable status. A small pool keeps each wave under the
 * limit while staying faster than fully serial.
 */
/** Runs `fn` when a slot is free; see {@link createLimiter}. */
export type Limiter = <R>(fn: () => Promise<R>) => Promise<R>;

/**
 * A shared concurrency gate: at most `limit` calls run at once across EVERY
 * invocation of the returned function — for the whole lifetime of that one
 * limiter, not per-call like {@link mapPooled}.
 *
 * Use this (not mapPooled) to bound a RECURSIVE fan-out. mapPooled caps a single
 * map; if the work each item triggers itself calls mapPooled, the caps multiply
 * — N per level, M levels deep = N^M in flight. One limiter threaded through the
 * recursion holds the true global ceiling regardless of depth. Acquire a slot
 * only around the leaf I/O (never held across a recursive descent), so a tree
 * deeper than `limit` can't deadlock waiting on its own slots.
 */
export function createLimiter(limit: number): Limiter {
  let active = 0;
  const waiters: Array<() => void> = [];
  return async function run<R>(fn: () => Promise<R>): Promise<R> {
    if (active >= limit) await new Promise<void>((resolve) => waiters.push(resolve));
    active++;
    try {
      return await fn();
    } finally {
      active--;
      waiters.shift()?.();
    }
  };
}

export async function mapPooled<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workerCount = Math.max(1, Math.min(limit, items.length));
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: workerCount }, worker));
  return results;
}
