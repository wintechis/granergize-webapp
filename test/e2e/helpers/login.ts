import { expect, type Page, test } from "@playwright/test";
import { account as resolveAccount, type TestAccount } from "../../config/accounts.ts";
import { localProvider } from "../../config/providers.ts";
import { LOCAL_CSS_CONTROL_PORT } from "../../config/localSeed.ts";
import { watchCloudflareRateLimit } from "./cloudflareGuard.ts";

const E2E_LOCAL = !!(globalThis as { process?: { env: Record<string, string | undefined> } })
  .process?.env?.E2E_LOCAL;

// Tier 3 (local CSS) isolation: restart CSS ONCE per spec file so each spec starts
// with pristine, freshly-seeded pods (no shared mutable state across the 8 solo
// specs on one pod). Keyed by spec file; the shared promise dedupes the concurrent
// A/B logins a sharing spec fires. No-op outside the local tier.
let resetForFile: string | undefined;
let resetInFlight: Promise<unknown> | undefined;
async function resetLocalPodsOnce(): Promise<void> {
  if (!E2E_LOCAL) return;
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
    await expect(user).toBeVisible({ timeout: 15_000 });
  }).toPass({ timeout: 150_000, intervals: [5_000, 15_000, 30_000, 30_000] });

  await user.fill(acc.email);
  await page.locator('input[type="password"], input[name="password"]').first()
    .fill(acc.password);
  await page.getByRole("button", { name: /log ?in|sign ?in|anmelden/i }).first()
    .click();

  // CSS ("Pivot") consent page — Authorize button; a few redirects to appear.
  const authorize = page.getByRole("button", {
    name: /authorize|consent|allow|continue|zustimmen|erlauben/i,
  });
  await authorize.first().click({ timeout: 45_000 }).catch(() => {});

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
  }).toPass({ timeout: 120_000 });
}

/** The app's login-screen heading (the `name` passed to <Login>). */
export const LOGIN_HEADING = "Granergize App";

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
  }).toPass({ timeout: 30_000 });
  await menu.click();
  await expect(
    page.getByRole("heading", { name: LOGIN_HEADING }),
  ).toBeVisible({ timeout: 30_000 });

  // App logout does NOT end the identity-provider session — its cookie persists,
  // so a different account would silently reuse the first one (the IdP skips the
  // login form and goes straight to consent). Clear all cookies so the next
  // login starts from a clean slate.
  await page.context().clearCookies();
}
