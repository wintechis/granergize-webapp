/**
 * Account registry — maps a SLOT (A / B / C / pool index) to credentials + a
 * provider, read from the environment runtime-agnostically (env.ts). One source
 * of truth for both the headless scripts and the Playwright specs, replacing the
 * scattered `E2E_*` reads in `login.ts` and the hardcoded issuers/WebIDs in the
 * old scripts.
 *
 * Env per slot X (the WebID is the account's identity, so its creds hang off it):
 * `WEBID_X_USERNAME`, `WEBID_X_PASSWORD`, and EITHER `WEBID_X_PROVIDER` (a
 * providers.ts id) OR `WEBID_X_ISSUER` (mapped via the registry). The bare `WEBID_X`
 * supplies the WebID for irregular accounts; otherwise none is set — the
 * authoritative WebID is discovered from the session after login (`webIdOf`), never
 * constructed from a username. One neutral scheme for e2e, bench AND headless:remote.
 */
import { getEnv } from "./env.ts";
import {
  type PodProvider,
  PROVIDERS,
  providerIdForIssuer,
} from "./providers.ts";
import { LOCAL_SEED, localBrowserProvider } from "./localSeed.ts";

export interface TestAccount {
  slot: string;
  provider: PodProvider;
  email: string;
  password: string;
  /** The WebID if known out-of-band (the bare `WEBID_*`); otherwise undefined. WebIDs are
   * opaque (WebID/Solid-OIDC), so the real value is discovered from the session after
   * login (`webIdOf`), never built from a username. */
  webId?: string;
}

/** Resolve the provider for a slot: explicit id, else issuer map, else default. */
function providerFor(slot: string): PodProvider | null {
  const id = getEnv(`WEBID_${slot}_PROVIDER`) ??
    providerIdForIssuer(getEnv(`WEBID_${slot}_ISSUER`));
  if (!id) return null;
  return PROVIDERS[id] ?? null;
}

/**
 * In the browser "local" tier (E2E_LOCAL=1) accounts come from the seeded local CSS,
 * NOT the env: slot B → the `bob` pod, slot C → the `charlie` pod (the BSP), anything
 * else (A, …) → the `alice` pod. So the specs (`account("A")` for solo, the A+B pair
 * for sharing, A+B+C for the benchmark) resolve to the seeded local pods with no creds
 * to set — the same role model the remote tier uses.
 */
function localAccount(slot: string): TestAccount | null {
  const seed = slot === "C"
    ? LOCAL_SEED.C
    : slot === "B"
    ? LOCAL_SEED.B
    : LOCAL_SEED.A;
  const provider = localBrowserProvider();
  return { slot, provider, email: seed.email, password: seed.password };
}

/** Read account `slot` from the env, or null if unconfigured/unknown provider. */
export function account(slot: string): TestAccount | null {
  if (getEnv("E2E_LOCAL")) return localAccount(slot);
  const email = getEnv(`WEBID_${slot}_USERNAME`);
  const password = getEnv(`WEBID_${slot}_PASSWORD`);
  if (!email || !password) return null;
  const provider = providerFor(slot);
  if (!provider) return null;
  const webId = getEnv(`WEBID_${slot}`);
  return { slot, provider, email, password, webId };
}

export function hasAccount(slot: string): boolean {
  return account(slot) !== null;
}
