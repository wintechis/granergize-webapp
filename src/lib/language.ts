/**
 * Active UI language — a client-only preference (per-device, not per-Pod), in the
 * same external-store shape as `devMode.ts`/`networkActivity.ts`: pure (no React)
 * so it stays hermetically testable.
 *
 * The vocab carries its labels/comments in de/en/fr (see the vocab-driven-labels
 * plan); this module resolves which one to render. The active locale is seeded
 * from the browser's `Accept-Language` (`navigator.languages`, region-stripped)
 * on first run, persisted thereafter, and shared with the (later) app-chrome i18n
 * catalog — one active locale drives both.
 */

import { logError } from "./logError.ts";

export type Lang = "de" | "en" | "fr";

/** The languages the vocab + UI support, in no particular preference order. */
export const SUPPORTED = ["de", "en", "fr"] as const;

/** Default when no preference matches a supported language. */
export const DEFAULT_LANG: Lang = "en";

const STORAGE_KEY = "granergize.language";

/** Region-strip a BCP-47 tag: `"de-DE"` → `"de"`, `"DE"` → `"de"`. */
function primaryTag(tag: string): string {
  return tag.split("-")[0]!.toLowerCase();
}

/**
 * First supported language matching the ordered preference list (region-stripped),
 * else {@link DEFAULT_LANG}. Pure — the active-locale store passes `navigator.languages`.
 */
export function resolveLanguage(
  supported: readonly Lang[],
  prefs: readonly string[],
): Lang {
  for (const pref of prefs) {
    const primary = primaryTag(pref);
    const match = supported.find((s) => s === primary);
    if (match) return match;
  }
  return DEFAULT_LANG;
}

const isLang = (s: string | null): s is Lang =>
  s === "de" || s === "en" || s === "fr";

/** Read the persisted override, else seed from the browser's preference order. */
function readInitial(): Lang {
  try {
    const stored = globalThis.localStorage?.getItem(STORAGE_KEY) ?? null;
    if (isLang(stored)) return stored;
  } catch (err) {
    logError("read language from storage", err);
  }
  const prefs = globalThis.navigator?.languages ?? [];
  return resolveLanguage(SUPPORTED, prefs);
}

let language = readInitial();
const listeners = new Set<() => void>();

/** Current active language (sync accessor for the `useSyncExternalStore` hook). */
export function getLanguage(): Lang {
  return language;
}

/** Set the active language, persist it as an explicit override, notify subscribers. */
export function setLanguage(value: Lang): void {
  if (value === language) return;
  language = value;
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, value);
  } catch (err) {
    logError("persist language to storage", err);
    // private mode / storage disabled — keep the in-memory value, skip persist
  }
  for (const listener of listeners) listener();
}

/** Subscribe to language changes; returns an unsubscribe fn. */
export function subscribeLanguage(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
