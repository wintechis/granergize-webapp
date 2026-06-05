import { type Browser, type Page } from "@playwright/test";
import { login, type SolidAccount } from "./login.ts";
import { watchAppErrors } from "./errorGuard.ts";

/** A fresh isolated browser context logged into one account. */
export interface PodSession {
  ctx: Awaited<ReturnType<Browser["newContext"]>>;
  page: Page;
  guard: ReturnType<typeof watchAppErrors>;
}

/** Create a fresh context + page (no login yet) with the error guard attached. */
async function newSession(browser: Browser): Promise<PodSession> {
  const ctx = await browser.newContext({
    viewport: { width: 1200, height: 900 },
  });
  const page = await ctx.newPage();
  const guard = watchAppErrors(page); // attach before login to catch login errors
  return { ctx, page, guard };
}

/** A fresh isolated context logged into one account. */
export async function freshPage(
  browser: Browser,
  acc: SolidAccount,
): Promise<PodSession> {
  const session = await newSession(browser);
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
  const sessions = await Promise.all(accounts.map(() => newSession(browser)));
  await Promise.all(sessions.map((s, i) => login(s.page, accounts[i])));
  return sessions;
}
