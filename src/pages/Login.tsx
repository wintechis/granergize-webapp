import React, { useEffect, useRef, useState } from "react";
import {
  getDefaultSession,
  ILoginInputOptions,
  ISessionInfo,
  Session,
} from "@inrupt/solid-client-authn-browser";

import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import Typography from "@mui/material/Typography";
import { styled } from "@mui/material/styles";
import Alert from "@mui/material/Alert";
import ActivityScreen from "../components/ActivityScreen.tsx";
import { shouldRestoreSession } from "../services/pod/sessionRestore.ts";
import { logError } from "../lib/logError.ts";
import { clearLocalData } from "../lib/clearLocalData.ts";
import { normalizeIssuer } from "../lib/normalizeIssuer.ts";
import { msg } from "../lib/messages.ts";

interface LoginProps {
  children: React.JSX.Element;
  auto?: boolean;
  /**
   * When true, do NOT silently restore a previous session on mount (the user must
   * log in explicitly). Set after a destructive logout so the app can't auto-login
   * and re-create just-deleted data. Manual login is unaffected.
   */
  suppressRestore?: boolean;
  name?: string;
  logo?: React.JSX.Element;
  lead?: React.JSX.Element;
  /** Rendered centered at the bottom of the login screen (e.g. project links). */
  footer?: React.JSX.Element;
  loadingIndicator?: React.JSX.Element;
  recommendedLogins?: string[];
  loginOptions?: Omit<ILoginInputOptions, "oidcIssuer">;
  onLogin?: (session: Session) => void;
}

/**
 * OIDC error codes a silent (`prompt=none`) restore returns when there is simply
 * no active IdP session — the ordinary logged-out case. These must stay silent
 * (fall through to the login form); any OTHER error (e.g. `invalid_client`, the
 * "Unknown client" stale-registration case) surfaces the clear-local-data remedy.
 */
const BENIGN_OIDC_ERRORS = new Set([
  "login_required",
  "interaction_required",
  "consent_required",
  "account_selection_required",
]);

// localStorage breadcrumb, set immediately before a silent restore navigates to
// the IdP and cleared on success (or when the user starts a fresh login). A
// stale OIDC client registration makes that restore land on a dead-end IdP error
// page ("Unknown client") from which the app never regains control; when the
// user navigates back, this flag is still set, so we DON'T auto-restore again
// (which would just bounce there) — we show the login chooser + its
// clear-local-data remedy instead. `clearLocalData` wipes it along with the rest.
const RESTORE_ATTEMPT_KEY = "granergize:restoreAttempted";
const markRestoreAttempted = () => {
  try {
    localStorage.setItem(RESTORE_ATTEMPT_KEY, "1");
  } catch {
    // private-mode / disabled storage — the loop guard simply won't engage.
  }
};
const restoreAlreadyAttempted = () => {
  try {
    return localStorage.getItem(RESTORE_ATTEMPT_KEY) === "1";
  } catch {
    return false;
  }
};
const clearRestoreAttempt = () => {
  try {
    localStorage.removeItem(RESTORE_ATTEMPT_KEY);
  } catch {
    // ignore — see markRestoreAttempted.
  }
};

const IdpInputWrapper = styled(Box)(({ theme }) => ({
  display: "flex",
  // Stretch so the submit button matches the text field's height without a
  // hardcoded px value.
  alignItems: "stretch",
  gap: theme.spacing(1),
  width: "100%",
}));

