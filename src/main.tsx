/* eslint-disable react-refresh/only-export-components --
   This is the app entry module: it defines AppContent + Root and mounts them via
   ReactDOM.createRoot below. Nothing imports it, so it isn't an HMR-refreshable
   component module and the only-export-components rule doesn't apply here. */
import * as React from "react";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import ReactDOM from "react-dom/client";
import App from "./App.tsx";
import Box from "@mui/material/Box";
import CssBaseline from "@mui/material/CssBaseline";
import Typography from "@mui/material/Typography";
import Link from "@mui/material/Link";
import { ThemeProvider } from "@mui/material/styles";
import "./index.css";
import theme from "./theme.ts";
import Login from "./pages/Login.tsx";
import { getDefaultSession, Session } from "@inrupt/solid-client-authn-browser";
import {
  NotificationProvider,
  useNotification,
} from "./context/NotificationContext.tsx";
import { useQueryClient } from "@tanstack/react-query";
import { QueryProvider } from "./context/QueryProvider.tsx";
import { queryKeys } from "./hooks/queries.ts";
import { drainInbox, ensureOwnInbox } from "./services/interop/inbox.ts";
import {
  clearRequestLog,
  instrumentSessionFetch,
} from "./lib/networkActivity.ts";
import { formatError } from "./lib/formatError.ts";
import {
  clearStorageRootCache,
  resolveStorageRoot,
} from "./services/pod/solidUtils.ts";
import { resetActiveRoom } from "./services/interop/dataRoom.ts";
import {
  getSessionExpiredSnapshot,
  markSessionExpired,
  resetSessionGate,
  subscribeSessionGate,
} from "./services/pod/sessionGate.ts";

// One-shot flag (survives a manual reload) telling the Login screen NOT to restore
// the previous session. Set after a destructive logout ("Remove all app data") so
// the app doesn't silently log back in and re-bootstrap what was just deleted.
const NO_RESTORE_KEY = "granergize:noRestore";

function AppContent() {
  const { showNotification } = useNotification();
  const queryClient = useQueryClient();
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
      // Suppress the silent restore: the token is already dead, but set the
      // one-shot flag too so the Login screen can't attempt a doomed restore
      // (keeps every logout path consistent — see handleLogout).
      sessionStorage.setItem(NO_RESTORE_KEY, "1");
      setSuppressRestore(true);
      clearRequestLog();
      resetActiveRoom();
      // Evict this user's in-memory data so the next login (possibly a different
      // user on the same tab) starts clean — not just unreadable (WebID-keyed),
      // but actually gone from memory.
      queryClient.clear();
      clearStorageRootCache();
      session.logout().then(() => setSession(null));
    }
  }, [expired, session, showNotification, queryClient]);

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
      // drainInbox builds Pod paths (shared-in/) via the synchronous
      // getStorageRoot, which throws until the root is resolved. App's mount gate
      // resolves it too, but that runs AFTER this callback — so resolve it here
      // first (idempotent + cached, so the gate then no-ops).
      await resolveStorageRoot(authSession);
      // Self-provision the granergize inbox (container + append ACL) so others
      // can share with us even on a bare Pod. Idempotent; returns true only the
      // first time, when it actually creates the inbox.
      const createdInbox = await ensureOwnInbox(authSession);
      if (createdInbox) {
        showNotification("Set up your Granergize inbox on this Pod", "info");
      }
      await drainInbox(authSession);
      // drainInbox may have archived newly-granted shares into the user's
      // shared-in/ log; refresh the queries that fold it so they appear
      // (otherwise the cached read taken at mount would never reflect the grant).
      queryClient.invalidateQueries({ queryKey: queryKeys.sharedWithMe });
      queryClient.invalidateQueries({ queryKey: queryKeys.receivedViews });
      queryClient.invalidateQueries({ queryKey: queryKeys.receivedBenchmarks });
      queryClient.invalidateQueries({ queryKey: queryKeys.buildings });
    } catch (error) {
      showNotification(formatError("read your inbox", error), "error");
    }
  }, [showNotification, queryClient]);

  const handleLogout = (
    opts?: { suppressAutoLogin?: boolean; logoutType?: "app" | "idp" },
  ) => {
    if (!session) return;
    console.log("Logging out user", session.info.webId);
    // Don't carry this session's request history into the next login's loading
    // screen / header log.
    clearRequestLog();
    // Clear the in-memory current-room pointer so a different user logging in on
    // the same tab can't briefly target the previous user's room.
    resetActiveRoom();
    // Evict cached data (React Query) and the resolved storage roots so the
    // previous user's data doesn't linger in memory until the tab closes.
    queryClient.clear();
    clearStorageRootCache();
    if (opts?.suppressAutoLogin) {
      sessionStorage.setItem(NO_RESTORE_KEY, "1");
      setSuppressRestore(true);
    }
    if (opts?.logoutType === "idp") {
      // Full logout AT the identity provider: clears the provider's own login
      // cookie, which "app" logout can't touch. Without it the IdP silently
      // re-authorizes the same account on the next login, so you can't switch
      // accounts at the same provider. This navigates the browser away to the
      // provider; the `.then` below never runs. With dynamic client
      // registration there's no registered `postLogoutUrl`, so the provider may
      // not redirect back — the user reopens the app, where the `noRestore`
      // flag (set above) keeps them on the login form to choose an account.
      session.logout({ logoutType: "idp" });
      return;
    }
    session.logout().then(() => {
      setSession(null);
      showNotification("User logged out successfully", "info");
    });
  };

  return (
    <Login
      onLogin={handleLogin}
      suppressRestore={suppressRestore}
      name="Granergize App"
      // Identify the app to the Solid provider via a stable Client Identifier
      // Document (its IRI in VITE_OIDC_CLIENT_ID), so the consent screen shows
      // "Granergize App" + logo instead of an opaque dynamically-registered ID.
      // Unset in dev → falls back to dynamic registration (localhost redirect).
      loginOptions={import.meta.env.VITE_OIDC_CLIENT_ID
        ? { clientId: import.meta.env.VITE_OIDC_CLIENT_ID }
        : undefined}
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
        // One flex child (a Box, not a Fragment): the lead is a single section,
        // so the intro paragraph and its download link stay tightly grouped
        // (the `mt` below) instead of each picking up the card's section `gap`.
        <Box>
          <Typography variant="body1">
            Use the Granergize App to browse, compare and share energy
            consumption data of logistics real estate. With Granergize, you
            keep control over your data.
          </Typography>
          <Typography variant="body2" sx={{ mt: 1.5 }}>
            <Link
              href={`${import.meta.env.BASE_URL}granergize-handbuch.docx`}
            >
              Praxishandbuch herunterladen
            </Link>
          </Typography>
        </Box>
      }
      footer={
        <Typography variant="body2" color="text.secondary">
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
          {" · "}
          {__APP_COMMIT__}
        </Typography>
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
