/**
 * The app's deploy-root path — the `window.__APP_BASE__` set by the inline script
 * in `index.html` (always ends in "/"; see `App.tsx`'s `appBasename`). Falls back
 * to "/" when that script didn't run (a non-browser test render).
 */
export function appRootUrl(base?: string): string {
  // Cast rather than rely on the ambient `__APP_BASE__` global so deno's
  // type-checker (which doesn't load vite-env.d.ts) accepts the read — same
  // pattern as the `import.meta.env` casts in solidUtils/regionalCube.
  const fromScript =
    (globalThis as { __APP_BASE__?: string }).__APP_BASE__;
  return base ?? fromScript ?? "/";
}

/** The subset of `History` this module needs (so tests can pass a fake). */
type HistoryLike = Pick<History, "replaceState">;

/**
 * Reset the address bar to the app root, dropping the current route's path +
 * query, WITHOUT a reload. Called on an *explicit* logout so the login screen
 * doesn't keep showing the last protected page's URI (the route is otherwise
 * retained on purpose for reload + silent-restore deep-linking — see `Login.tsx`).
 */
export function resetUrlToAppRoot(
  history: HistoryLike = globalThis.history,
  base?: string,
): void {
  history.replaceState({}, "", appRootUrl(base));
}
