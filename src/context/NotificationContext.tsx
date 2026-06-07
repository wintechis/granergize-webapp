import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import Snackbar from "@mui/material/Snackbar";
import Alert from "@mui/material/Alert";
import { setNotificationSink } from "../services/utils/notificationSink.ts";
import {
  enqueue,
  initialQueueState,
  promoteNext,
  requestClose,
} from "../components/notificationQueue.ts";

type Severity = "error" | "warning" | "info" | "success";

interface NotificationContextValue {
  showNotification: (message: string, severity: Severity) => void;
}

const NotificationContext = createContext<NotificationContextValue | null>(
  null,
);

export function NotificationProvider(
  { children }: { children: React.ReactNode },
) {
  // One snackbar, but a FIFO queue behind it: a burst of notifications (e.g. the
  // login-time inbox-setup notice landing just before a refetch error) plays one
  // after another instead of the later one clobbering the earlier — queue logic
  // lives in the pure, tested `notificationQueue.ts`.
  const [queue, setQueue] = useState(initialQueueState);
  const keyRef = useRef(0);

  const showNotification = useCallback(
    (message: string, severity: Severity) => {
      // Mirror error/warning notices to the console so they're observable
      // outside the (transient, auto-dismissing) snackbar — in devtools, and to
      // Playwright via page.on("console") so a regression surfaces the real
      // message instead of a mystery timeout (the e2e error guard keys on this).
      if (severity === "error") console.error(`[notify] ${message}`);
      else if (severity === "warning") console.warn(`[notify] ${message}`);
      keyRef.current += 1;
      setQueue((prev) => enqueue(prev, { key: keyRef.current, message, severity }));
    },
    [],
  );

  // Bridge the snackbar to non-React service code (e.g. first-time Pod container
  // provisioning), then drop the registration on unmount.
  useEffect(() => {
    setNotificationSink(showNotification);
    return () => setNotificationSink(null);
  }, [showNotification]);

  const handleClose = (
    _event?: React.SyntheticEvent | Event,
    reason?: string,
  ) => {
    if (reason === "clickaway") return;
    setQueue(requestClose);
  };

  // After the close transition finishes, promote the next queued notice (if any).
  const handleExited = () => setQueue(promoteNext);

  return (
    <NotificationContext.Provider value={{ showNotification }}>
      {children}
      {queue.current && (
        <Snackbar
          key={queue.current.key}
          open={queue.open}
          autoHideDuration={6000}
          onClose={handleClose}
          slotProps={{ transition: { onExited: handleExited } }}
        >
          <Alert
            onClose={handleClose}
            severity={queue.current.severity}
            variant="filled"
          >
            {queue.current.message}
          </Alert>
        </Snackbar>
      )}
    </NotificationContext.Provider>
  );
}

// The `useNotification` hook is co-located with its Provider — the canonical React
// context pattern. The react-refresh rule wants one component per exported file;
// this hook is the sanctioned exception (a dev-only HMR concern). See CLAUDE.md.
// eslint-disable-next-line react-refresh/only-export-components
export function useNotification(): NotificationContextValue {
  const ctx = useContext(NotificationContext);
  if (!ctx) {
    throw new Error("useNotification must be used inside NotificationProvider");
  }
  return ctx;
}
