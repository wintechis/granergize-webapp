import { useSyncExternalStore } from "react";
import { getDevMode, subscribeDevMode } from "../lib/devMode.ts";

export { getDevMode, setDevMode, subscribeDevMode } from "../lib/devMode.ts";

/** Subscribe to the developer-mode flag (re-renders on toggle). */
export function useDevMode(): boolean {
  return useSyncExternalStore(subscribeDevMode, getDevMode, getDevMode);
}
