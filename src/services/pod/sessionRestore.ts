/**
 * Pure decision for the Login screen's silent session-restore.
 *
 * On mount the app may quietly restore the previous Solid session from
 * localStorage (the inrupt library's `restorePreviousSession`) so a reload
 * doesn't bounce the user to the login form. That is desirable normally, but
 * MUST be skipped when:
 *  - auto-restore is disabled (`auto` is false), or
 *  - a destructive/explicit logout asked us not to (`suppressRestore`, the
 *    `noRestore` one-shot flag), or
 *  - the session is already known expired (restoring a dead token just fails), or
 *  - a login/restore/logout event has already responded for this mount
 *    (`sessionResponded`) — restoring on top would be redundant.
 *
 * Kept pure (no React, no inrupt) so the guard is unit-testable; the component
 * reads the live `sessionExpired`/`sessionResponded` values via refs to avoid a
 * stale closure inside the deferred restore timer.
 */
export function shouldRestoreSession(opts: {
  auto: boolean;
  suppressRestore: boolean;
  sessionExpired: boolean;
  sessionResponded: boolean;
}): boolean {
  return (
    opts.auto &&
    !opts.suppressRestore &&
    !opts.sessionExpired &&
    !opts.sessionResponded
  );
}
