/**
 * Account registry — maps a SLOT (A / B / C / pool index) to credentials + a
 * provider, read from the environment runtime-agnostically (env.ts). One source
 * of truth for both the headless scripts and the Playwright specs, replacing the
 * scattered `E2E_*` reads in `login.ts` and the hardcoded issuers/WebIDs in the
 * old scripts.
 *
 * Env per slot X: `E2E_USERNAME_X`, `E2E_PASSWORD_X`, and EITHER `E2E_PROVIDER_X`
 * (a providers.ts id) OR `E2E_ISSUER_X` (back-compat, mapped via the registry).
 * `E2E_WEBID_X` overrides the derived WebID for irregular accounts.
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
  webId: string;
}

/** Resolve the provider for a slot: explicit id, else issuer map, else default. */
function providerFor(slot: string): PodProvider | null {
  const id = getEnv(`E2E_PROVIDER_${slot}`) ??
    providerIdForIssuer(getEnv(`E2E_ISSUER_${slot}`));
  if (!id) return null;
  return PROVIDERS[id] ?? null;
}

/**
 * In the browser "local" tier (E2E_LOCAL=1) accounts come from the seeded local CSS,
 * NOT the env: slot B → the `bob` pod, anything else (A, the solo slot C/D, …) → the
 * `alice` pod. So the unchanged specs (`account("A")`/`account("B")`, `soloAccount()`,
 * the A+B interoperating pair) resolve to the two local pods with no creds to set.
 */
function localAccount(slot: string): TestAccount | null {
  // Pool slots (P0, P1, …) must still resolve to null so `poolAccounts()`'s
  // scan-until-gap terminates — otherwise local mode loops forever (heap OOM).
  if (/^P\d+$/.test(slot)) return null;
  const seed = slot === "B" ? LOCAL_SEED.B : LOCAL_SEED.A;
  const provider = localBrowserProvider();
  return {
    slot,
    provider,
    email: seed.email,
    password: seed.password,
    webId: provider.webIdFor(seed.pod),
  };
}

/** Read account `slot` from the env, or null if unconfigured/unknown provider. */
export function account(slot: string): TestAccount | null {
  if (getEnv("E2E_LOCAL")) return localAccount(slot);
  const email = getEnv(`E2E_USERNAME_${slot}`);
  const password = getEnv(`E2E_PASSWORD_${slot}`);
  if (!email || !password) return null;
  const provider = providerFor(slot);
  if (!provider) return null;
  const webId = getEnv(`E2E_WEBID_${slot}`) ?? provider.webIdFor(email);
  return { slot, provider, email, password, webId };
}

export function hasAccount(slot: string): boolean {
  return account(slot) !== null;
}

/**
 * Pool accounts `P0..Pn` for worker-indexed browser parallelism (§4): scan
 * upward until the first gap. Empty when no pool is configured.
 */
export function poolAccounts(): TestAccount[] {
  const pool: TestAccount[] = [];
  for (let i = 0; ; i++) {
    const a = account(`P${i}`);
    if (!a) break;
    pool.push(a);
  }
  return pool;
}
