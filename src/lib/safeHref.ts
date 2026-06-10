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
import { logError } from "./logError.ts";

const SAFE_SCHEMES = new Set(["http:", "https:", "mailto:"]);

export function safeHref(uri: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch (err) {
    logError("parse candidate href URI", err);
    // Relative or malformed — not an absolute external URI, don't link it.
    return null;
  }
  return SAFE_SCHEMES.has(parsed.protocol) ? uri : null;
}

/**
 * Like {@link safeHref}, but for an `<img src>` that gets **string-interpolated
 * into markup** (the Leaflet logo marker builds its icon as an HTML string).
 * A third party controls the value (`foaf:logo` from the producer's profile),
 * so beyond the scheme allowlist (http/https only — no `javascript:`/`data:`)
 * the quote/angle characters are percent-encoded, so the value cannot break out
 * of the attribute even when interpolated. Percent-encoding keeps the URI
 * equivalent for fetching. Returns `null` for non-fetchable values.
 */
export function safeImageSrc(uri: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  return uri
    .replaceAll('"', "%22")
    .replaceAll("'", "%27")
    .replaceAll("<", "%3C")
    .replaceAll(">", "%3E");
}
