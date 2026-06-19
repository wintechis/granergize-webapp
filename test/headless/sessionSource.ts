/// <reference lib="deno.ns" />
/**
 * Where the headless runner's authenticated sessions come from — the seam between
 * `headless:local` and `headless:remote`.
 *
 * - **local** (default, `deno task it`): boot a throwaway local Pod (CSS/JSS) and
 *   take its seeded A/B/C sessions. Hermetic; teardown stops the server.
 * - **remote** (`IT_REMOTE=1`, `deno task it:remote`): connect to a REAL Solid server
 *   using the SAME account creds the browser/e2e + bench lanes read — `account(slot)`
 *   from `test/config/accounts.ts` (`WEBID_<slot>_USERNAME`/`_PASSWORD`/`_PROVIDER`,
 *   sourced from a creds file; throwaway accounts only — the tasks self-clean but do
 *   write). No separate creds prefix for headless.
 *
 * The headless flow is account-API client-credentials + DPoP, which only some
 * providers support — CSS is one (solidcommunity, fraunhofer, …). A provider that is
 * browser-OIDC only (`supportsClientCredentials: false`) can't drive it, so it throws
 * a clear error rather than failing obscurely deep in the token exchange.
 */
import type { LiveSessionLike, Slot } from "./localPod.ts";
import { startLocalPod } from "./localPod.ts";
import { discoverWebId, getLiveSession } from "./liveSession.ts";
import { account } from "../config/accounts.ts";

export interface SessionSource {
  /** Human label for the boot log. */
  readonly label: string;
  /** An authenticated headless session for a seeded/configured account. */
  liveSession(slot: Slot): Promise<LiveSessionLike>;
  /** Stop a local server, or no-op for remote (sessions dispose individually). */
  teardown(): Promise<void>;
}

/** Hermetic source: a throwaway local CSS/JSS (the default `deno task it`). */
export async function localSessionSource(): Promise<SessionSource> {
  const pod = await startLocalPod();
  return {
    label: `local Pod ${pod.baseUrl}`,
    liveSession: (slot) => pod.liveSession(slot),
    teardown: () => pod.stop(),
  };
}

/**
 * Real-Solid-server source for `headless:remote`. Reuses the shared account registry
 * (`account(slot)`), so creds come from the same `WEBID_<slot>_*` env the e2e/bench
 * lanes use — `source` a creds file first (throwaway accounts only).
 */
export async function remoteSessionSource(): Promise<SessionSource> {
  const slots: Slot[] = ["A", "B", "C"];
  const resolved = {} as Record<Slot, {
    issuer: string;
    email: string;
    password: string;
    webId: string;
  }>;
  for (const slot of slots) {
    const acc = account(slot);
    if (!acc) {
      throw new Error(
        `headless:remote needs account ${slot} — set WEBID_${slot}_USERNAME / ` +
          `WEBID_${slot}_PASSWORD / WEBID_${slot}_PROVIDER (source your creds file, ` +
          `e.g. test/.env.trio.local).`,
      );
    }
    if (!acc.provider.supportsClientCredentials) {
      throw new Error(
        `headless:remote account ${slot} uses provider "${acc.provider.id}", which is ` +
          `browser-OIDC only — the headless client-credentials flow needs a server with ` +
          `the CSS account API (e.g. solidcommunity, fraunhofer). CSS is only one such type.`,
      );
    }
    const issuer = acc.provider.issuer.replace(/\/$/, "");
    const webId = acc.webId ?? await discoverWebId(issuer, acc.email, acc.password);
    resolved[slot] = { issuer, email: acc.email, password: acc.password, webId };
  }
  return {
    label: `remote ${resolved.A.issuer}`,
    liveSession: (slot) => {
      const r = resolved[slot];
      return getLiveSession(r.issuer, r.email, r.password, r.webId);
    },
    teardown: () => Promise.resolve(),
  };
}

/** Pick the source: `IT_REMOTE` set → real server, else the hermetic local Pod. */
export function sessionSource(): Promise<SessionSource> {
  return Deno.env.get("IT_REMOTE") ? remoteSessionSource() : localSessionSource();
}
