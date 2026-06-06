/**
 * Pod-provider registry. Providers differ by AUTH (client-credentials vs browser
 * OIDC), THROTTLING (Cloudflare-fronted hosts), and WebID LAYOUT (subdomain vs
 * path). Tests describe what they need (see resolve.ts); the registry says what
 * each provider can do.
 *
 * - Tier 2 (headless) ALWAYS uses the `local` provider, constructed at boot by
 *   `startLocalCss` (issuer/webIdFor are port-dependent) — see `localProvider`.
 * - Tier 4 (browser, remote) selects real providers below.
 */
export type ProviderKind = "local" | "css-v6" | "css-v5" | "nss";
export type LoginStyle = "client-credentials" | "browser-oidc";
/** How a WebID is laid out for a username on this provider. */
export type WebIdLayout = "subdomain" | "path";

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
  webIdLayout: WebIdLayout;
  /** Derive a WebID from a username, accounting for layout. */
  webIdFor(username: string): string;
}

function subdomainWebId(host: string): (u: string) => string {
  return (u) => `https://${u}.${host}/profile/card#me`;
}
function pathWebId(base: string): (u: string) => string {
  return (u) => `${base}/${u}/profile/card#me`;
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
    webIdLayout: "subdomain",
    webIdFor: subdomainWebId("solidcommunity.net"),
  },
  redpencil: {
    id: "redpencil",
    issuer: "https://solid.redpencil.io",
    kind: "css-v5",
    supportsClientCredentials: false,
    throttled: false,
    loginStyle: "browser-oidc",
    webIdLayout: "path",
    webIdFor: pathWebId("https://solid.redpencil.io"),
  },
  solidweb: {
    id: "solidweb",
    issuer: "https://solidweb.org",
    kind: "nss",
    supportsClientCredentials: false,
    throttled: false,
    loginStyle: "browser-oidc",
    webIdLayout: "subdomain",
    webIdFor: subdomainWebId("solidweb.org"),
  },
};

/**
 * Build the `local` provider for a running local CSS (port-dependent). The headless
 * tier treats it as a client-credential provider; the browser "local" tier passes
 * `loginStyle: "browser-oidc"` to drive the CSS login UI instead.
 */
export function localProvider(
  baseUrl: string,
  loginStyle: LoginStyle = "client-credentials",
): PodProvider {
  const root = baseUrl.replace(/\/$/, "");
  return {
    id: "local",
    issuer: root,
    kind: "local",
    supportsClientCredentials: true,
    throttled: false,
    loginStyle,
    webIdLayout: "path",
    webIdFor: pathWebId(root),
  };
}

/** Map a configured issuer URL back to a provider id (back-compat with E2E_ISSUER_*). */
export function providerIdForIssuer(issuer: string | undefined): string | undefined {
  if (!issuer) return undefined;
  const norm = issuer.replace(/\/$/, "");
  return Object.values(PROVIDERS).find((p) => p.issuer.replace(/\/$/, "") === norm)?.id;
}
