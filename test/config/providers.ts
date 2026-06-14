/**
 * Pod-provider registry. Providers differ by AUTH (client-credentials vs browser
 * OIDC) and THROTTLING (Cloudflare-fronted hosts). Tests describe what they need
 * (see resolve.ts); the registry says what each provider can do.
 *
 * WebIDs are deliberately NOT modeled here. Per the WebID / Solid-OIDC specs a WebID
 * is an opaque URI you obtain from the session's `webid` claim after login — browser
 * specs read it via `webIdOf`, the headless JSS backend gets it from `POST /.pods`,
 * and the headless CSS backend binds it from its own seed — never one you construct
 * from a username + a server's path convention. Irregular remote accounts supply
 * theirs out-of-band via `E2E_WEBID_*`.
 *
 * - Tier 2 (headless) ALWAYS uses the `local` provider, constructed at boot.
 * - Tier 4 (browser, remote) selects real providers below.
 */
export type ProviderKind = "local" | "css-v6" | "css-v5" | "nss";
export type LoginStyle = "client-credentials" | "browser-oidc";

export interface PodProvider {
  id: string;
  /** OIDC issuer base (no trailing slash). */
  issuer: string;
  kind: ProviderKind;
  /** Can drive the Tier-2 headless (client-credentials + DPoP) flow. */
  supportsClientCredentials: boolean;
  /** Cloudflare-fronted → serialize requests per host (concurrency policy). */
  throttled: boolean;
  loginStyle: LoginStyle;
}

/** The real remote providers (Tier 4). Keyed by `id`. */
export const PROVIDERS: Record<string, PodProvider> = {
  solidcommunity: {
    id: "solidcommunity",
    issuer: "https://solidcommunity.net",
    kind: "css-v6",
    supportsClientCredentials: true,
    throttled: true,
    loginStyle: "client-credentials",
  },
  redpencil: {
    id: "redpencil",
    issuer: "https://solid.redpencil.io",
    kind: "css-v5",
    supportsClientCredentials: false,
    throttled: false,
    loginStyle: "browser-oidc",
  },
  solidweb: {
    id: "solidweb",
    issuer: "https://solidweb.org",
    kind: "nss",
    supportsClientCredentials: false,
    throttled: false,
    loginStyle: "browser-oidc",
  },
  // A second non-Cloudflare host, used as role B for the A+B sharing pair
  // (`test/.env.meisdata.local`). The by-role sharing path discovers B's WebID via
  // room membership; the By-WebID path reads it from B's own session (`webIdOf`) or
  // `E2E_WEBID_B`. Pair A(solidweb)+B(solidwebme) is heterogeneous → `E2E_INTEROP_OK=1`.
  solidwebme: {
    id: "solidwebme",
    issuer: "https://solidweb.me",
    kind: "css-v6",
    supportsClientCredentials: false,
    throttled: false,
    loginStyle: "browser-oidc",
  },
};

/**
 * Build the `local` provider for a running local Pod server (port-dependent). The
 * headless tier treats it as a client-credential provider; the browser "local" tier
 * passes `loginStyle: "browser-oidc"` to drive the login UI instead.
 */
export function localProvider(
  baseUrl: string,
  loginStyle: LoginStyle = "client-credentials",
): PodProvider {
  return {
    id: "local",
    issuer: baseUrl.replace(/\/$/, ""),
    kind: "local",
    supportsClientCredentials: true,
    throttled: false,
    loginStyle,
  };
}

/** Map a configured issuer URL back to a provider id (back-compat with E2E_ISSUER_*). */
export function providerIdForIssuer(issuer: string | undefined): string | undefined {
  if (!issuer) return undefined;
  const norm = issuer.replace(/\/$/, "");
  return Object.values(PROVIDERS).find((p) => p.issuer.replace(/\/$/, "") === norm)?.id;
}
