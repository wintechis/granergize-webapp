import React, { useCallback, useContext, useEffect, useState } from "react";
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
  name?: string;
  logo?: JSX.Element;
  lead?: JSX.Element;
  loadingIndicator?: JSX.Element;
  recommendedLogins?: string[];
  loginOptions?: Omit<ILoginInputOptions, "oidcIssuer">;
  onLogin?: (session: Session) => void;
}

interface LoginContext {
  connect(): void;
  abort(): void;
  restoreState(): { from?: string; clearState(): void };
  session?: Session;
}

const LoginContext = React.createContext<LoginContext>({
  connect: () => {},
  abort: () => {},
  restoreState: () => ({ clearState: () => {} }),
});

export const useConnect = () => {
  const { connect, ...rest } = useContext(LoginContext);
  connect();
  return rest;
};

export const useRestoreState = () => {
  const { restoreState } = useContext(LoginContext);
  return restoreState();
};

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
  const [newLogin, setNewLogin] = useState(
    Boolean(localStorage.getItem("newLogin")),
  );

  const [activeWebId, setActiveWebId] = useState<string>();
  const [showRememberPromptFor, setShowRememberPromptFor] = useState<string>();

  const [manualTrigger, setManualTrigger] = useState(false);
  const [invalidIDP, setInvalidIDP] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [sessionResponded, setSessionResponded] = useState(false);
  const [, setClearInitialLoad] = useState<ReturnType<typeof setTimeout>>();

  // State for new IDP input
  const [login, setLogin] = useState("");

  const session = getDefaultSession();

  useEffect(() => {
    if (
      loginOptions?.redirectUrl &&
      (auto || manualTrigger) &&
      location.pathname !== new URL(loginOptions?.redirectUrl).pathname
    ) {
      const params = new URLSearchParams(location.search);
      params.delete("code");
      const fromParams = params.size > 0 ? "?" + params : "";
      const fromHash = location.hash ? "#" + location.hash : "";
      const from = `${location.pathname}${fromHash}${fromParams}`;
      localStorage.setItem("loginFrom", from);
    }

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
          if (!sessionExpired && !sessionResponded && (auto || manualTrigger)) {
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
  }, [auto, manualTrigger, onLogin, session]);

  useEffect(() => {
    // If user had a previous session, check for that issuer
    const clientAuth = JSON.parse(
      localStorage.getItem(
        `solidClientAuthenticationUser:${session.info.sessionId}`,
      ) as string,
    );
    if (clientAuth?.issuer) {
      const alreadyExists = prevIdps.includes(clientAuth.issuer);
      if (!alreadyExists) {
        setShowRememberPromptFor(clientAuth.issuer);
      }
    }
  }, [prevIdps, session.info.sessionId]);

  const connectCallBack = useCallback(() => {
    setManualTrigger(true);
  }, []);

  const abortCallBack = useCallback(() => {
    setManualTrigger(false);
  }, []);

  function submitCallback(idp?: string) {
    const targetIdp = idp || login;
    if (!prevIdps.includes(targetIdp)) {
      localStorage.setItem("newLogin", "true");
    } else {
      localStorage.removeItem("newLogin");
    }
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

  if (!auto && !manualTrigger && !showRememberPromptFor) {
    return (
      <LoginContext.Provider
        value={{
          connect: connectCallBack,
          abort: abortCallBack,
          restoreState: () => ({ clearState: () => {} }),
        }}
      >
        {children}
      </LoginContext.Provider>
    );
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

  // Prompt user to remember new IDP
  if (activeWebId && showRememberPromptFor && newLogin) {
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
          <Box
            component="form"
            sx={{ display: "flex", flexDirection: "column", gap: 2 }}
          >
            <Typography component="span">
              Do you want to save <b>{new URL(showRememberPromptFor).host}</b>
              {" "}
              as an identity provider for future logins?
            </Typography>
            <Box sx={{ display: "flex", gap: 2 }}>
              <Button
                variant="contained"
                onClick={(e) => {
                  e.preventDefault();
                  const newIdps = [...prevIdps, showRememberPromptFor];
                  setPrevIdps(newIdps);
                  localStorage.setItem("prevIdps", JSON.stringify(newIdps));
                  setNewLogin(false);
                }}
              >
                Save Login Info
              </Button>
              <Button
                variant="outlined"
                onClick={(e) => {
                  e.preventDefault();
                  localStorage.removeItem("newLogin");
                  setNewLogin(false);
                }}
              >
                No, thanks
              </Button>
            </Box>
          </Box>
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
                RECOMMENDED LOGINS
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
                  FROM PREVIOUS LOGINS
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
                      // eslint-disable-next-line no-restricted-globals
                      if (
                        confirm(
                          `Do you really want to clear all your login info for ${
                            name ?? "this Solid Application"
                          }?`,
                        )
                      ) {
                        localStorage.removeItem("prevIdps");
                        setPrevIdps([]);
                      }
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
              NEW LOGIN
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
                size="large"
                sx={{ height: "56px" }}
              >
                +
              </Button>
            </IdpInputWrapper>
          </Box>

          {invalidIDP && (
            <Typography component="span" color="error">
              Please provide a correct URL.
            </Typography>
          )}
        </Box>
      </Box>
    );
  }

  // If user is logged in, pass control to children
  return (
    <LoginContext.Provider
      value={{
        session,
        restoreState: () => {
          const loginFrom = localStorage.getItem("loginFrom") ?? undefined;
          return {
            from: loginFrom,
            clearState: () => {
              localStorage.removeItem("loginFrom");
            },
          };
        },
        connect: () => {},
        abort: () => {},
      }}
    >
      {children}
    </LoginContext.Provider>
  );
};

export default Login;
