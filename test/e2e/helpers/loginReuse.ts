import type { Browser, BrowserContextOptions } from "@playwright/test";
import type { SolidAccount } from "./login.ts";

/**
 * Login REUSE (opt-in, local tier): instead of driving the ~40–50 s OIDC UI flow
 * once per spec FILE, a `setup` project logs A/B/C in ONCE and saves each one's
 * Playwright `storageState`; every spec then opens a context seeded with that state
 * and the app silently restores the session (`restorePreviousSession`) — no IdP
 * redirect, no form, no consent. The login is the suite's dominant per-spec cost, so
 * this is a real win (measured ~21% off the local CSS suite; far larger on Tier-4,
 * where login is 3-4× more expensive and throttled). inrupt restores from
 * cookies+localStorage alone, so no IndexedDB capture is needed.
 *
 * REQUIRES `/wipe` resets, not `/restart`: the saved IdP session cookie is only valid
 * while the SAME pod server keeps running, so a per-spec server restart would
 * invalidate it. (`/wipe` leaves the server up and only clears pod data — auth
 * survives.) Gated to the local tier and off by default; set `E2E_LOGIN_REUSE=1`
 * (the `e2e:local:reuse` task does, alongside `E2E_RESET=wipe`).
 */
const ENV = (globalThis as { process?: { env: Record<string, string | undefined> } })
  .process?.env;

export function loginReuseEnabled(): boolean {
  return !!ENV?.E2E_LOCAL && !!ENV?.E2E_LOGIN_REUSE;
}

/** Where the setup project writes / specs read each account's saved auth state. A
 *  fixed (not per-run) path so the setup→spec dependency hands it over within a run. */
export function authStatePath(slot: string): string {
  return `test-results/.auth/${slot.toLowerCase()}.json`;
}

/**
 * Context options seeding the account's saved session, when reuse is on AND `acc` is
 * a configured account. Otherwise `{}` — a clean context that still logs in via the
 * UI (the fallback path, and how the setup itself + the login/logout UI specs run).
 */
export function reuseContextOptions(acc?: SolidAccount): BrowserContextOptions {
  if (!loginReuseEnabled() || !acc?.slot) return {};
  return { storageState: authStatePath(acc.slot) };
}

/** True once a context is pre-authed (so `login()` can skip the UI and just restore). */
export function isReuseContext(acc?: SolidAccount): boolean {
  return loginReuseEnabled() && !!acc?.slot;
}

export type { Browser };
