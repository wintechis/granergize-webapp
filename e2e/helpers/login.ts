import { expect, type Page } from "@playwright/test";

/**
 * Credentials for one throwaway Solid Pod, read from the environment. Never a
 * real account; nothing is committed. Two accounts (A and B) are read with the
 * `_A` / `_B` suffix so the sharing test can drive both sides:
 *
 *   E2E_USERNAME_A / E2E_PASSWORD_A / [E2E_ISSUER_A]
 *   E2E_USERNAME_B / E2E_PASSWORD_B / [E2E_ISSUER_B]
 *
 * No WebID needs configuring: the sharing test discovers WebIDs via the data
 * room (B joins A's room, A shares "by role"). The single-account screenshot run
 * keeps using the unsuffixed E2E_USERNAME / E2E_PASSWORD / E2E_ISSUER (mapped to
 * account "A").
 */
export interface SolidAccount {
  issuer: string;
  username: string;
  password: string;
}

const DEFAULT_ISSUER = "https://solidcommunity.net";

/** Read account A/B (or the legacy unsuffixed vars) from the environment. */
export function account(which: "A" | "B"): SolidAccount {
  const env = process.env;
  const issuer = env[`E2E_ISSUER_${which}`] ??
    (which === "A" ? env.E2E_ISSUER : undefined) ?? DEFAULT_ISSUER;
  const username = env[`E2E_USERNAME_${which}`] ??
    (which === "A" ? env.E2E_USERNAME : undefined) ?? "";
  const password = env[`E2E_PASSWORD_${which}`] ??
    (which === "A" ? env.E2E_PASSWORD : undefined) ?? "";
  return { issuer, username, password };
}

export function hasAccount(a: SolidAccount): boolean {
  return Boolean(a.username && a.password);
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
  await page.goto("/");

  // Pick the matching recommended provider, or type a custom issuer.
  const host = new URL(acc.issuer).host;
  const recommended = page.getByRole("button", {
    name: new RegExp(host.replace(/\./g, "\\."), "i"),
  });
  if (await recommended.count()) {
    await recommended.first().click();
  } else {
    await page.getByLabel(/Identity Provider/i).fill(acc.issuer);
    await page.getByRole("button", { name: "+" }).click();
  }

  // Identity-provider login form (best-effort selectors).
  await page.waitForLoadState("domcontentloaded");
  const user = page.locator(
    'input[name="username"], input[name="email"], input[type="email"], input#username, input#email',
  ).first();
  await user.waitFor({ timeout: 30_000 });
  await user.fill(acc.username);
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
    await expect(page.getByRole("tab", { name: "Meet" })).toBeVisible({
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
