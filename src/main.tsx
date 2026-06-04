import * as React from "react";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import ReactDOM from "react-dom/client";
import App from "./App.tsx";
import CssBaseline from "@mui/material/CssBaseline";
import Typography from "@mui/material/Typography";
import Link from "@mui/material/Link";
import { ThemeProvider } from "@mui/material/styles";
import "./index.css";
import "./chartSetup.ts"; // Register Chart.js globally
import theme from "./theme.ts";
import Login from "./pages/Login.tsx";
import { getDefaultSession, Session } from "@inrupt/solid-client-authn-browser";
import {
  NotificationProvider,
  useNotification,
} from "./context/NotificationContext.tsx";
import { QueryProvider } from "./context/QueryProvider.tsx";
import { readInbox } from "./services/interop/inbox.ts";
import { instrumentSessionFetch } from "./services/utils/networkActivity.ts";
import {
  getSessionExpiredSnapshot,
  markSessionExpired,
  resetSessionGate,
  subscribeSessionGate,
} from "./services/utils/sessionGate.ts";

// One-shot flag (survives a manual reload) telling the Login screen NOT to restore
// the previous session. Set after a destructive logout ("Remove all app data") so
// the app doesn't silently log back in and re-bootstrap what was just deleted.
const NO_RESTORE_KEY = "granergize:noRestore";

function AppContent() {
  const { showNotification } = useNotification();
  const [session, setSession] = useState<Session | null>(null);
  const [suppressRestore, setSuppressRestore] = useState(
    () => sessionStorage.getItem(NO_RESTORE_KEY) === "1",
  );

  useEffect(() => {
    const solidSession = getDefaultSession();
    // When the library's background token refresh fails, it emits `sessionExpired`
    // — the authoritative "logged out for real" signal. Trip the gate so in-flight
    // requests stop and the effect below cleanly logs out.
    solidSession.events.on("sessionExpired", markSessionExpired);
    if (solidSession.info.isLoggedIn) {
      console.log("User already logged in", solidSession.info.webId);
      instrumentSessionFetch(solidSession);
      setSession(solidSession);
    }
  }, []);

  // Session-expiry gate: the transport trips it on the first 401. When it does,
  // tell the user once and cleanly log out (back to the Login screen) — rather
  // than leaving an expired session firing 401s that do nothing.
  const expired = useSyncExternalStore(
    subscribeSessionGate,
    getSessionExpiredSnapshot,
    getSessionExpiredSnapshot,
  );
  useEffect(() => {
    if (expired && session) {
      showNotification("Session expired — please log in again", "warning");
      session.logout().then(() => setSession(null));
    }
  }, [expired, session, showNotification]);

  const handleLogin = useCallback(async (authSession: Session) => {
    console.log("User logged in successfully", authSession.info.webId);
    // A deliberate login clears the one-shot "don't restore" flag and the
    // expiry gate, so a fresh session starts clean.
    sessionStorage.removeItem(NO_RESTORE_KEY);
    resetSessionGate();
    setSuppressRestore(false);
    instrumentSessionFetch(authSession);
    setSession(authSession);
    try {
      await readInbox(authSession);
    } catch (error) {
      showNotification(`Error reading inbox: ${error}`, "error");
    }
  }, [showNotification]);

  const handleLogout = (opts?: { suppressAutoLogin?: boolean }) => {
    if (session) {
      console.log("Logging out user", session.info.webId);
      if (opts?.suppressAutoLogin) {
        sessionStorage.setItem(NO_RESTORE_KEY, "1");
        setSuppressRestore(true);
      }
      session.logout().then(() => {
        setSession(null);
        showNotification("User logged out successfully", "info");
      });
    }
  };

  return (
    <Login
      onLogin={handleLogin}
      suppressRestore={suppressRestore}
      name="Granergize App"
      logo={
        <img
          src={`${import.meta.env.BASE_URL}favicon.svg`}
          alt="Granergize"
        />
      }
      recommendedLogins={[
        "https://solidcommunity.net",
        "https://solid.iis.fraunhofer.de",
      ]}
      lead={
        <>
          <Typography variant="body1" sx={{ mb: 1 }}>
            Use the Granergize App to browse, compare and share energy
            consumption data of logistics real estate. With Granergize, you
            keep control over your data.
          </Typography>
          <Typography variant="body1" sx={{ mb: 1 }}>
            <Link
              href="https://www.ti.rw.fau.de/granergize/"
              target="_blank"
              rel="noopener noreferrer"
            >
              Granergize@FAU
            </Link>
            {" · "}
            <Link
              href="https://www.scs.fraunhofer.de/de/referenzen/granergize-graphenbasierter-datenraum-logistikimmobilien.html"
              target="_blank"
              rel="noopener noreferrer"
            >
              Granergize@IIS
            </Link>
          </Typography>
        </>
      }
    >
      <App session={session!} onLogout={handleLogout} />
    </Login>
  );
}

function Root() {
  return (
    <React.Fragment>
      <ThemeProvider theme={theme}>
        <CssBaseline enableColorScheme />
        <NotificationProvider>
          <QueryProvider>
            <AppContent />
          </QueryProvider>
        </NotificationProvider>
      </ThemeProvider>
    </React.Fragment>
  );
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <Root />,
);
