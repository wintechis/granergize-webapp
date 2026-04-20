import * as React from "react";
import { useCallback, useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import App from "./App.tsx";
import CssBaseline from "@mui/material/CssBaseline";
import { ThemeProvider } from "@mui/material/styles";
import "./index.css";
import "./chartSetup.ts"; // Register Chart.js globally
import theme from "./theme.ts";
import Login from "./pages/Login.tsx";
import { getDefaultSession, Session } from "@inrupt/solid-client-authn-browser";
import { SolidDataProvider } from "./context/SolidDataContext.tsx";
import {
  NotificationProvider,
  useNotification,
} from "./context/NotificationContext.tsx";
import { readInbox } from "./services/interop/inbox.ts";

function AppContent() {
  const { showNotification } = useNotification();
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    const solidSession = getDefaultSession();
    if (solidSession.info.isLoggedIn) {
      console.log("User already logged in", solidSession.info.webId);
      setSession(solidSession);
    }
  }, []);

  const handleLogin = useCallback(async (authSession: Session) => {
    console.log("User logged in successfully", authSession.info.webId);
    setSession(authSession);
    try {
      await readInbox(authSession);
    } catch (error) {
      showNotification(`Error reading inbox: ${error}`, "error");
    }
  }, [showNotification]);

  const handleLogout = () => {
    if (session) {
      console.log("Logging out user", session.info.webId);
      session.logout().then(() => {
        setSession(null);
        showNotification("User logged out successfully", "info");
      });
    }
  };

  return (
    <Login onLogin={handleLogin}>
      <SolidDataProvider session={session}>
        <App session={session!} onLogout={handleLogout} />
      </SolidDataProvider>
    </Login>
  );
}

function Root() {
  return (
    <React.Fragment>
      <ThemeProvider theme={theme}>
        <CssBaseline enableColorScheme />
        <NotificationProvider>
          <AppContent />
        </NotificationProvider>
      </ThemeProvider>
    </React.Fragment>
  );
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <Root />,
);