export const Login: React.FC<LoginProps> = ({
  children,
  loadingIndicator,
  auto = true,
  suppressRestore = false,
  name,
  lead,
  footer,
  loginOptions,
  logo = (
    <img
      src="https://solidproject.org/assets/img/solid-emblem.svg"
      alt={msg("loginLogoAlt")}
    />
  ),
  recommendedLogins = [
    "https://login.inrupt.com",
    "https://solidcommunity.net",
  ],
  onLogin,
}) => {
  const [prevIdps, setPrevIdps] = useState<string[]>(
    JSON.parse(localStorage.getItem("prevIdps") ?? "[]"),
  );

  const [activeWebId, setActiveWebId] = useState<string>();

  const [invalidIDP, setInvalidIDP] = useState(false);
  // The IdP the user tried + the underlying reason, so the error explains WHAT
  // failed and WHY instead of a bare "correct URI" (see submitCallback).
  const [attemptedIdp, setAttemptedIdp] = useState("");
  const [loginErrorDetail, setLoginErrorDetail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Holds the IdP's error message when a silent session restore fails
  // (typically a stale OIDC client registration → "Unknown client"). Surfaces
  // that literal message plus an inline "Clear local data & retry" remedy on
  // the login form.
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  // The provider the user just picked: `session.login` does OIDC discovery +
  // client registration (a couple of network round-trips) before it navigates
  // away, so without this the button would sit dead for a second or two. Set on
  // click to take over the screen with a "Redirecting…" message until the
  // browser leaves for the provider (cleared only if login fails to start).
  const [redirectingTo, setRedirectingTo] = useState<string | null>(null);

  // The silent-restore decision runs inside a deferred timer, so it must read
  // the LIVE expiry/responded flags, not the values captured when the effect
  // ran — otherwise we could restore a session that expired during the 2s delay.
  // These only gate that timer (never rendered), so refs suffice — no re-render.
  const sessionExpiredRef = useRef(false);
  const sessionRespondedRef = useRef(false);
  const markExpired = () => {
    sessionExpiredRef.current = true;
  };
  const markResponded = () => {
    sessionRespondedRef.current = true;
  };

  // State for new IDP input
  const [login, setLogin] = useState("");

  const session = getDefaultSession();

  // The inrupt library announces a successful auth through BOTH an event
  // (`login`/`sessionRestore`) AND the `handleIncomingRedirect` promise
  // resolution — so a single login would otherwise call `onLogin` twice
  // (double inbox/profile reads, racing registry writes). Funnel every
  // callsite through this one-shot guard so `onLogin` fires at most once per
  // session; reset it on logout/expiry so the next login fires again.
  const loginHandled = useRef(false);
  const fireLogin = () => {
    if (loginHandled.current) return;
    loginHandled.current = true;
    onLogin?.(session);
  };

  useEffect(() => {
    // Every deferred timer this effect schedules is tracked, so the cleanup can
    // cancel any still pending at unmount — the same discipline as the listener
    // removal below. `cancelled` additionally stops a timer scheduled *later*
    // from an async callback that resolves after the effect has been torn down.
    let cancelled = false;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const schedule = (fn: () => void, ms: number) => {
      if (cancelled) return;
      const id = setTimeout(() => {
        timers.delete(id);
        fn();
      }, ms);
      timers.add(id);
    };

    // A failed silent restore (stale OIDC client registration → "Unknown
    // client") comes back as a TOP-LEVEL redirect to `?error=…&error_description=…`
    // — a full page reload, so the deferred-restore `.catch` below never sees it.
    // Read the OIDC error straight from the URL here, before
    // `handleIncomingRedirect` strips it, and surface its literal message. Skip
    // the benign "no active session" codes (the normal logged-out reload).
    const oidcParams = new URLSearchParams(window.location.search);
    const oidcError = oidcParams.get("error");
    if (oidcError && !BENIGN_OIDC_ERRORS.has(oidcError)) {
      // Surfacing an external-system read (the redirect URL) — the sanctioned
      // set-state-in-effect case, like the prevIdps sync below.
      /* eslint-disable react-hooks/set-state-in-effect */
      setRestoreError(oidcParams.get("error_description") || oidcError);
      setLoading(false);
      /* eslint-enable react-hooks/set-state-in-effect */
    }

    // Watchdog: never trap the user on the "Loading…" screen if a redirect or
    // restore hangs (e.g. the IdP never resolves `handleIncomingRedirect`).
    // After this fires we fall through to the login form; a late restore that
    // still succeeds will set `activeWebId` and swap in the app.
    schedule(() => setLoading(false), 8000);

    // Restoring a session on refresh does a *silent redirect* through the Solid
    // identity provider, which returns to the registered redirect_uri (the app
    // root) — dropping the in-app route (now a real PATH under BrowserRouter,
    // `/building/<id>`). The `sessionRestore` event hands back the pre-redirect
    // URL (inrupt preserves it for exactly this). The event fires *while*
    // `handleIncomingRedirect` is still cleaning the URL, so applying it
    // synchronously gets clobbered by that cleanup — defer to a macrotask so it
    // runs after the cleanup (and after the app has mounted). We rewrite the
    // history entry to the pre-redirect path+query+hash and dispatch `popstate`,
    // which BrowserRouter listens to (the path-based analogue of the old
    // `hashchange`-on-`location.hash` trick) — no reload, so the restored session
    // survives.
    // NOTE: For a plain reload (F5) of a deep link, the browser already preserves
    // the full path, and `handleIncomingRedirect` (no redirect needed when a valid
    // token is cached) leaves it intact — this replay only matters when a silent
    // IdP round-trip actually occurs and bounces back to the root redirect_uri.
    // TODO(e2e): verify session-restore under BrowserRouter — confirm a deep-link
    // reload that triggers a silent IdP round-trip lands back on the original
    // route (session-restore.spec.ts + uri-state.spec.ts).
    const restoreRouteFrom = (url?: string) => {
      if (!url) return;
      schedule(() => {
        try {
          const target = new URL(url);
          const current = window.location;
          const targetRoute = target.pathname + target.search + target.hash;
          const currentRoute = current.pathname + current.search +
            current.hash;
          // Only replay if the redirect actually moved us off the saved route
          // (e.g. cleaned to the bare root). A path-only restore must not reload.
          if (targetRoute && targetRoute !== currentRoute) {
            window.history.replaceState(window.history.state, "", targetRoute);
            window.dispatchEvent(new PopStateEvent("popstate"));
          }
        } catch {
          // Ignore a malformed event URL — restoration is best-effort.
        }
      }, 0);
    };

    const handleLogoutEvent = () => {
      loginHandled.current = false;
      markResponded();
      setLoading(false);
      setActiveWebId(undefined);
    };
    const handleExpired = () => {
      loginHandled.current = false;
      markResponded();
      setLoading(false);
      markExpired();
      setActiveWebId(undefined);
    };
    const handleLoginEvent = () => {
      markResponded();
      clearRestoreAttempt();
      // Set the WebID together with clearing `loading` so the screen goes
      // straight from "Loading…" to the app. The library fires this `login`
      // event while `handleIncomingRedirect()` is still in flight (its promise
      // hasn't resolved yet), so clearing `loading` without also setting
      // `activeWebId` here would flash the login form for a frame right after
      // the browser returns from the identity provider.
      setActiveWebId(session.info.webId);
      setLoading(false);
      fireLogin();
    };
    const handleRestore = (currentUrl?: string) => {
      markResponded();
      clearRestoreAttempt();
      // The event carries the page URL the user was on before the silent restore
      // redirect — replay its in-app route (deferred past the library's cleanup).
      restoreRouteFrom(currentUrl);
      // Same as the login event: keep the loading screen up (no login-form
      // flash) by setting the WebID as we clear `loading`.
      setActiveWebId(session.info.webId);
      setLoading(false);
      fireLogin();
    };

    session.events.on("logout", handleLogoutEvent);
    session.events.on("sessionExpired", handleExpired);
    session.events.on("login", handleLoginEvent);
    session.events.on("sessionRestore", handleRestore);

    session.handleIncomingRedirect().then((sessionInfo?: ISessionInfo) => {
      if (sessionInfo?.isLoggedIn) {
        clearRestoreAttempt();
        setActiveWebId(sessionInfo.webId);
        fireLogin();
      } else {
        schedule(() => {
          // Decide against LIVE flags (via refs), not the values captured when
          // this effect ran — the session may have expired during the delay.
          // `restoreAlreadyAttempted` is the loop guard: a prior silent restore
          // that bounced to a dead-end "Unknown client" IdP page left this set,
          // so we fall through to the chooser instead of bouncing again.
          const mayRestore = shouldRestoreSession({
            auto,
            suppressRestore,
            sessionExpired: sessionExpiredRef.current,
            sessionResponded: sessionRespondedRef.current,
            restoreAttempted: restoreAlreadyAttempted(),
          });
          if (mayRestore) {
            // Breadcrumb the attempt BEFORE it can navigate away to the IdP, so a
            // failed silent restore can't trap the user in a reload→bounce loop.
            markRestoreAttempted();
            session
              .handleIncomingRedirect({ restorePreviousSession: true })
              .then((sessionInfo?: ISessionInfo) => {
                if (sessionInfo?.isLoggedIn) {
                  clearRestoreAttempt();
                  setActiveWebId(sessionInfo.webId);
                  fireLogin();
                } else {
                  // Restore resolved logged-out WITHOUT navigating away (nothing
                  // to restore) — clear the breadcrumb so it only ever persists
                  // across an actual IdP redirect (the loop case).
                  clearRestoreAttempt();
                  schedule(() => {
                    setLoading(false);
                  }, 1000);
                }
              })
              .catch((err) => {
                logError("restore the previous auth session", err);
                // A rejected restore is the "Unknown client" / stale-registration
                // case — show the IdP's literal message and offer the local-data
                // wipe instead of failing silently.
                setRestoreError(
                  err instanceof Error ? err.message : String(err),
                );
                setLoading(false);
              });
          } else {
            setLoading(false);
          }
        }, 2000);
      }
    })
      .catch((err) => logError("handle the incoming auth redirect", err));

    return () => {
      cancelled = true;
      for (const id of timers) clearTimeout(id);
      timers.clear();
      // Remove the listeners this effect registered, so a re-run (deps change)
      // doesn't stack duplicates that leak across the component's lifetime.
      session.events.off("logout", handleLogoutEvent);
      session.events.off("sessionExpired", handleExpired);
      session.events.off("login", handleLoginEvent);
      session.events.off("sessionRestore", handleRestore);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, suppressRestore, onLogin, session]);

  useEffect(() => {
    // If user had a previous session, check for that issuer
    const raw = localStorage.getItem(
      `solidClientAuthenticationUser:${session.info.sessionId}`,
    );
    let clientAuth: { issuer?: string } | null = null;
    try {
      if (raw) clientAuth = JSON.parse(raw);
    } catch (err) {
      logError("parse stored auth session", err);
      // stored value is corrupt — ignore
    }
    // Auto-remember any newly-used identity provider (the CLEAR button forgets
    // them) — no interstitial "save login info?" prompt.
    if (clientAuth?.issuer && !prevIdps.includes(clientAuth.issuer)) {
      const next = [...prevIdps, clientAuth.issuer];
      // Sync from + back to localStorage when a freshly-used IdP appears in the
      // stored auth session — a genuine external-store read/write effect.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPrevIdps(next);
      localStorage.setItem("prevIdps", JSON.stringify(next));
    }
  }, [prevIdps, session.info.sessionId]);

  function submitCallback(idp?: string) {
    const targetIdp = idp || login;
    setInvalidIDP(false);
    // A deliberate sign-in is a full (non-silent) login, not the auto-restore the
    // loop guard protects against — clear the breadcrumb so the guard never
    // blocks an explicit attempt.
    clearRestoreAttempt();
    // Immediate feedback while `session.login` discovers/registers before it
    // redirects the browser away (the page navigation ends this component).
    let host = targetIdp;
    try {
      host = new URL(targetIdp).host;
    } catch (err) {
      logError("parse identity-provider URI for redirect label", err);
      // not a full URL yet — show what we have
    }
    setRedirectingTo(host);
    session.login({ oidcIssuer: targetIdp, ...loginOptions }).catch((err) => {
      // Login never got to the redirect — e.g. the host is unreachable, isn't a
      // Solid identity provider, or refused OIDC discovery. Surface WHICH provider
      // failed and WHY (the error used to be discarded, leaving only "correct URI").
      logError("sign in to the identity provider", err);
      setRedirectingTo(null);
      setInvalidIDP(true);
      setAttemptedIdp(targetIdp);
      setLoginErrorDetail(err instanceof Error ? err.message : String(err));
    });
  }

  async function handleClearLocalData() {
    setClearing(true);
    await clearLocalData();
    // Reload to a clean URL: drop the `?error=…` OIDC query so the remedy
    // doesn't re-appear after the wipe (keep the in-app route, which now lives in
    // the path under BrowserRouter — preserved by pathname). This also restarts
    // the auth flow so the library re-registers the OIDC client. (clearLocalData
    // already dropped prevIdps.)
    window.location.replace(
      window.location.origin + window.location.pathname + window.location.hash,
    );
  }

  function handleNewIdpSubmit(e: React.FormEvent) {
    e.preventDefault();
    setInvalidIDP(false);
    setLoginErrorDetail(null);
    const enteredIdp = normalizeIssuer(login);
    // Reject a clearly-malformed address up front — a faster, clearer message
    // than waiting for OIDC discovery to fail on it.
    try {
      new URL(enteredIdp);
    } catch {
      setInvalidIDP(true);
      setAttemptedIdp(login || enteredIdp);
      setLoginErrorDetail("That doesn’t look like a web address.");
      return;
    }
    submitCallback(enteredIdp);
  }

  // Machine-loading states (cold start, post-redirect code exchange, session
  // restore) use the SAME plain activity screen as the app shell's storage-root
  // load, so the whole login→app transition reads as one continuous "Loading…"
  // instead of a chain of different-looking screens.
  if (loading) {
    return <ActivityScreen title={loadingIndicator ?? msg("loadingEllipsis")} />;
  }

  // A provider was just picked: take over the whole screen with the same
  // full-page activity screen (live OIDC discovery/registration requests) until
  // the browser navigates away — instead of flashing the login form again.
  // Cancel restores the chooser.
  if (redirectingTo) {
    return (
      <ActivityScreen
        title={`Redirecting to ${redirectingTo}…`}
        onCancel={() => setRedirectingTo(null)}
      />
    );
  }

  // Not logged in: show the login card. Its body swaps between the post-click
  // redirect (live requests + Cancel) and the provider chooser.
  if (!activeWebId) {
    return (
      <Box
        sx={{
          width: "100%",
          minHeight: "100vh",
          // #root is a fixed-height (100%) flex column; without this it would
          // shrink this box to the viewport and the centered content would
          // overflow upward, clipped and unreachable. Keeping full content
          // height lets tall content overflow downward so the normal browser
          // scrollbar appears — and short content still centers via the gap
          // between min-height and `justifyContent: center`.
          flexShrink: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          py: 4,
          px: 2,
        }}
      >
        <Card
          variant="outlined"
          sx={{
            width: "100%",
            // Wider than a typical narrow login card so the content (and the
            // full-width provider buttons) has room to breathe. Tune this single
            // value if you want it wider/narrower.
            maxWidth: 720,
            p: { xs: 3, sm: 4 },
          }}
        >
          <Box
            sx={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 3,
            }}
          >
            {logo && (
              <Box
                sx={{
                  width: 80,
                  height: "auto",
                  display: "flex",
                  justifyContent: "center",
                  "& img": { width: "100%", height: "auto", display: "block" },
                }}
              >
                {logo}
              </Box>
            )}

            <Typography variant="h5">
              {name ?? msg("loginTitleFallback")}
            </Typography>

            <Box
              sx={{
                display: "flex",
                flexDirection: "column",
                // Two-tier rhythm: `gap: 3` between sections here, `gap: 2`
                // within each section box below. No per-child `mt` (it would
                // compound with the gap into an uneven rhythm).
                gap: 3,
                width: "100%",
              }}
            >
              {/* lead text or default */}
              {lead || (
                <Typography variant="body1">
                  {msg("loginChooseIdpPrefix")}
                  <a href="https://solidproject.org/">{msg("loginSolidApp")}</a>
                </Typography>
              )}

              {/* Stale-registration remedy: shown only after a silent restore
                  failed (the IdP's "Unknown client" error). Echoes the IdP's
                  literal message so the cause is visible. */}
              {restoreError && (
                <Alert
                  severity="warning"
                  action={
                    <Button
                      color="inherit"
                      size="small"
                      disabled={clearing}
                      onClick={handleClearLocalData}
                    >
                      {clearing ? msg("loginClearing") : msg("loginClearRetry")}
                    </Button>
                  }
                >
                  {msg("loginRestoreFailed", { error: restoreError })}
                </Alert>
              )}

              {/* Recommended IDPs — only until a provider is remembered */}
              {!prevIdps.length && recommendedLogins.length
                ? (
                  <Box
                    sx={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 2,
                    }}
                  >
                    <Typography variant="subtitle2">
                      {msg("loginSignIn")}
                    </Typography>
                    {recommendedLogins.map((idp) => (
                      <Button
                        key={idp}
                        variant="outlined"
                        onClick={(e) => {
                          e.preventDefault();
                          submitCallback(idp);
                        }}
                      >
                        {idp.replace("https://", "")}
                      </Button>
                    ))}
                  </Box>
                )
                : null}

              {/* Previously used IDPs — same vertical stack as the recommended list */}
              {prevIdps.length
                ? (
                  <Box
                    sx={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 2,
                    }}
                  >
                    <Typography variant="subtitle2">
                      {msg("loginSignInAgainWith")}
                    </Typography>
                    <Box
                      sx={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 1,
                      }}
                    >
                      {prevIdps.map((idp) => (
                        <Button
                          key={idp}
                          variant="outlined"
                          onClick={(e) => {
                            e.preventDefault();
                            submitCallback(idp);
                          }}
                        >
                          {new URL(idp).host}
                        </Button>
                      ))}
                    </Box>
                    <Button
                      variant="text"
                      color="error"
                      sx={{ alignSelf: "flex-start" }}
                      onClick={(e) => {
                        e.preventDefault();
                        // Non-destructive: just forgets the remembered IDP list
                        // locally — no confirmation needed.
                        localStorage.removeItem("prevIdps");
                        setPrevIdps([]);
                      }}
                    >
                      {msg("btnClear")}
                    </Button>
                  </Box>
                )
                : null}

              {/* Sign in with a provider not listed above */}
              <Box
                sx={{ display: "flex", flexDirection: "column", gap: 2 }}
              >
                {(prevIdps.length || recommendedLogins.length)
                  ? (
                    <Typography variant="subtitle2">
                      {msg("loginSignInOther")}
                    </Typography>
                  )
                  : null}
                <Box component="form" onSubmit={handleNewIdpSubmit}>
                  <IdpInputWrapper>
                    <TextField
                      name="login"
                      label={msg("loginIdpLabel")}
                      placeholder={msg("loginIdpPlaceholder")}
                      onChange={(e) => setLogin(e.target.value)}
                      fullWidth
                    />
                    <Button type="submit" variant="contained">
                      +
                    </Button>
                  </IdpInputWrapper>
                </Box>
                {invalidIDP && (
                  <Alert severity="error" sx={{ mt: 1 }}>
                    {attemptedIdp
                      ? msg("loginCouldNotSignInTo", { idp: attemptedIdp })
                      : msg("loginCouldNotSignIn")}{" "}
                    {msg("loginEnterIdpHint")}
                    {loginErrorDetail && (
                      <Typography
                        variant="body2"
                        color="text.secondary"
                        sx={{ mt: 0.5 }}
                      >
                        Details: {loginErrorDetail}
                      </Typography>
                    )}
                  </Alert>
                )}
              </Box>

              {/* Always-available escape hatch. The `restoreError` Alert above
                  carries its own clear button, but it only appears when the IdP
                  redirected back with an error — NOT when a login bounced to the
                  IdP's own dead-end "Unknown client" page (the loop-guard case).
                  Whenever the user gets back to the chooser, this lets them wipe
                  the stale OIDC client registration without DevTools/Esc timing.
                  Hidden while the Alert is shown so there is only one clear
                  button at a time. */}
              {!restoreError && (
                <Typography variant="body2" color="text.secondary">
                  {msg("loginTroublePrefix")}
                  <Button
                    variant="text"
                    size="small"
                    disabled={clearing}
                    onClick={handleClearLocalData}
                  >
                    {clearing ? msg("loginClearing") : msg("loginClearData")}
                  </Button>
                </Typography>
              )}
            </Box>
          </Box>
        </Card>

        {footer && (
          <Box sx={{ mt: 3, textAlign: "center" }}>
            {footer}
          </Box>
        )}
      </Box>
    );
  }

  // If user is logged in, pass control to children
  return children;
};

export default Login;
