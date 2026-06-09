/**
 * Normalize a user-entered Solid identity-provider value into an issuer URI.
 *
 * A bare domain (`inrupt.net`) gets `https://` prepended; a value that ALREADY
 * carries a scheme is taken as-is — so a full `https://…` URL, or an
 * `http://localhost:3456/` dev/test IdP, is no longer mangled into
 * `https://http://…` (which produced an unresolvable issuer + "correct URI"
 * error). Surrounding whitespace is trimmed.
 */
export function normalizeIssuer(input: string): string {
  const value = input.trim();
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}
