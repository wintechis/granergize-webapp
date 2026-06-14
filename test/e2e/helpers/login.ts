import { expect, type Page, test } from "@playwright/test";
import { account as resolveAccount, type TestAccount } from "../../config/accounts.ts";
import { localProvider } from "../../config/providers.ts";
import { LOCAL_CSS_CONTROL_PORT } from "../../config/localSeed.ts";
import { watchCloudflareRateLimit } from "./cloudflareGuard.ts";
import { isReuseContext } from "./loginReuse.ts";
import { T } from "./timeouts.ts";

const ENV = (globalThis as { process?: { env: Record<string, string | undefined> } })
  .process?.env;
const E2E_LOCAL = !!ENV?.E2E_LOCAL;

// Optional login pacing for Cloudflare-fronted hosts (e.g. solidcommunity): a wait
// (ms) before each login on a `throttled` provider, to stay under the edge rate
// limit that otherwise returns Error 1015. 0 (off) unless E2E_THROTTLE_MS is set;
// only ever applied to throttled providers, so local/non-CF runs are unaffected.
const E2E_THROTTLE_MS = Number(ENV?.E2E_THROTTLE_MS) || 0;

// Tier 3 (local pod server) isolation: reset state ONCE per spec file so each spec
// starts with pristine, freshly-seeded pods (no shared mutable state across the
// specs on one pod). The control server (test/e2e-local/css.ts) offers two ops and
// the caller picks: `/restart` boots a fresh server (safe, slow — the DEFAULT, and
// the only reliable reset on JSS, whose stale post-write container listings defeat
// an in-place delete: see ../../javascript-solid-server/issues/stale-container-
// listing-after-writes-defeats-recursive-delete-tier3.md); `/wipe` deletes the app
// collection in place (fast, CSS only). Opt into the fast path with E2E_RESET=wipe.
// Keyed by spec file; the shared promise dedupes the concurrent A/B logins a sharing
// spec fires. No-op outside the local tier. The BENCH specs get this too: their
// per-size resets rely on this isolation to keep the bench substrates trustworthy.
const RESET_PATH = ENV?.E2E_RESET === "wipe" ? "/wipe" : "/restart";
let resetForFile: string | undefined;
let resetInFlight: Promise<unknown> | undefined;
/**
 * Exported for specs that SEED before their first login (login-settle): the
 * lazy first-login reset would wipe that seed, so they fire the reset
 * explicitly in beforeAll — later login() calls then dedupe on the file key.
 */
export async function resetLocalPodsOnce(): Promise<void> {
  if (!E2E_LOCAL) return;
  const file = test.info().file;
  if (file !== resetForFile) {
    resetForFile = file;
    resetInFlight = fetch(`http://localhost:${LOCAL_CSS_CONTROL_PORT}${RESET_PATH}`, {
      method: "POST",
    }).catch(() => {});
  }
  await resetInFlight;
}

/**
 * The browser tier's view of a test account — now just the shared `TestAccount`
 * from `test/config/accounts.ts` (provider + credentials + webId). Kept as the
 * `SolidAccount` alias so existing specs/helpers don't churn. Credentials come
 * from `test/.env.e2e.local`; nothing committed. No WebID needs configuring — the
 * sharing specs discover WebIDs via the data room.
 */
export type SolidAccount = TestAccount;

/** A non-null placeholder for an unconfigured slot, so `account()` keeps its
 * non-null contract and specs gate on `hasAccount()` / `test.skip`. */
function unconfigured(slot: string): TestAccount {
  return {
    slot,
    provider: localProvider("http://unconfigured.invalid"),
    email: "",
    password: "",
    webId: "",
  };
}

/** Resolve account `slot` from the shared registry (non-null; empty if unset). */
export function account(slot: string): SolidAccount {
  return resolveAccount(slot) ?? unconfigured(slot);
}

export function hasAccount(a: SolidAccount): boolean {
  return Boolean(a.email && a.password);
}

/**
 * Get the page to a logged-in app shell for `acc`, then reset the pod to pristine.
 * Dispatches by mode: with login REUSE on (the context was seeded with saved
 * `storageState`, see loginReuse.ts) the app silently restores the session — no UI;
 * otherwise the full interactive OIDC flow ({@link loginInteractive}). The per-spec
 * `/wipe` reset runs in both paths.
 */
export async function login(page: Page, acc: SolidAccount): Promise<void> {
  if (isReuseContext(acc)) {
    watchCloudflareRateLimit(page);
    await resetLocalPodsOnce();
    await restoreSession(page);
    return;
  }
  await loginInteractive(page, acc);
}

/**
 * REUSE path: the context already carries a saved session (cookies + localStorage),
 * so loading the app triggers inrupt's `restorePreviousSession` — no IdP redirect,
 * form or consent. Just land on the shell; retry once or twice in case the silent
 * token-refresh redirect is mid-flight on first paint.
 */
async function restoreSession(page: Page): Promise<void> {
  await expect(async () => {
    await page.goto("./");
    await expect(page.getByRole("tab", { name: "Connect" }))
      .toBeVisible({ timeout: T.action });
  }).toPass({ timeout: T.login });
}

/**
 * Interactive OIDC login — the fallback path, and what the `setup` project uses to
 * MINT the saved sessions: pick/enter the issuer, fill the identity-provider form,
 * click through consent, dismiss the remember-provider prompt, and wait until the
 * app tabs are present.
 *
 * Identity-provider login + consent pages are provider-specific and change over
 * time; selectors are best-effort for solidcommunity.net. Run headed to debug.
 */
