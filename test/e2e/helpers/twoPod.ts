import { type Browser, type Page } from "@playwright/test";
import { login, type SolidAccount } from "./login.ts";
import { watchAppErrors } from "./errorGuard.ts";
import { captureConsole } from "./consoleLog.ts";
import { reuseContextOptions } from "./loginReuse.ts";

/** A fresh isolated browser context logged into one account. */
export interface PodSession {
  ctx: Awaited<ReturnType<Browser["newContext"]>>;
  page: Page;
  guard: ReturnType<typeof watchAppErrors>;
}

/** Create a fresh context + page (no login yet) with the error guard attached. In
 *  login-REUSE mode the context is seeded with `acc`'s saved session so the
 *  following `login()` silently restores instead of driving the OIDC UI. */
async function newSession(
  browser: Browser,
  acc?: SolidAccount,
): Promise<PodSession> {
  const ctx = await browser.newContext({
    viewport: { width: 1200, height: 900 },
    ...reuseContextOptions(acc),
  });
  const page = await ctx.newPage();
  const guard = watchAppErrors(page); // attach before login to catch login errors
  captureConsole(page, acc?.slot ?? ""); // mirror the console stream to the per-run log file
  return { ctx, page, guard };
}

/** A fresh isolated context logged into one account. */
export async function freshPage(
  browser: Browser,
  acc: SolidAccount,
): Promise<PodSession> {
  const session = await newSession(browser, acc);
  await login(session.page, acc);
  return session;
}

/**
 * Open several accounts at once: every context is created first, then ALL log in
 * CONCURRENTLY. The OIDC login (~50 s each) is almost all network waiting against
 * independent Pods, so overlapping the awaits collapses N logins into ~one
 * login's wall-clock. Returns the sessions in the same order as `accounts`.
 *
 * Use this only for the INITIAL logins that don't depend on each other (e.g. A and
 * B both need to be logged in before the handshake starts). Steps with a cross-Pod
 * data dependency (A shares → B reads) must stay sequential.
 */
export async function freshPagesParallel(
  browser: Browser,
  accounts: SolidAccount[],
): Promise<PodSession[]> {
  const sessions = await Promise.all(
    accounts.map((a) => newSession(browser, a)),
  );
  // On a Cloudflare-fronted (throttled) provider, log in SEQUENTIALLY: concurrent
  // A+B logins double the instantaneous request rate to the same host and trip the
  // 1015 edge limit (login() also paces each one when E2E_THROTTLE_MS is set).
  // Non-throttled providers (local CSS, redpencil, solidweb) keep the fast
  // concurrent path (≈one login's wall-clock).
  if (accounts.some((a) => a.provider.throttled)) {
    for (let i = 0; i < sessions.length; i++) {
      await login(sessions[i].page, accounts[i]);
    }
  } else {
    await Promise.all(sessions.map((s, i) => login(s.page, accounts[i])));
  }
  return sessions;
}
