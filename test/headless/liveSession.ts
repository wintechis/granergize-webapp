/// <reference lib="deno.ns" />
/**
 * Headless authenticated Solid session for integration tests, built against a
 * Community Solid Server (e.g. solidcommunity.net) using the CSS account API +
 * the OAuth client-credentials grant with DPoP.
 *
 * We hand-roll the DPoP flow instead of using @inrupt/solid-client-authn-node
 * because that library's openid-client/jose stack generates a non-extractable
 * CryptoKey that throws under Deno ("CryptoKey is not extractable"). Here we mint
 * our own *extractable* ES256 key, sign the DPoP proofs ourselves, and return a
 * `fetch` that is shape-compatible with the app's `Session` (so the real
 * data-layer functions run unchanged).
 *
 * Nothing here is committed credentials — they come from the environment
 * (.env.e2e.local), throwaway pods only.
 */
import { exportJWK, generateKeyPair, type JWK, type KeyLike, SignJWT } from "npm:jose@4";

export interface LiveSessionLike {
  info: { webId: string; isLoggedIn: true };
  fetch: (input: string | URL, init?: RequestInit) => Promise<Response>;
  /** Tear down the minted client-credentials token on the server. */
  dispose: () => Promise<void>;
}

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function ath(accessToken: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(accessToken),
  );
  return b64url(new Uint8Array(digest));
}

/**
 * Discover an account's WebID via the CSS account API — the spec way (don't construct
 * it): password-login for an account token, GET `/.account/`, then read the single
 * linked WebID from the `webid` control (the keys of `webIdLinks`). Lets the headless
 * CSS backend bind client-credentials to a *discovered* WebID, never a templated
 * `…/profile/card#me`.
 */
export async function discoverWebId(
  issuer: string,
  email: string,
  password: string,
): Promise<string> {
  const login = await (await fetch(`${issuer}/.account/login/password/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  })).json();
  const accountToken: string = login.authorization;
  if (!accountToken) throw new Error(`CSS account login failed for ${email}`);
  const auth = { Authorization: `CSS-Account-Token ${accountToken}` };
  const acct = await (await fetch(`${issuer}/.account/`, { headers: auth })).json();
  const webIdControl: string | undefined = acct?.controls?.account?.webId;
  if (!webIdControl) throw new Error("CSS account API exposes no webId control");
  const doc = await (await fetch(webIdControl, { headers: auth })).json();
  const webIds = Object.keys(doc?.webIdLinks ?? {});
  if (webIds.length === 0) throw new Error(`CSS account ${email} has no linked WebID`);
  return webIds[0];
}

/**
 * Authenticate `email`/`password` against `issuer` (CSS) and return a session-like
 * object whose `fetch` carries a DPoP-bound access token.
 */
export async function getLiveSession(
  issuer: string,
  email: string,
  password: string,
  webId: string,
): Promise<LiveSessionLike> {
  // 1. CSS account password login → short-lived account authorization token.
  const login = await (await fetch(`${issuer}/.account/login/password/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  })).json();
  const accountToken: string = login.authorization;
  if (!accountToken) throw new Error("CSS account login failed");

  // 2. Discover the client-credentials control on the (authenticated) account.
  const acct = await (await fetch(`${issuer}/.account/`, {
    headers: { Authorization: `CSS-Account-Token ${accountToken}` },
  })).json();
  const ccUrl: string = acct.controls.account.clientCredentials;

  // 3. Mint client credentials bound to the WebID.
  const cc = await (await fetch(ccUrl, {
    method: "POST",
    headers: {
      Authorization: `CSS-Account-Token ${accountToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name: "granergize-datalayer-it", webId }),
  })).json();
  const { id, secret, resource } = cc as {
    id: string;
    secret: string;
    resource?: string;
  };

  // 4. Our own extractable ES256 keypair for DPoP proofs.
  const { publicKey, privateKey } = await generateKeyPair("ES256", {
    extractable: true,
  });
  const publicJwk: JWK = await exportJWK(publicKey as KeyLike);

  const makeProof = async (htu: string, htm: string, token?: string) => {
    const claims: Record<string, unknown> = { htu, htm };
    if (token) claims.ath = await ath(token);
    return await new SignJWT(claims)
      .setProtectedHeader({ typ: "dpop+jwt", alg: "ES256", jwk: publicJwk })
      .setIssuedAt()
      .setJti(crypto.randomUUID())
      .sign(privateKey as KeyLike);
  };

  // 5. Token endpoint (client_credentials + DPoP).
  const meta = await (await fetch(`${issuer}/.well-known/openid-configuration`))
    .json();
  const tokenEndpoint: string = meta.token_endpoint;

  const tokenRes = await fetch(tokenEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${
        btoa(`${encodeURIComponent(id)}:${encodeURIComponent(secret)}`)
      }`,
      DPoP: await makeProof(tokenEndpoint, "POST"),
    },
    body: "grant_type=client_credentials&scope=webid",
  });
  if (!tokenRes.ok) {
    throw new Error(`token request failed: ${tokenRes.status} ${await tokenRes.text()}`);
  }
  const { access_token } = await tokenRes.json() as { access_token: string };

  // 6. DPoP-authenticated fetch. htu excludes query/fragment per RFC 9449.
  const authFetch = async (
    input: string | URL,
    init: RequestInit = {},
  ): Promise<Response> => {
    const url = (typeof input === "string" ? input : input.toString());
    const htu = url.split("#")[0].split("?")[0];
    const htm = (init.method ?? "GET").toUpperCase();
    const headers = new Headers(init.headers);
    headers.set("Authorization", `DPoP ${access_token}`);
    headers.set("DPoP", await makeProof(htu, htm, access_token));
    return await fetch(url, { ...init, headers });
  };

  const dispose = async () => {
    if (resource) {
      await fetch(resource, {
        method: "DELETE",
        headers: { Authorization: `CSS-Account-Token ${accountToken}` },
      }).catch(() => {});
    }
  };

  return { info: { webId, isLoggedIn: true }, fetch: authFetch, dispose };
}
