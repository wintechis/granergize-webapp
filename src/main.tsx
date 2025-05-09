import * as React from 'react';
import { useState, useEffect } from 'react';
import ReactDOM from "react-dom/client";
import App from "./App.tsx";
import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider } from '@mui/material/styles';
import "./index.css";
import theme from "./theme.ts";
import Login from "./pages/Login.tsx";
import { Session, getDefaultSession } from "@inrupt/solid-client-authn-browser";
import { SolidDataProvider } from "./context/SolidDataContext.tsx";


function Root() {
  const [session, setSession] = useState<Session | null>(null);
  
  // Check for existing session on component mount
  useEffect(() => {
    const solidSession = getDefaultSession();
    if (solidSession.info.isLoggedIn) {
      console.log("User already logged in", solidSession.info.webId);
      setSession(solidSession);
    }
  }, []);
  
  const handleLogin = (authSession: Session) => {
    console.log("User logged in successfully", authSession.info.webId);
    setSession(authSession);
  };
  
  const handleLogout = () => {
    if (session) {
      console.log("Logging out user", session.info.webId);
      // Call the Solid session logout method
      session.logout().then(() => {
        // Then clear the session in our state
        setSession(null);
      });
    }
  };
  
  return (
    <React.Fragment>
      <ThemeProvider theme={theme}>
        <CssBaseline enableColorScheme />
        <Login onLogin={handleLogin}>
          <SolidDataProvider session={session}>
            <App onLogout={handleLogout} />
          </SolidDataProvider>
        </Login>
      </ThemeProvider>
    </React.Fragment>
  );
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <Root />
);