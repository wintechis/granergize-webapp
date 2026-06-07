/// <reference lib="deno.ns" />
/**
 * Throwaway local Pod server for the test tiers, abstracted over its backend:
 * Community Solid Server (`css`, default) or JavaScript Solid Server (`jss`),
 * selected by `LOCAL_POD_SERVER` (see test/config/podServer.ts). Tier-2 headless,
 * Tier-3 browser, and the benchmark all boot through `startLocalPod`, so a single
 * env var switches the substrate for every local tier.
 *
 * The two servers boot, seed, and authenticate completely differently (CSS:
 * `--seedConfig` + account-API client-credentials + DPoP; JSS: `POST /.pods`
 * returning a bearer token), so the headless session is folded INTO the backend as
 * `liveSession(slot)` instead of a standalone `getLiveSession`.
 */
import { podServerKind } from "../config/podServer.ts";
import { LOCAL_CSS_PORT } from "../config/localSeed.ts";
import type { LiveSessionLike } from "./liveSession.ts";
import { startCss } from "./localCss.ts";
import { startJss } from "./localJss.ts";

export type { LiveSessionLike };

/** The port the local Pod server binds (shared by CSS and JSS). */
export const LOCAL_POD_PORT = LOCAL_CSS_PORT;

/** A seeded account on the local Pod server. */
export interface LocalAccount {
  email: string;
  password: string;
  pod: string;
  webId: string;
}

/** A booted local Pod server (CSS or JSS) with two seeded accounts A and B. */
export interface LocalPod {
  baseUrl: string;
  A: LocalAccount;
  B: LocalAccount;
  stop: () => Promise<void>;
  /** Resolves when the server process exits — watch it to fail-fast if it dies. */
  status: Promise<Deno.CommandStatus>;
  /** An authenticated headless session for a seeded account (backend-specific). */
  liveSession: (slot: "A" | "B") => Promise<LiveSessionLike>;
}

/** Start the configured local Pod server, seeded with accounts A and B. */
export function startLocalPod(port = LOCAL_POD_PORT): Promise<LocalPod> {
  return podServerKind() === "jss" ? startJss(port) : startCss(port);
}
