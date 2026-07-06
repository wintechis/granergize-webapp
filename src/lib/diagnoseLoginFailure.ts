/**
 * Turn a failed `session.login()` into a detail string that names WHY the sign-in
 * failed, recovering the HTTP status the browser's opaque "NetworkError when
 * attempting to fetch resource" hides.
 *
 * When an identity provider is down (503) or misconfigured, inrupt's OIDC
 * discovery fetch rejects with a bare `TypeError` carrying no status — the
 * platform message names neither the resource nor the code. So on failure we
 * probe the provider's own discovery document
 * (`{issuer}/.well-known/openid-configuration`) ourselves and read the status
 * off the response: a reachable-but-erroring provider (503, 404, …) yields
 * `HTTP 503 Service Unavailable`; a truly unreachable one (DNS, refused, or a
 * response the browser blocks for missing CORS headers) yields a clearer
 * "couldn't reach" line than the raw platform error. The probe is best-effort —
 * it never throws, and falls back to the original error message.
 *
 * Pure but for the injected `fetch` (a plain unauthenticated GET — OIDC
 * discovery is public), so it is unit-testable with a fake.
 */

/** The OIDC discovery URL for an issuer (one slash, whatever the issuer's trailing form). */
export function discoveryUrl(issuer: string): string {
  return `${issuer.replace(/\/+$/, "")}/.well-known/openid-configuration`;
}

export async function diagnoseLoginFailure(
  issuer: string,
  err: unknown,
  fetchFn: typeof fetch = globalThis.fetch,
): Promise<string> {
  const original = err instanceof Error ? err.message : String(err);
  const url = discoveryUrl(issuer);
  let res: Response;
  try {
    res = await fetchFn(url);
  } catch (probeErr) {
    // Our own probe also failed at the network/CORS level — no status is
    // obtainable from JS. Say so plainly instead of leaving the bare platform
    // message: the provider is unreachable or sent no CORS headers.
    const probeMsg = probeErr instanceof Error ? probeErr.message : String(probeErr);
    let host = issuer;
    try {
      host = new URL(issuer).host;
    } catch { /* keep the raw issuer */ }
    return `Couldn’t reach ${host} — it may be offline, not a Solid provider, ` +
      `or missing CORS headers (${probeMsg}).`;
  }
  if (!res.ok) {
    // The reachable-but-erroring case the opaque NetworkError hid — surface the code.
    const statusText = res.statusText ? ` ${res.statusText}` : "";
    return `The provider returned HTTP ${res.status}${statusText} for its ` +
      `OpenID configuration (${url}).`;
  }
  // Discovery itself is fine, so the login failed further along — keep the
  // original message, which now carries real signal rather than a dead end.
  return original;
}
