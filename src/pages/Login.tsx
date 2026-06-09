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
import ActivityScreen from "../components/ActivityScreen.tsx";
import { shouldRestoreSession } from "../services/utils/sessionRestore.ts";
import { logError } from "../services/utils/logError.ts";
import { normalizeIssuer } from "../services/utils/normalizeIssuer.ts";

interface LoginProps {
  children: JSX.Element;
  auto?: boolean;
  /**
   * When true, do NOT silently restore a previous session on mount (the user must
   * log in explicitly). Set after a destructive logout so the app can't auto-login
   * and re-create just-deleted data. Manual login is unaffected.
   */
  suppressRestore?: boolean;
  name?: string;
  logo?: JSX.Element;
  lead?: JSX.Element;
  /** Rendered centered at the bottom of the login screen (e.g. project links). */
  footer?: JSX.Element;
  loadingIndicator?: JSX.Element;
  recommendedLogins?: string[];
  loginOptions?: Omit<ILoginInputOptions, "oidcIssuer">;
  onLogin?: (session: Session) => void;
}

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
      alt="Logo"
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
  const [loading, setLoading] = useState(true);
  // The provider the user just picked: `session.login` does OIDC discovery +
  // client registration (a couple of network round-trips) before it navigates
  // away, so without this the button would sit dead for a second or two. Set on
  // click to take over the screen with a "Redirecting…" message until the
  // browser leaves for the provider (cleared only if login fails to start).
  const [redirectingTo, setRedirectingTo] = useState<string | null>(null);
  const [, setClearInitialLoad] = useState<ReturnType<typeof setTimeout>>();

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
    // Watchdog: never trap the user on the "Loading…" screen if a redirect or
    // restore hangs (e.g. the IdP never resolves `handleIncomingRedirect`).
    // After this fires we fall through to the login form; a late restore that
    // still succeeds will set `activeWebId` and swap in the app.
    const watchdog = setTimeout(() => setLoading(false), 8000);

    // Restoring a session on refresh does a *silent redirect* through the Solid
    // identity provider, which drops the URL fragment — and with it the in-app
    // HashRouter route plus its `?tab=`/`?b=`/`?dt=` UI-state params (see
    // notes/ui-state.md). inrupt preserves the pre-redirect URL and hands it back
    // as the `sessionRestore` event payload (its documented purpose); replay that
    // URL's fragment so a reload lands back where the user was, not on the start
    // tab. Setting the hash fires a `hashchange` the HashRouter picks up.
    // Restoring a session on refresh does a *silent redirect* through the Solid
    // identity provider, which drops the URL fragment — and with it the in-app
    // HashRouter route plus its `?tab=`/`?b=`/`?dt=` UI-state params (see
    // notes/ui-state.md). The `sessionRestore` event hands back the pre-redirect
    // URL (inrupt preserves it for exactly this), but the event fires *while*
    // `handleIncomingRedirect` is still cleaning the URL — applying the fragment
    // synchronously there gets clobbered by that cleanup. Defer to a macrotask so
    // it runs after the cleanup (and after the app has mounted); setting the hash
    // fires a `hashchange` the HashRouter picks up.
    const restoreRouteFrom = (url?: string) => {
      if (!url) return;
      setTimeout(() => {
        try {
          const { hash } = new URL(url);
          if (hash && hash !== "#" && window.location.hash !== hash) {
            window.location.hash = hash;
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
        setActiveWebId(sessionInfo.webId);
        fireLogin();
      } else {
        setTimeout(() => {
          // Decide against LIVE flags (via refs), not the values captured when
          // this effect ran — the session may have expired during the delay.
          const mayRestore = shouldRestoreSession({
            auto,
            suppressRestore,
            sessionExpired: sessionExpiredRef.current,
            sessionResponded: sessionRespondedRef.current,
          });
          if (mayRestore) {
            session
              .handleIncomingRedirect({ restorePreviousSession: true })
              .then((sessionInfo?: ISessionInfo) => {
                if (sessionInfo?.isLoggedIn) {
                  setActiveWebId(sessionInfo.webId);
                  fireLogin();
                } else {
                  setClearInitialLoad(
                    setTimeout(() => {
                      setLoading(false);
                    }, 1000),
                  );
                }
              });
          } else {
            setLoading(false);
          }
        }, 2000);
      }
    });

    return () => {
      clearTimeout(watchdog);
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
      setPrevIdps(next);
      localStorage.setItem("prevIdps", JSON.stringify(next));
    }
  }, [prevIdps, session.info.sessionId]);

  function submitCallback(idp?: string) {
    const targetIdp = idp || login;
    setInvalidIDP(false);
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
    session.login({ oidcIssuer: targetIdp, ...loginOptions }).catch(() => {
      // Login never got to the redirect (e.g. bad IdP) — restore the form.
      setRedirectingTo(null);
      setInvalidIDP(true);
    });
  }

  function handleNewIdpSubmit(e: React.FormEvent) {
    e.preventDefault();
    setInvalidIDP(false);
    const enteredIdp = normalizeIssuer(login);
    submitCallback(enteredIdp);
  }

  // Machine-loading states (cold start, post-redirect code exchange, session
  // restore) use the SAME plain activity screen as the app shell's storage-root
  // load, so the whole login→app transition reads as one continuous "Loading…"
  // instead of a chain of different-looking screens.
  if (loading) {
    return <ActivityScreen title={loadingIndicator ?? "Loading…"} />;
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
              {name ?? "Solid Login"}
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
                  Choose an Identity Provider for this{" "}
                  <a href="https://solidproject.org/">Solid Application</a>
                </Typography>
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
                      Sign in
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
                      Sign in again with
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
                      Clear
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
                      Sign in with another identity provider
                    </Typography>
                  )
                  : null}
                <Box component="form" onSubmit={handleNewIdpSubmit}>
                  <IdpInputWrapper>
                    <TextField
                      name="login"
                      label="Identity Provider"
                      placeholder="e.g. inrupt.net"
                      onChange={(e) => setLogin(e.target.value)}
                      fullWidth
                    />
                    <Button type="submit" variant="contained">
                      +
                    </Button>
                  </IdpInputWrapper>
                </Box>
                {invalidIDP && (
                  <Typography variant="body2" color="error">
                    Please provide a correct URI.
                  </Typography>
                )}
              </Box>
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
