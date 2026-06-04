/**
 * Wrap a `fetch` so it retries transient throttling with exponential backoff.
 *
 * solidcommunity.net sits behind Cloudflare, which rate-limits bursts with HTTP
 * 429 (and 503). Two shapes to handle:
 *  - **same-origin / headless:** the 429/503 comes back as a readable Response.
 *  - **cross-origin browser:** Cloudflare's 429 error page carries no
 *    `Access-Control-Allow-Origin`, so the browser blocks it and the underlying
 *    (e.g. @inrupt DPoP) fetch rejects with `TypeError: Failed to fetch` — the
 *    status is never visible to JS.
 * We retry both: retryable statuses (honoring `Retry-After`) and thrown network
 * errors. Retrying is safe here because a 429/503 means the request was rejected
 * before being applied, and our writes are PUT-whole-file / re-read-then-write /
 * fold-latest append, so a replay doesn't corrupt state.
 */
export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
}

const RETRYABLE_STATUS = new Set([429, 503]);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A thrown fetch failure (network/CORS-blocked) is a `TypeError` in browsers. */
function isNetworkError(e: unknown): boolean {
  return e instanceof TypeError;
}

/** `Retry-After` in ms (delta-seconds form), or null. */
function retryAfterMs(res: Response): number | null {
  const h = res.headers.get("Retry-After");
  if (!h) return null;
  const secs = Number(h);
  return Number.isFinite(secs) ? secs * 1000 : null;
}

export function withRetry(
  fetchFn: typeof fetch,
  opts: RetryOptions = {},
): typeof fetch {
  const maxRetries = opts.maxRetries ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 500;

  return (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    let attempt = 0;
    while (true) {
      const backoff = baseDelayMs * 2 ** attempt;
      try {
        const res = await fetchFn(input, init);
        if (RETRYABLE_STATUS.has(res.status) && attempt < maxRetries) {
          await sleep(retryAfterMs(res) ?? backoff);
          attempt++;
          continue;
        }
        return res;
      } catch (e) {
        if (isNetworkError(e) && attempt < maxRetries) {
          await sleep(backoff);
          attempt++;
          continue;
        }
        throw e;
      }
    }
  }) as typeof fetch;
}
