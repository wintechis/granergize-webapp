/**
 * Scheme allowlist for rendered links. Building subject IRIs (and other RDF
 * terms) can come from another user's shared Pod, so an untrusted document could
 * carry a subject like `javascript:…` that would become a one-click-XSS link if
 * passed straight to an anchor `href`. `target="_blank"`/`rel="noopener"` do NOT
 * neutralize a `javascript:` URI.
 *
 * `safeHref` returns the original string only when it parses to an absolute URI
 * with a navigable scheme (http/https/mailto); otherwise `null`, so callers can
 * render the value as plain text instead of a link.
 */
const SAFE_SCHEMES = new Set(["http:", "https:", "mailto:"]);

export function safeHref(uri: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    // Relative or malformed — not an absolute external URI, don't link it.
    return null;
  }
  return SAFE_SCHEMES.has(parsed.protocol) ? uri : null;
}
