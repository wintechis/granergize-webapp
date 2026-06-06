/**
 * The ACTOR is the concurrency primitive shared by Tier 2 (headless) AND Tiers 3–4
 * (browser) — designed once, reused, so we never invent "A and B" twice. An actor
 * is a slot bound to an account, plus a tier-specific HANDLE produced by a DRIVER:
 *   - headless driver → a client-credential `Session` (test/headless)
 *   - browser driver  → a logged-in `Page`        (test/e2e)
 *
 * `setupActors` resolves nothing itself — callers pass the accounts (from
 * resolve.ts) and a driver; it just sets the handles up CONCURRENTLY (the logins
 * are independent I/O against different hosts) and pairs them back to slots. The
 * cross-Pod handshake then reads identically against `actorA.handle` /
 * `actorB.handle` in either tier.
 */
import { type TestAccount } from "./accounts.ts";

export interface Actor<H> {
  slot: string;
  account: TestAccount;
  handle: H;
}

/** Set up one handle per account, concurrently, preserving order. */
export async function setupActors<H>(
  accounts: TestAccount[],
  driver: (account: TestAccount) => Promise<H>,
): Promise<Actor<H>[]> {
  const handles = await Promise.all(accounts.map((a) => driver(a)));
  return accounts.map((account, i) => ({
    slot: account.slot,
    account,
    handle: handles[i],
  }));
}
