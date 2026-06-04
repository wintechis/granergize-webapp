import React, { useEffect, useState } from "react";
import {
  getDefaultSession,
  ILoginInputOptions,
  ISessionInfo,
  Session,
} from "@inrupt/solid-client-authn-browser";

import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { styled } from "@mui/material/styles";

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
  loadingIndicator?: JSX.Element;
  recommendedLogins?: string[];
  loginOptions?: Omit<ILoginInputOptions, "oidcIssuer">;
  onLogin?: (session: Session) => void;
}

const IdpInputWrapper = styled(Box)(({ theme }) => ({
  display: "flex",
  alignItems: "center",
  gap: theme.spacing(1),
  marginTop: theme.spacing(1),
  width: "100%",
}));

export const Login: React.FC<LoginProps> = ({
  children,
  loadingIndicator,
  auto = true,
  suppressRestore = false,
  name,
  lead,
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
  const [sessionExpired, setSessionExpired] = useState(false);
  const [sessionResponded, setSessionResponded] = useState(false);
  const [, setClearInitialLoad] = useState<ReturnType<typeof setTimeout>>();

  // State for new IDP input
  const [login, setLogin] = useState("");

  const session = getDefaultSession();

  useEffect(() => {
    session.events.on("logout", () => {
      setSessionResponded(true);
      setLoading(false);
      setActiveWebId(undefined);
    });

    session.events.on("sessionExpired", () => {
      setSessionResponded(true);
      setLoading(false);
      setSessionExpired(true);
      setActiveWebId(undefined);
    });

    session.events.on("login", () => {
      setSessionResponded(true);
      setLoading(false);

      // Call onLogin with the session
      if (onLogin) {
        onLogin(session);
      }
    });

    session.events.on("sessionRestore", () => {
      setSessionResponded(true);
      setLoading(false);
      if (onLogin) {
        onLogin(session);
      }
    });

    session.handleIncomingRedirect().then((sessionInfo?: ISessionInfo) => {
      if (sessionInfo?.isLoggedIn) {
        setActiveWebId(sessionInfo.webId);
        if (onLogin) {
          onLogin(session);
        }
      } else {
        setTimeout(() => {
          // Suppress the silent restore after a destructive logout.
          const mayRestore = auto && !suppressRestore;
          if (!sessionExpired && !sessionResponded && mayRestore) {
            session
              .handleIncomingRedirect({ restorePreviousSession: true })
              .then((sessionInfo?: ISessionInfo) => {
                if (sessionInfo?.isLoggedIn) {
                  setActiveWebId(sessionInfo.webId);
                  if (onLogin) {
                    onLogin(session);
                  }
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
    } catch {
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
    session.login({ oidcIssuer: targetIdp, ...loginOptions }).catch(() => {
      setInvalidIDP(true);
    });
  }

  function handleNewIdpSubmit(e: React.FormEvent) {
    e.preventDefault();
    setInvalidIDP(false);
    const enteredIdp = login.startsWith("https://")
      ? login
      : `https://${login}`;
    submitCallback(enteredIdp);
  }

  // Loading screen
  if (loading) {
    return (
      <Box
        sx={{
          position: "relative",
          width: "100%",
          minHeight: "100vh",
        }}
      >
        <Box
          sx={{
            position: "absolute",
            transform: "translate(-50%, -50%)",
            top: "50%",
            left: "50%",
            padding: 0,
          }}
        >
          {loadingIndicator ?? "Loading..."}
        </Box>
      </Box>
    );
  }


  // If user is not logged in, show login UI
  if (!activeWebId) {
    return (
      <Box
        sx={{
          position: "relative",
          width: "100%",
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          p: 2,
        }}
      >
        {logo && (
          <Box
            sx={{
              mb: 2,
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

        <Typography variant="h6" sx={{ mb: 2 }}>
          {name ?? "Solid Login"}
        </Typography>

        <Box
          sx={{
            display: "flex",
            flexDirection: "column",
            gap: 2,
            maxWidth: 500,
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

          {/* Recommended IDPs */}
          {!prevIdps.length && recommendedLogins.length
            ? (
              <Typography variant="button" component="b" sx={{ mt: 2 }}>
                SIGN IN WITH AN IDENTITY PROVIDER
              </Typography>
            )
            : null}

          {prevIdps.length === 0
            ? recommendedLogins.map((idp) => (
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
            ))
            : null}

          {/* Previously used IDPs */}
          {prevIdps.length
            ? (
              <Box sx={{ mt: 2 }}>
                <Typography variant="button" component="b">
                  SIGN IN AGAIN WITH
                </Typography>
                <Box sx={{ mt: 1, display: "flex", gap: 1, flexWrap: "wrap" }}>
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
                  <Button
                    variant="text"
                    color="error"
                    onClick={(e) => {
                      e.preventDefault();
                      // Non-destructive: just forgets the remembered IDP list
                      // locally — no confirmation needed.
                      localStorage.removeItem("prevIdps");
                      setPrevIdps([]);
                    }}
                  >
                    CLEAR
                  </Button>
                </Box>
              </Box>
            )
            : null}

          {/* Prompt user for a new IDP */}
          {(prevIdps.length || recommendedLogins.length) && (
            <Typography variant="button" component="b" sx={{ mt: 2 }}>
              SIGN IN WITH ANOTHER IDENTITY PROVIDER
            </Typography>
          )}

          <Box component="form" onSubmit={handleNewIdpSubmit} sx={{ mt: 1 }}>
            <IdpInputWrapper>
              <TextField
                name="login"
                label="Identity Provider"
                placeholder="e.g. inrupt.net"
                onChange={(e) => setLogin(e.target.value)}
                fullWidth
              />
              <Button
                type="submit"
                variant="contained"
                sx={{ height: "56px" }}
              >
                +
              </Button>
            </IdpInputWrapper>
          </Box>

          {invalidIDP && (
            <Typography component="span" color="error">
              Please provide a correct URI.
            </Typography>
          )}
        </Box>
      </Box>
    );
  }

  // If user is logged in, pass control to children
  return children;
};

export default Login;
