/* eslint-disable react-refresh/only-export-components --
   This is the app entry module: it defines AppContent + Root and mounts them via
   ReactDOM.createRoot below. Nothing imports it, so it isn't an HMR-refreshable
   component module and the only-export-components rule doesn't apply here. */
import * as React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.tsx";
import CssBaseline from "@mui/material/CssBaseline";
import Typography from "@mui/material/Typography";
import { ThemeProvider } from "@mui/material/styles";
import "./index.css";
import theme from "./theme.ts";
import Login from "./pages/Login.tsx";
import Footer from "./components/Footer.tsx";
import { NotificationProvider } from "./context/NotificationContext.tsx";
import { ConfirmProvider } from "./context/ConfirmContext.tsx";
import { QueryProvider } from "./context/QueryProvider.tsx";
import { I18nProvider } from "./context/I18nProvider.tsx";
import { PaletteFocusProvider } from "./context/PaletteFocusContext.tsx";
import { msg } from "./lib/messages.ts";
import { clearLocalData } from "./lib/clearLocalData.ts";
import { useSessionLifecycle } from "./hooks/useSessionLifecycle.ts";

function AppContent() {
  // The whole login/logout/expiry lifecycle lives in the auth-boundary hook; this
  // component is just the Login → App hand-off.
  const { session, suppressRestore, handleLogin, handleLogout } =
    useSessionLifecycle();

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
        <Typography variant="body1">
          {msg("loginLede")}
        </Typography>
      }
      footer={<Footer />}
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
        <I18nProvider>
          <NotificationProvider>
            <ConfirmProvider>
              <QueryProvider>
                <PaletteFocusProvider>
                  <AppContent />
                </PaletteFocusProvider>
              </QueryProvider>
            </ConfirmProvider>
          </NotificationProvider>
        </I18nProvider>
      </ThemeProvider>
    </React.Fragment>
  );
}

/**
 * A typeable reset escape hatch: appending `?reset` to the app URL wipes all
 * client-side auth/session storage for this origin (the same {@link clearLocalData}
 * the Login screen's "Clear local data" button runs) and reloads into a clean app.
 *
 * The "Clear local data" button only lives on the Login screen and has no address;
 * this works at ANY URL — including when a stale OIDC client registration is
 * bouncing the silent restore before the login form ever renders, which is exactly
 * when you need it. It runs BEFORE React mounts (the `BrowserRouter` only mounts
 * after auth, so a router route can't carry this), so the wipe completes before any
 * session-restore side effects fire.
 *
 * It's a destructive action behind a GET — normally a no-no — but kept as a plain
 * query flag deliberately, so it can be typed/bookmarked/pasted as a recovery URL.
 * Returns true if it handled (and is navigating away), so the caller skips mount.
 */
async function maybeHandleReset(): Promise<boolean> {
  if (!new URLSearchParams(window.location.search).has("reset")) return false;
  await clearLocalData();
  // Reload to a clean URL: drop the `?reset` flag (and any other query, e.g. a
  // stale `?error=` OIDC remedy) so the wipe isn't re-triggered on the next load;
  // keep origin + path + hash so we land back in the same deployed app + route.
  window.location.replace(
    window.location.origin + window.location.pathname + window.location.hash,
  );
  return true;
}

const resetting = await maybeHandleReset();
if (!resetting) {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <Root />,
  );
}
