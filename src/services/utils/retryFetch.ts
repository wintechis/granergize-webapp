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

/**
 * Whether a thrown fetch failure is worth retrying.
 *  - A network / CORS-blocked failure is a `TypeError` in browsers.
 *  - A `net::ERR_ABORTED` surfaces as a `DOMException` `AbortError`. The browser
 *    aborts a request for transient connection reasons too (e.g. a reused
 *    keep-alive connection the server has closed) — and crucially CSS often has
 *    ALREADY applied the write (returns 201) before the socket drops, so the app
 *    sees a failure for a write that actually landed. Our writes are idempotent
 *    (PUT-whole-file / append-via-POST), so replaying is safe. BUT a request the
 *    CALLER aborted on purpose (its own `signal` is aborted — e.g. the Cancel
 *    button on a long upload) must NOT be retried.
 */
function isRetryableError(e: unknown, init?: RequestInit): boolean {
  if (e instanceof TypeError) return true;
  if (e instanceof DOMException && e.name === "AbortError") {
    return init?.signal?.aborted !== true;
  }
  return false;
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
  // Backoff doubles per attempt, so the default 2 s base gives 2 s → 4 s → 8 s
  // across the 3 retries — generous spacing for Cloudflare's rate limiter to relax
  // (a `Retry-After` header, when present, overrides the computed backoff).
  const baseDelayMs = opts.baseDelayMs ?? 2000;

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
        if (isRetryableError(e, init) && attempt < maxRetries) {
          await sleep(backoff);
          attempt++;
          continue;
        }
        throw e;
      }
    }
  }) as typeof fetch;
}
