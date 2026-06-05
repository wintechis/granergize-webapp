import React, { createContext, useCallback, useContext, useState } from "react";
import Snackbar from "@mui/material/Snackbar";
import Alert from "@mui/material/Alert";

type Severity = "error" | "warning" | "info" | "success";

interface NotificationState {
  open: boolean;
  message: string;
  severity: Severity;
}

interface NotificationContextValue {
  showNotification: (message: string, severity: Severity) => void;
}

const NotificationContext = createContext<NotificationContextValue | null>(
  null,
);

export function NotificationProvider(
  { children }: { children: React.ReactNode },
) {
  const [notification, setNotification] = useState<NotificationState>({
    open: false,
    message: "",
    severity: "info",
  });

  const showNotification = useCallback(
    (message: string, severity: Severity) => {
      // Mirror error/warning notices to the console so they're observable
      // outside the (transient, auto-dismissing) snackbar — in devtools, and to
      // Playwright via page.on("console") so a regression surfaces the real
      // message instead of a mystery timeout (the e2e error guard keys on this).
      if (severity === "error") console.error(`[notify] ${message}`);
      else if (severity === "warning") console.warn(`[notify] ${message}`);
      setNotification({ open: true, message, severity });
    },
    [],
  );

  const handleClose = (
    _event?: React.SyntheticEvent | Event,
    reason?: string,
  ) => {
    if (reason === "clickaway") return;
    setNotification((prev) => ({ ...prev, open: false }));
  };

  return (
    <NotificationContext.Provider value={{ showNotification }}>
      {children}
      <Snackbar
        open={notification.open}
        autoHideDuration={6000}
        onClose={handleClose}
      >
        <Alert
          onClose={handleClose}
          severity={notification.severity}
          variant="filled"
        >
          {notification.message}
        </Alert>
      </Snackbar>
    </NotificationContext.Provider>
  );
}

export function useNotification(): NotificationContextValue {
  const ctx = useContext(NotificationContext);
  if (!ctx) {
    throw new Error("useNotification must be used inside NotificationProvider");
  }
  return ctx;
}
