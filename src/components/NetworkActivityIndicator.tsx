import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Badge from "@mui/material/Badge";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import HistoryIcon from "@mui/icons-material/History";
import Modal from "./Modal.tsx";
import { getDefaultSession } from "@inrupt/solid-client-authn-browser";
import {
  type ActiveRequest,
  clearRequestLog,
  getActivitySnapshot,
  getRequestLog,
  type RequestLogEntry,
  subscribeActivity,
} from "../services/utils/networkActivity.ts";
import { getStorageRoot } from "../services/utils/solidUtils.ts";

/** Subscribe to the in-flight request list (re-renders on change). */
function useNetworkActivity(): ActiveRequest[] {
  return useSyncExternalStore(
    subscribeActivity,
    getActivitySnapshot,
    getActivitySnapshot,
  );
}

/** Subscribe to the finished-request history (re-renders on change). */
function useRequestLog(): RequestLogEntry[] {
  return useSyncExternalStore(subscribeActivity, getRequestLog, getRequestLog);
}

/** The resolved Pod storage root, or "" if not available yet. */
function currentStorageRoot(): string {
  try {
    const webId = getDefaultSession().info.webId;
    return webId ? getStorageRoot(webId) : "";
  } catch {
    return "";
  }
}

/**
 * Display text for one request: requests under the Pod show as a relative path
 * (`METHOD granergize/…`); anything else (external URLs, or label-only entries
 * like "map tiles") shows in full.
 */
function displayLabel(r: ActiveRequest, root: string): string {
  if (!r.url) return r.label;
  const method = r.label.split(" ")[0];
  const noQuery = r.url.split("#")[0].split("?")[0];
  const where = root && noQuery.startsWith(root)
    ? noQuery.slice(root.length)
    : noQuery;
  return `${method} ${where}`;
}

/** Status text + colour for one finished request. */
function statusInfo(e: RequestLogEntry): { text: string; color: string } {
  if (e.error) return { text: "failed", color: "error.main" };
  if (e.status === undefined) return { text: "done", color: "text.secondary" };
  if (e.status === 429 || e.status === 503) {
    return { text: String(e.status), color: "warning.main" };
  }
  if (e.status >= 400) return { text: String(e.status), color: "error.main" };
  return { text: String(e.status), color: "success.main" };
}

/** One monospace row in the log dialog. */
function LogRow(
  { label, status, color, duration }: {
    label: string;
    status: string;
    color: string;
    duration: string;
  },
) {
  return (
    <Typography
      component="li"
      variant="body2"
      sx={{
        display: "flex",
        alignItems: "baseline",
        gap: 1.5,
        py: 0.25,
        fontFamily: "monospace",
      }}
    >
      <Box component="span" sx={{ color, width: 56, flexShrink: 0 }}>
        {status}
      </Box>
      <Box
        component="span"
        sx={{ flexGrow: 1, minWidth: 0, overflowWrap: "anywhere" }}
      >
        {label}
      </Box>
      <Box component="span" sx={{ color: "text.secondary", flexShrink: 0 }}>
        {duration}
      </Box>
    </Typography>
  );
}

/**
 * Header indicator reflecting ALL in-flight network requests (Pod fetches, map
 * tiles, geocoding, weather). The active requests are listed inline to the LEFT
 * of a spinner + count badge; the control is always clickable and opens a debug
 * log of recent finished requests (status, pod-relative path, duration) — handy
 * for seeing what the app is talking to and spotting repeats/failures. Hiding
 * the spinner is debounced so quick bursts (map tiles) don't flicker.
 */
export default function NetworkActivityIndicator() {
  const active = useNetworkActivity();
  const logEntries = useRequestLog();
  const count = active.length;
  const [open, setOpen] = useState(false);
  const [spinning, setSpinning] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (count > 0) {
      clearTimeout(hideTimer.current);
      setSpinning(true);
    } else {
      hideTimer.current = setTimeout(() => setSpinning(false), 350);
    }
    return () => clearTimeout(hideTimer.current);
  }, [count]);

  const root = currentStorageRoot();
  // Newest active request nearest the spinner (right-aligned, so the clip eats
  // the oldest on the left).
  const inlineText = active.map((r) => displayLabel(r, root)).join("  ·  ");

  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1, minWidth: 40 }}>
      {count > 0 && (
        <Box
          sx={{
            maxWidth: { xs: 160, sm: 320, md: 440 },
            minWidth: 0,
            display: "flex",
            justifyContent: "flex-end",
          }}
        >
          <Tooltip title={inlineText}>
            <Typography
              variant="caption"
              noWrap
              sx={{ fontFamily: "monospace", color: "text.secondary" }}
            >
              {inlineText}
            </Typography>
          </Tooltip>
        </Box>
      )}
      <Tooltip
        title={count > 0
          ? `${count} request(s) loading — click for the request log`
          : "Show request log"}
      >
        <IconButton
          size="small"
          onClick={() => setOpen(true)}
          aria-label="Show network request log"
        >
          {spinning || count > 0
            ? (
              <Badge badgeContent={count} color="primary" max={99}>
                <CircularProgress size={20} thickness={5} />
              </Badge>
            )
            : <HistoryIcon fontSize="small" sx={{ opacity: 0.55 }} />}
        </IconButton>
      </Tooltip>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        dismissable
        maxWidth="md"
        title={
          <>
            Network requests
            <Typography
              component="span"
              variant="body2"
              color="text.secondary"
              sx={{ ml: 1 }}
            >
              {count > 0 ? `${count} in flight · ` : ""}
              {logEntries.length} recent
            </Typography>
          </>
        }
        actions={
          <>
            <Button
              onClick={clearRequestLog}
              disabled={logEntries.length === 0}
            >
              Clear
            </Button>
            <Button onClick={() => setOpen(false)}>Close</Button>
          </>
        }
      >
        {active.length === 0 && logEntries.length === 0
          ? <Typography color="text.secondary">No requests yet.</Typography>
          : (
            <Box component="ul" sx={{ listStyle: "none", m: 0, p: 0 }}>
              {/* In-flight first, marked pending. */}
              {active.map((r) => (
                <LogRow
                  key={`active-${r.id}`}
                  status="…"
                  color="primary.main"
                  label={displayLabel(r, root)}
                  duration="pending"
                />
              ))}
              {logEntries.map((e) => {
                const s = statusInfo(e);
                return (
                  <LogRow
                    key={`log-${e.id}`}
                    status={s.text}
                    color={s.color}
                    label={displayLabel(e, root)}
                    duration={`${e.durationMs} ms`}
                  />
                );
              })}
            </Box>
          )}
      </Modal>
    </Box>
  );
}
