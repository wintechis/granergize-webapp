import { useSyncExternalStore } from "react";
import { getLanguage, subscribeLanguage } from "../lib/language.ts";

export {
  DEFAULT_LANG,
  getLanguage,
  type Lang,
  setLanguage,
  SUPPORTED,
  subscribeLanguage,
} from "../lib/language.ts";

/** Subscribe to the active UI language (re-renders on switch). Mirrors useDevMode. */
export function useLanguage(): import("../lib/language.ts").Lang {
  return useSyncExternalStore(subscribeLanguage, getLanguage, getLanguage);
}
