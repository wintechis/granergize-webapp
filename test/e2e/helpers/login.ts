import { expect, type Page, test } from "@playwright/test";
import { account as resolveAccount, type TestAccount } from "../../config/accounts.ts";
import { localProvider } from "../../config/providers.ts";
import { LOCAL_CSS_CONTROL_PORT } from "../../config/localSeed.ts";
import { watchCloudflareRateLimit } from "./cloudflareGuard.ts";
import { T } from "./timeouts.ts";

const ENV = (globalThis as { process?: { env: Record<string, string | undefined> } })
  .process?.env;
const E2E_LOCAL = !!ENV?.E2E_LOCAL;
// The benchmark seeds its own data per size via the control server's /seed, so it
// has no use for a pristine reset — and a reset RESTARTS CSS, then logs in against
// a cold OIDC (the JWKS boot race), which is the single most flaky moment. Skip it
// for the bench: log into the CSS the webServer already booted + warmed.
const E2E_BENCH = !!ENV?.E2E_BENCH;

// Optional login pacing for Cloudflare-fronted hosts (e.g. solidcommunity): a wait
// (ms) before each login on a `throttled` provider, to stay under the edge rate
// limit that otherwise returns Error 1015. 0 (off) unless E2E_THROTTLE_MS is set;
// only ever applied to throttled providers, so local/non-CF runs are unaffected.
const E2E_THROTTLE_MS = Number(ENV?.E2E_THROTTLE_MS) || 0;

// Tier 3 (local CSS) isolation: restart CSS ONCE per spec file so each spec starts
// with pristine, freshly-seeded pods (no shared mutable state across the 8 solo
// specs on one pod). Keyed by spec file; the shared promise dedupes the concurrent
// A/B logins a sharing spec fires. No-op outside the local tier (or for the bench).
let resetForFile: string | undefined;
let resetInFlight: Promise<unknown> | undefined;
async function resetLocalPodsOnce(): Promise<void> {
  if (!E2E_LOCAL || E2E_BENCH) return;
  const file = test.info().file;
  if (file !== resetForFile) {
    resetForFile = file;
    resetInFlight = fetch(`http://localhost:${LOCAL_CSS_CONTROL_PORT}/reset`, {
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
 * Log the page into the app via the given Solid account: pick/enter the issuer,
 * fill the identity-provider form, click through consent, dismiss the
 * remember-provider prompt, and wait until the app tabs are present.
 *
 * Identity-provider login + consent pages are provider-specific and change over
 * time; selectors are best-effort for solidcommunity.net. Run headed to debug.
 */
export async function login(page: Page, acc: SolidAccount): Promise<void> {
  // Bail the whole run fast if the Pod host trips Cloudflare's Error 1015 (rate
  // limited) — attach before any navigation so login traffic is watched too.
  watchCloudflareRateLimit(page);
  // Tier 3: give this spec a pristine CSS (restarts once per spec file).
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
    await page.goto("/");
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
