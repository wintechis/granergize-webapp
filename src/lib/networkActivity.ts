/**
 * A tiny framework-agnostic store of in-flight network requests so the whole app
 * can show ONE consistent loading indicator instead of each feature rolling its
 * own. Non-React code feeds it directly — the `session.fetch` wrapper
 * ({@link instrumentSessionFetch}), Leaflet tile events, and bare fetches via
 * {@link trackedFetch} — and React reads it with `useNetworkActivity`
 * (useSyncExternalStore).
 */
import { withRetry } from "../services/pod/retryFetch.ts";
import {
  isSessionExpired,
  markSessionExpired,
} from "../services/pod/sessionGate.ts";
import { getStorageRoot } from "../services/pod/solidUtils.ts";
import { logError } from "./logError.ts";

export interface ActiveRequest {
  id: number;
  label: string;
  startedAt: number;
  /** Raw request URL, when known — lets the UI show a pod-relative path. Absent
   * for label-only activities (map tiles, weather, geocoding). */
  url?: string;
}

/** How a finished request turned out — populated when {@link endActivity} runs. */
export interface RequestOutcome {
  /** HTTP status, when a Response came back. Absent for thrown/CORS-blocked
   * failures or label-only activities (map tiles) that expose no status. */
  status?: number;
  /** True if the fetch threw (network / CORS-blocked, e.g. a masked 429). */
  error?: boolean;
}

/** One finished request, kept in a bounded rolling history for the debug log. */
export interface RequestLogEntry extends ActiveRequest {
  endedAt: number;
  durationMs: number;
  status?: number;
  error: boolean;
  /** Not an error, and (no status | status < 400). */
  ok: boolean;
}

/** How many finished requests to keep for the click-to-open debug log. */
const LOG_MAX = 200;

let nextId = 1;
const active = new Map<number, ActiveRequest>();
const log: RequestLogEntry[] = []; // newest first
const listeners = new Set<() => void>();
let snapshot: ActiveRequest[] = [];
let logSnapshot: RequestLogEntry[] = [];

function emit(): void {
  snapshot = [...active.values()];
  logSnapshot = [...log];
  for (const l of listeners) l();
}

/** Mark a request started; returns a token to hand back to {@link endActivity}. */
export function beginActivity(label: string, url?: string): number {
  const id = nextId++;
  active.set(id, { id, label, startedAt: Date.now(), url });
  emit();
  return id;
}

/** Best-effort raw URL string from a fetch input. */
function inputUrl(input: string | URL | Request): string {
  return typeof input === "string"
    ? input
    : input instanceof URL
    ? input.toString()
    : (input as Request).url ?? String(input);
}

/**
 * Mark a request finished (idempotent — unknown/old tokens are ignored). The
 * optional outcome (HTTP status, or that it threw) is recorded in the rolling
 * debug log so the header indicator can show what happened, not just that
 * something happened.
 */
export function endActivity(id: number, outcome?: RequestOutcome): void {
  const a = active.get(id);
  if (!a) return;
  active.delete(id);

  const endedAt = Date.now();
  const error = outcome?.error ?? false;
  const status = outcome?.status;
  log.unshift({
    ...a,
    endedAt,
    durationMs: endedAt - a.startedAt,
    status,
    error,
    ok: !error && (status === undefined || status < 400),
  });
  if (log.length > LOG_MAX) log.length = LOG_MAX;
  emit();
}

