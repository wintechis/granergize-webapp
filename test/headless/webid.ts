/// <reference lib="deno.ns" />
/**
 * Solid-OIDC WebID verification for the headless tiers.
 *
 * A WebID is an opaque URI: per the WebID/Solid-OIDC specs you don't construct it,
 * you obtain it from the token's `webid` claim — and you only trust that claim after
 * confirming the WebID document authorizes the OP that issued it (otherwise a rogue
 * OP could assert someone else's WebID). In the browser the auth library does this
 * check; the headless tiers bypass the library (CSS hand-rolls client-credentials,
 * JSS uses a bare bearer token), so we do the same check here: dereference the WebID
 * profile and confirm `<webid> solid:oidcIssuer <iss>`.
 *
 * https://solidproject.org/TR/oidc#determining-the-webid
 */
import { DataFactory, Parser, Store } from "n3";

const SOLID_OIDC_ISSUER = "http://www.w3.org/ns/solid/terms#oidcIssuer";
const stripSlash = (s: string) => s.replace(/\/+$/, "");

/**
 * True iff the parsed profile asserts `<webId> solid:oidcIssuer <issuer>`
 * (trailing-slash-insensitive). Pure — unit-tested without a server.
 */
export function profileAuthorizesIssuer(
  profileText: string,
  webId: string,
  issuer: string,
  baseIRI: string,
): boolean {
  const store = new Store(new Parser({ baseIRI }).parse(profileText));
  return store
    .getQuads(
      DataFactory.namedNode(webId),
      DataFactory.namedNode(SOLID_OIDC_ISSUER),
      null,
      null,
    )
    .some((q) => stripSlash(q.object.value) === stripSlash(issuer));
}

/**
 * Verify, per Solid-OIDC, that `webId` authorizes `issuer`: dereference the WebID
 * profile and confirm its `solid:oidcIssuer`. Throws if the profile is unreadable or
 * doesn't list the issuer — which also catches a wrong/constructed WebID, since a bad
 * URI won't dereference to a matching profile. WebID profiles are public, so a plain
 * (unauthenticated) fetch suffices; `fetchFn` is injectable for tests.
 */
export async function verifyWebId(
  webId: string,
  issuer: string,
  fetchFn: typeof fetch = fetch,
): Promise<void> {
  const doc = webId.split("#")[0];
  const res = await fetchFn(doc, { headers: { Accept: "text/turtle" } });
  if (!res.ok) {
    throw new Error(`WebID verification: profile ${doc} not readable (HTTP ${res.status})`);
  }
  if (!profileAuthorizesIssuer(await res.text(), webId, issuer, doc)) {
    throw new Error(
      `WebID verification failed (Solid-OIDC): ${webId} does not assert ` +
        `solid:oidcIssuer <${issuer}> in its profile`,
    );
  }
}
