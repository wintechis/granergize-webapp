/**
 * A tiny framework-agnostic store of in-flight network requests so the whole app
 * can show ONE consistent loading indicator instead of each feature rolling its
 * own. Non-React code feeds it directly — the `session.fetch` wrapper
 * ({@link instrumentSessionFetch}), Leaflet tile events, and bare fetches via
 * {@link trackedFetch} — and React reads it with `useNetworkActivity`
 * (useSyncExternalStore).
 */
export interface ActiveRequest {
  id: number;
  label: string;
  startedAt: number;
  /** Raw request URL, when known — lets the UI show a pod-relative path. Absent
   * for label-only activities (map tiles, weather, geocoding). */
  url?: string;
}

let nextId = 1;
const active = new Map<number, ActiveRequest>();
const listeners = new Set<() => void>();
let snapshot: ActiveRequest[] = [];

function emit(): void {
  snapshot = [...active.values()];
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

/** Mark a request finished (idempotent — unknown/old tokens are ignored). */
export function endActivity(id: number): void {
  if (active.delete(id)) emit();
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
  } catch { /* not an absolute URL — keep raw */ }
  return `${method} ${where}`;
}

/** Run a bare (non-Pod) fetch — e.g. geocoding — while tracking its activity. */
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
  try {
    return await fetch(input, init);
  } finally {
    endActivity(id);
  }
}

const INSTRUMENTED = Symbol.for("granergize.networkActivity.instrumented");

/**
 * Wrap a Solid session's `fetch` in place (once) so every authenticated Pod
 * request flows through the activity store. Idempotent — safe to call on each
 * login / mount. Because callers across the app hold the same session object and
 * call `session.fetch(...)`, this captures them all without touching call sites.
 */
export function instrumentSessionFetch(session: { fetch: typeof fetch }): void {
  const original = session.fetch?.bind(session);
  const current = session.fetch as (typeof fetch & { [k: symbol]: unknown }) | undefined;
  if (!original || current?.[INSTRUMENTED]) return;
  const wrapped = (async (input: string | URL | Request, init?: RequestInit) => {
    const id = beginActivity(describeRequest(input, init), inputUrl(input));
    try {
      return await original(input, init);
    } finally {
      endActivity(id);
    }
  }) as typeof fetch & { [k: symbol]: unknown };
  wrapped[INSTRUMENTED] = true;
  session.fetch = wrapped;
}