export function subscribeActivity(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getActivitySnapshot(): ActiveRequest[] {
  return snapshot;
}

/** The rolling history of finished requests (newest first) for the debug log. */
export function getRequestLog(): RequestLogEntry[] {
  return logSnapshot;
}

/** Clear the debug log (the indicator's "Clear" button). */
export function clearRequestLog(): void {
  log.length = 0;
  emit();
}

/** Human-readable label for a fetch call: METHOD + host/path (query stripped). */
export function describeRequest(
  input: string | URL | Request,
  init?: { method?: string },
): string {
  const raw = typeof input === "string"
    ? input
    : input instanceof URL
    ? input.toString()
    : (input as Request).url ?? String(input);
  const method = (init?.method ?? (input as Request)?.method ?? "GET")
    .toUpperCase();
  const noQuery = raw.split("#")[0].split("?")[0];
  let where = noQuery;
  try {
    const u = new URL(noQuery);
    where = u.pathname && u.pathname !== "/" ? `${u.host}${u.pathname}` : u.host;
  } catch (err) {
    logError("parse request URL for activity log", err);
    /* not an absolute URL — keep raw */
  }
  return `${method} ${where}`;
}

// Bare (non-Pod) fetches back off on transient throttling too (e.g. Nominatim
// rate-limits geocoding). Pod requests retry inside instrumentSessionFetch
// instead — above @inrupt's fetch, so each retry gets a fresh DPoP proof.
const retryingFetch = withRetry((input, init) => fetch(input, init));

/** Run a bare (non-Pod) fetch — e.g. geocoding — with retry + activity tracking. */
export async function trackedFetch(
  input: string | URL | Request,
  init?: RequestInit,
  label?: string,
): Promise<Response> {
  // A custom label (e.g. "geocode address") shows as-is; otherwise describe the
  // URL and keep it so the UI can relativize it.
  const id = label
    ? beginActivity(label)
    : beginActivity(describeRequest(input, init), inputUrl(input));
  let outcome: RequestOutcome | undefined;
  try {
    const res = await retryingFetch(input, init);
    outcome = { status: res.status };
    return res;
  } catch (e) {
    outcome = { error: true };
    throw e;
  } finally {
    endActivity(id, outcome);
  }
}

const INSTRUMENTED = Symbol.for("granergize.networkActivity.instrumented");

/** How long to let an in-flight token refresh settle before the confirm retry. */
const EXPIRY_CONFIRM_DELAY_MS = 1000;

/**
 * Whether `url` lives on the logged-in user's OWN Pod. A 401 there means the
 * auth token is dead (an authenticated-but-forbidden request would 403); a 401
 * from someone ELSE's Pod is an ordinary outcome (e.g. a share was revoked) and
 * must not count as session expiry. `false` until the storage root resolves.
 */
function isOwnPodUrl(url: string | undefined, webId: string | undefined): boolean {
  if (!url || !webId) return false;
  try {
    return url.startsWith(getStorageRoot(webId));
  } catch {
    return false; // storage root not resolved yet — can't attribute the 401
  }
}

/**
 * Wrap a Solid session's `fetch` in place (once) so every authenticated Pod
 * request flows through the activity store AND retries transient rate-limiting
 * (Cloudflare 429/503; see retryFetch.ts). Idempotent — safe to call on each
 * login / mount. Because callers across the app hold the same session object and
 * call `session.fetch(...)`, this captures them all without touching call sites.
 *
 * The wrapper is also where session expiry is DETECTED: a 401 from the user's
 * own Pod is retried once after a pause (a lone 401 can be a race with the
 * library's background token refresh); if it repeats, the session gate trips
 * (`markSessionExpired`) and the app cleanly logs out (see main.tsx). The
 * library's `sessionExpired` event also trips the gate, but providers whose
 * refresh dies silently never emit it — the transport is the reliable signal.
 */
export function instrumentSessionFetch(
  session: { fetch: typeof fetch; info?: { webId?: string } },
): void {
  const original = session.fetch?.bind(session);
  const current = session.fetch as (typeof fetch & { [k: symbol]: unknown }) | undefined;
  if (!original || current?.[INSTRUMENTED]) return;
  const retrying = withRetry(original);
  const wrapped = (async (input: string | URL | Request, init?: RequestInit) => {
    // Session-expiry gate: once tripped, short-circuit further requests with a
    // synthetic 401 rather than hammering a dead token during logout. Not
    // tracked as activity — local.
    if (isSessionExpired()) {
      return new Response(null, { status: 401, statusText: "Session expired" });
    }
    // One activity entry brackets the whole request, retries included.
    const id = beginActivity(describeRequest(input, init), inputUrl(input));
    let outcome: RequestOutcome | undefined;
    try {
      let res = await retrying(input, init);
      if (res.status === 401 && isOwnPodUrl(inputUrl(input), session.info?.webId)) {
        // Confirm before declaring the session dead: wait out a possible
        // in-flight token refresh, then retry once (session.fetch signs with
        // the CURRENT token). A transient race recovers invisibly here.
        await new Promise((r) => setTimeout(r, EXPIRY_CONFIRM_DELAY_MS));
        res = await retrying(input, init);
        if (res.status === 401) markSessionExpired();
      }
      outcome = { status: res.status };
      return res;
    } catch (e) {
      outcome = { error: true };
      throw e;
    } finally {
      endActivity(id, outcome);
    }
  }) as typeof fetch & { [k: symbol]: unknown };
  wrapped[INSTRUMENTED] = true;
  session.fetch = wrapped;
}
