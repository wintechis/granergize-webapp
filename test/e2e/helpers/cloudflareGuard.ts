import { type Page, type Response } from "@playwright/test";
import { CF_1015_SENTINEL, isCloudflare1015 } from "./cloudflare1015.ts";

/**
 * Cloudflare emits **Error 1015** ("You are being rate limited") as an edge HTTP
 * 429 page when a Pod host behind Cloudflare (solidcommunity.net) is hammered by a
 * burst of logins/writes. That page carries no `Access-Control-Allow-Origin`, so
 * the app's own JS only sees `TypeError: Failed to fetch` (see retryFetch.ts): it
 * can't tell 1015 apart from a transient blip, so it burns every retry/backoff and
 * then a multi-minute timeout. And once the edge limiter has tripped it won't relax
 * inside the run, so every remaining spec just repeats the same slow failure.
 *
 * Playwright sees the raw 429 at the network layer (CORS doesn't gate it), so we
 * detect 1015 here and write a one-shot sentinel to stderr. The companion reporter
 * (`cf1015Reporter.ts`) runs in the main process and exits the whole run the moment
 * it sees that sentinel — so we stop fast instead of grinding. Attach once per page
 * (login() does this for every spec). Detection logic lives in `cloudflare1015.ts`.
 */
export { CF_1015_SENTINEL };

// One announcement per worker process is enough; the reporter exits on the first.
let announced = false;

export function watchCloudflareRateLimit(page: Page): void {
  page.on("response", (res) => {
    const status = res.status();
    if (status !== 429 && status !== 503) return;
    void confirmAndAnnounce(res, status);
  });
}

async function confirmAndAnnounce(res: Response, status: number): Promise<void> {
  if (announced) return;
  const headers = res.headers();
  const body = await res.text().catch(() => null);
  if (!isCloudflare1015(status, headers, body) || announced) return;
  announced = true;
  process.stderr.write(
    `\n${CF_1015_SENTINEL} Cloudflare Error 1015 (rate limited) at ${res.url()} ` +
      `[HTTP ${status}] — aborting run\n`,
  );
}
