/**
 * Pure Cloudflare **Error 1015** ("You are being rate limited") detection, kept
 * free of any Playwright import so it can be unit-tested under `deno test` and
 * shared by the page watcher (cloudflareGuard.ts) and the run-aborting reporter
 * (cf1015Reporter.ts). See cloudflareGuard.ts for why 1015 needs special handling.
 */
export const CF_1015_SENTINEL = "##CLOUDFLARE_1015_ABORT##";

/**
 * 1015 is the literal in Cloudflare's rate-limit page, so when the body is
 * readable we confirm on it. When it isn't (`body === null` — some opaque
 * cross-origin captures) we fall back to the tell-tale shape: a Cloudflare-edge
 * 429/503 with no CORS header — i.e. NOT a normal CSS 429, which the origin serves
 * WITH a CORS header and retryFetch handles. A non-throttle status, or an origin
 * response, is never a match.
 */
export function isCloudflare1015(
  status: number,
  headers: Record<string, string>,
  body: string | null,
): boolean {
  if (status !== 429 && status !== 503) return false;
  if (body !== null) {
    return /error code:\s*1015/i.test(body) ||
      /you are being rate limited/i.test(body);
  }
  const edge = (headers["server"] || "").toLowerCase().includes("cloudflare") ||
    "cf-ray" in headers;
  const noCors = !headers["access-control-allow-origin"];
  return edge && noCors;
}