export async function loginInteractive(page: Page, acc: SolidAccount): Promise<void> {
  // Bail the whole run fast if the Pod host trips Cloudflare's Error 1015 (rate
  // limited) — attach before any navigation so login traffic is watched too.
  watchCloudflareRateLimit(page);
  // Tier 3: give this spec a pristine pod (resets once per spec file).
  await resetLocalPodsOnce();
  // Pace logins on Cloudflare-fronted (throttled) providers so consecutive OIDC
  // flows don't burst past the edge rate limit (Error 1015). No-op otherwise.
  if (E2E_THROTTLE_MS && acc.provider.throttled) {
    await new Promise((r) => setTimeout(r, E2E_THROTTLE_MS));
  }
  const host = new URL(acc.provider.issuer).host;
  const user = page.locator(
    'input[name="username"], input[name="email"], input[type="email"], input#username, input#email',
  ).first();

  // Reaching the IdP login form can transiently fail under rate limiting: the
  // provider serves a 429/error page with no form, so the username field never
  // appears. Retry the whole app→provider→IdP navigation a few times with
  // backoff (the `intervals` wait grows between attempts) before giving up. This
  // only cushions *transient* throttling — a saturated limit will still exhaust
  // the retries.
  await expect(async () => {
    // "./" (not "/"): resolved against the full baseURL. The deployed tier's
    // baseURL carries a subpath (…/testing/granergize/), which an absolute "/"
    // would drop — landing on the host's homepage instead of the app.
    await page.goto("./");
    // Pick the matching preset Identity Provider, or type a custom issuer.
    const recommended = page.getByRole("button", {
      name: new RegExp(host.replace(/\./g, "\\."), "i"),
    });
    if (await recommended.count()) {
      await recommended.first().click();
    } else {
      await page.getByLabel(/Identity Provider/i).fill(acc.provider.issuer);
      await page.getByRole("button", { name: "+" }).click();
    }
    await page.waitForLoadState("domcontentloaded");
    await expect(user).toBeVisible({ timeout: T.visible });
  }).toPass({ timeout: T.login, intervals: [5_000, 15_000, 30_000, 30_000] });

  await user.fill(acc.email);
  await page.locator('input[type="password"], input[name="password"]').first()
    .fill(acc.password);
  // Anchor the submit-button name: JSS's IdP renders "Sign in with Passkey" /
  // "Sign in with Schnorr" SSO buttons *before* the credential form, and an
  // unanchored /sign ?in/ would match those first and trigger a WebAuthn dance
  // that never completes. Anchoring to the exact verb still matches CSS/NSS
  // ("Log in" / "Sign In").
  await page.getByRole("button", { name: /^(log ?in|sign ?in|anmelden)$/i })
    .first().click();

  // JSS interstitial: after credentials, a seeded account (no passkeys, prompt
  // not dismissed) sees a "register a passkey?" page *before* consent. Skip it.
  // No-op on CSS/NSS (button absent).
  await page.getByRole("button", { name: /skip for now/i }).first()
    .click({ timeout: T.quick }).catch(() => {});

  // CSS ("Pivot") consent page — Authorize button; JSS — "Allow Access"; a few
  // redirects to appear.
  const authorize = page.getByRole("button", {
    name: /authorize|consent|allow|continue|zustimmen|erlauben/i,
  });
  await authorize.first().click({ timeout: T.action }).catch(() => {});

  // Back in the app: dismiss the first-login "remember provider?" prompt and
  // only finish once it's gone AND the tabs are present.
  const remember = page.getByRole("button", {
    name: /save login info|no,? thanks/i,
  });
  await expect(async () => {
    if (await remember.count()) await remember.first().click().catch(() => {});
    await expect(remember).toHaveCount(0, { timeout: 1000 });
    await expect(page.getByRole("tab", { name: "Connect" })).toBeVisible({
      timeout: 1000,
    });
  }).toPass({ timeout: T.login });
}


/** The app's login-screen heading (the `name` passed to <Login>). */
export const LOGIN_HEADING = "Granergize App";

/**
 * The logged-in user's real WebID, read from the account-menu button's
 * `aria-label` ("Account menu — <webid>"). Lets a spec discover a role's actual
 * WebID at runtime instead of deriving it from the username — handy when the
 * username is an email or the provider's WebID layout isn't known.
 */
export async function webIdOf(page: Page): Promise<string> {
  const label = await page
    .getByRole("button", { name: /^Account menu/ })
    .getAttribute("aria-label");
  const m = label?.match(/Account menu — (.+)$/);
  if (!m) {
    throw new Error(`could not read WebID from account menu (aria-label: ${label})`);
  }
  return m[1].trim();
}

/** Log the app out so a different account can log in on the same page. */
export async function logout(page: Page): Promise<void> {
  // Open the top-right account menu, then Logout. Retry the open in case a click
  // lands while the menu is mid-transition.
  const menu = page.getByRole("menuitem", { name: /logout/i });
  await expect(async () => {
    if (!(await menu.isVisible().catch(() => false))) {
      await page.getByRole("button", { name: "Account menu" }).click({
        timeout: 2000,
      });
    }
    await expect(menu).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: T.poll });
  await menu.click();
  await expect(
    page.getByRole("heading", { name: LOGIN_HEADING }),
  ).toBeVisible({ timeout: T.action });

  // App logout does NOT end the identity-provider session — its cookie persists,
  // so a different account would silently reuse the first one (the IdP skips the
  // login form and goes straight to consent). Clear all cookies so the next
  // login starts from a clean slate.
  await page.context().clearCookies();
}
