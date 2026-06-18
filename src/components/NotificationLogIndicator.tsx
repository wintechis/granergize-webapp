import { useState } from "react";
import Badge from "@mui/material/Badge";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import NotificationsNoneIcon from "@mui/icons-material/NotificationsNone";
import Modal from "./Modal.tsx";
import NotificationLogList from "./NotificationLogList.tsx";
import { msg } from "../lib/messages.ts";
import { useNotificationLog } from "../hooks/notificationLog.ts";
import { clearNotificationLog } from "../lib/notificationLog.ts";
import { useDevMode } from "../hooks/devMode.ts";

/**
 * Dev-mode-only header affordance, the toast counterpart to
 * {@link NetworkActivityIndicator}: an icon + recent-count badge that opens a
 * debug log of the last N toasts the app has shown (severity, message, time).
 * Self-hides outside developer mode — toasts aren't in flight, so there is no
 * spinner, just the click-to-open history.
 */
export default function NotificationLogIndicator() {
  const dev = useDevMode();
  const entries = useNotificationLog();
  const [open, setOpen] = useState(false);

  if (!dev) return null;

  return (
    <Box sx={{ display: "flex", alignItems: "center" }}>
      <Tooltip title={msg("nlShowLogShort")}>
        <IconButton
          size="small"
          onClick={() => setOpen(true)}
          aria-label={msg("nlShowLog")}
        >
          <Badge badgeContent={entries.length} color="primary" max={99}>
            <NotificationsNoneIcon fontSize="small" sx={{ opacity: 0.55 }} />
          </Badge>
        </IconButton>
      </Tooltip>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        dismissable
        maxWidth="md"
        title={
          <>
            {msg("nlTitle")}
            <Typography
              component="span"
              variant="body2"
              color="text.secondary"
              sx={{ ml: 1 }}
            >
              {msg("nlRecent", { count: entries.length })}
            </Typography>
          </>
        }
        actions={
          <>
            <Button
              onClick={clearNotificationLog}
              disabled={entries.length === 0}
            >
              {msg("btnClear")}
            </Button>
            <Button onClick={() => setOpen(false)}>{msg("btnClose")}</Button>
          </>
        }
      >
        <NotificationLogList />
      </Modal>
    </Box>
  );
}
