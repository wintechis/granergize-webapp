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
import { readInbox } from "./services/interop/inbox.ts";
import Snackbar from "@mui/material/Snackbar";
import Alert from "@mui/material/Alert";

interface SnackbarInterface {
  open: boolean;
  message: string;
  severity: "error" | "warning" | "info" | "success";
}

function Root() {
  const [session, setSession] = useState<Session | null>(null);
  const [snackbar, setSnackbar] = useState<SnackbarInterface>({
    open: false,
    message: "",
    severity: "info",
  });

  const handleCloseSnackbar = (
    _event?: React.SyntheticEvent | Event,
    reason?: string,
  ) => {
    if (reason === "clickaway") {
      return;
    }
    setSnackbar((prev) => ({ ...prev, open: false }));
  };

  // Check for existing session on component mount
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
      setSnackbar({
        open: true,
        message: `Error reading inbox: ${error}`,
        severity: "error",
      });
    }
  }, []);

  const handleLogout = () => {
    if (session) {
      console.log("Logging out user", session.info.webId);
      // Call the Solid session logout method
      session.logout().then(() => {
        // Then clear the session in our state
        setSession(null);
        setSnackbar({
          open: true,
          message: "User logged out successfully",
          severity: "info",
        });
      });
    }
  };

  return (
    <React.Fragment>
      <ThemeProvider theme={theme}>
        <CssBaseline enableColorScheme />
        <Login onLogin={handleLogin}>
          <SolidDataProvider session={session}>
            <App session={session!} onLogout={handleLogout} />
          </SolidDataProvider>
        </Login>
        <Snackbar
          open={snackbar.open}
          autoHideDuration={6000}
          onClose={handleCloseSnackbar}
        >
          <Alert
            onClose={handleCloseSnackbar}
            severity={snackbar.severity}
            variant="filled"
          >
            {snackbar.message}
          </Alert>
        </Snackbar>
      </ThemeProvider>
    </React.Fragment>
  );
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <Root />,
);
