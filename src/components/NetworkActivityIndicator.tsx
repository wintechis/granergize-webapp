import { useEffect, useRef, useState } from "react";
import Badge from "@mui/material/Badge";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import HistoryIcon from "@mui/icons-material/History";
import Modal from "./Modal.tsx";
import RequestActivityList from "./RequestActivityList.tsx";
import {
  currentStorageRoot,
  displayLabel,
  useNetworkActivity,
  useRequestLog,
} from "../hooks/requestActivity.ts";
import { clearRequestLog } from "../lib/networkActivity.ts";
import { useDevMode } from "../hooks/devMode.ts";

/**
 * Header indicator reflecting ALL in-flight network requests (Pod fetches, map
 * tiles, geocoding, weather). The active requests are listed inline to the LEFT
 * of a spinner + count badge; the control is always clickable and opens a debug
 * log of recent finished requests (status, pod-relative path, duration) — handy
 * for seeing what the app is talking to and spotting repeats/failures. Hiding
 * the spinner is debounced so quick bursts (map tiles) don't flicker.
 */
export default function NetworkActivityIndicator() {
  const dev = useDevMode();
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

  // Outside dev mode: a plain spinner while requests are in flight, nothing else
  // — no inline request URIs, no clickable log. Dev mode exposes the full debug
  // log (request URIs + history dialog) below.
  if (!dev) {
    return (
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          minWidth: 40,
        }}
      >
        {(spinning || count > 0) && (
          <CircularProgress size={20} thickness={5} />
        )}
      </Box>
    );
  }

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
        <RequestActivityList />
      </Modal>
    </Box>
  );
}
