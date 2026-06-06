/**
 * Requirement resolver — a scenario/spec declares what accounts it NEEDS, and the
 * resolver either supplies them or returns a precise skip reason (good enough to
 * print in a `test.skip(reason)` or a Deno script's "SKIP — …" line). No spec
 * hardcodes a provider.
 *
 * Tier 2 needs nothing (local CSS, built at boot). Tier 4 cross-pod specs need an
 * interoperating PAIR — and since NSS↔CSS-v5 is known NOT to interoperate, such a
 * spec SKIPs until a pair is configured, with the logic still guarded by Tier 2.
 */
import { account, type TestAccount } from "./accounts.ts";
import { getEnv } from "./env.ts";

export interface AccountRequirement {
  /** How many distinct accounts (default: the number of preferred slots). */
  count: number;
  /** Preferred slots in order (default A=Alice, B=Bob). */
  slots?: string[];
  /** Each account's provider must support client-credentials (Tier-2-style). */
  clientCredentials?: boolean;
  /** The accounts must sit on DISTINCT, interoperating providers (cross-pod). */
  interoperatingPair?: boolean;
}

export type Resolution =
  | { ok: true; accounts: TestAccount[] }
  | { ok: false; reason: string };

const DEFAULT_SLOTS = ["A", "B"]; // A = Alice, B = Bob

/**
 * Two accounts form an interoperating sharing pair if a guest authenticated at one
 * can read/append to a room hosted by the other. The requirement is two DISTINCT
 * Pods (distinct WebIDs) on servers that interoperate:
 *  - homogeneous (same `kind`) interoperates — including two accounts on the SAME
 *    provider/server (e.g. two solidcommunity.net Pods), the strongest case;
 *  - heterogeneous (different `kind`, e.g. NSS↔CSS-v5) is NOT assumed to work — it
 *    must be opted in via `E2E_INTEROP_OK=1` once a real pair is verified.
 */
function interoperates(a: TestAccount, b: TestAccount): boolean {
  if (a.webId === b.webId) return false; // same Pod → not a sharing pair
  if (a.provider.kind === b.provider.kind) return true; // homogeneous (incl. same server)
  return getEnv("E2E_INTEROP_OK") === "1"; // heterogeneous: opt-in once verified
}

export function resolveAccounts(req: AccountRequirement): Resolution {
  const slots = (req.slots ?? DEFAULT_SLOTS).slice(0, Math.max(req.count, req.slots?.length ?? 0));
  const accounts: TestAccount[] = [];
  for (const slot of slots) {
    const a = account(slot);
    if (a) accounts.push(a);
    if (accounts.length === req.count) break;
  }
  if (accounts.length < req.count) {
    return {
      ok: false,
      reason: `need ${req.count} account(s) (${slots.join("/")}); set ` +
        `E2E_USERNAME_/PASSWORD_/PROVIDER_ for them in test/.env.e2e.local`,
    };
  }

  if (req.clientCredentials) {
    const bad = accounts.find((a) => !a.provider.supportsClientCredentials);
    if (bad) {
      return {
        ok: false,
        reason: `account ${bad.slot} (${bad.provider.id}) has no client-credentials ` +
          `API; headless needs a CSS-v6/local provider`,
      };
    }
  }

  if (req.interoperatingPair) {
    const [a, b] = accounts;
    if (!interoperates(a, b)) {
      return {
        ok: false,
        reason: `accounts ${a.slot}(${a.provider.id}) + ${b.slot}(${b.provider.id}) ` +
          `are not a known interoperating pair (cross-pod sharing); configure an ` +
          `interoperating pair (logic is still covered headless in Tier 2)`,
      };
    }
  }

  return { ok: true, accounts };
}
