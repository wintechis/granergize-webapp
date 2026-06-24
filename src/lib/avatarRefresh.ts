/**
 * A module-level cache-buster version for the header's avatar + organisation logo. It is
 * bumped when the user saves their organisation (logo/name) so the header re-fetches the
 * new image — and it lives in a module singleton (mirroring `networkActivity`/`devMode`/
 * `mapViewport`) rather than shell state because the Organisation page is a SHELL-LESS
 * route: it unmounts the `AppShell`, so it can't bump a piece of shell state directly.
 * The shell subscribes via {@link useAvatarRefresh}; the page calls {@link bumpAvatar} on
 * save.
 */
import { useSyncExternalStore } from "react";

let version = 0;
const listeners = new Set<() => void>();

/** Invalidate the cached header avatar + org logo (call after saving the organisation). */
export function bumpAvatar(): void {
  version++;
  for (const l of listeners) l();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** The current cache-buster version — feed it to `useProfileImageUrl` so the header
 *  re-fetches when {@link bumpAvatar} fires. */
export function useAvatarRefresh(): number {
  return useSyncExternalStore(subscribe, () => version, () => version);
}
