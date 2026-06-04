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
