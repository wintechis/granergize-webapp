/**
 * Developer mode — a client-only UI preference (per-device, not per-Pod) that
 * reveals power-user / debugging affordances: the raw-RDF source links on each
 * tab, the "Add demo buildings" and "Remove all app data…" account actions, and
 * the full network request log (request URIs + clickable history) instead of a
 * plain spinner.
 *
 * A tiny external store backed by `localStorage`, in the same shape as
 * `networkActivity.ts`: pure (no React) so it stays hermetically testable; the
 * `useDevMode()` hook lives in `components/devMode.ts`.
 */

import { logError } from "./logError.ts";

const STORAGE_KEY = "granergize.devMode";

let devMode = readInitial();
const listeners = new Set<() => void>();

/** Read the persisted flag once at module load; tolerate storage being absent. */
function readInitial(): boolean {
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEY) === "1";
  } catch (err) {
    logError("read dev-mode flag from storage", err);
    return false;
  }
}

/** Current dev-mode flag (sync accessor for the `useSyncExternalStore` hook). */
export function getDevMode(): boolean {
  return devMode;
}

/** Toggle dev mode, persist it, and notify subscribers. No-op if unchanged. */
export function setDevMode(value: boolean): void {
  if (value === devMode) return;
  devMode = value;
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, value ? "1" : "0");
  } catch (err) {
    logError("persist dev-mode flag to storage", err);
    // private mode / storage disabled — keep the in-memory value, skip persist
  }
  for (const listener of listeners) listener();
}

/** Subscribe to dev-mode changes; returns an unsubscribe fn. */
export function subscribeDevMode(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
