import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import type { LoggedNotice } from "../lib/notificationLog.ts";
import { useNotificationLog } from "../hooks/notificationLog.ts";
import { useDevMode } from "../hooks/devMode.ts";
import { msg } from "../lib/messages.ts";

/** Colour for one toast's severity, matching the snackbar's Alert palette. */
function severityColor(severity: LoggedNotice["severity"]): string {
  switch (severity) {
    case "error":
      return "error.main";
    case "warning":
      return "warning.main";
    case "success":
      return "success.main";
    default:
      return "info.main";
  }
}

/** Wall-clock time a toast was shown (HH:MM:SS), for the debug log. */
function clock(at: number): string {
  return new Date(at).toLocaleTimeString();
}

/** One monospace row in the notification list. */
function LogRow(
  { severity, color, message, time }: {
    severity: string;
    color: string;
    message: string;
    time: string;
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
      <Box component="span" sx={{ color, width: 72, flexShrink: 0 }}>
        {severity}
      </Box>
      <Box
        component="span"
        sx={{ flexGrow: 1, minWidth: 0, overflowWrap: "anywhere" }}
      >
        {message}
      </Box>
      <Box component="span" sx={{ color: "text.secondary", flexShrink: 0 }}>
        {time}
      </Box>
    </Typography>
  );
}

/**
 * The recent-toast history (severity, message, time of day), newest first.
 * Mirrors {@link RequestActivityList}: a developer affordance that renders
 * nothing outside dev mode — toast messages can name user content, so they're
 * never exposed unless the dev flag is on.
 */
export default function NotificationLogList(
  { emptyText = msg("nlEmpty") }: { emptyText?: string },
) {
  const dev = useDevMode();
  const entries = useNotificationLog();

  if (!dev) return null;

  if (entries.length === 0) {
    if (!emptyText) return null;
    return <Typography color="text.secondary">{emptyText}</Typography>;
  }

  return (
    <Box component="ul" sx={{ listStyle: "none", m: 0, p: 0 }}>
      {entries.map((e) => (
        <LogRow
          key={`notice-${e.key}`}
          severity={e.severity}
          color={severityColor(e.severity)}
          message={e.message}
          time={clock(e.at)}
        />
      ))}
    </Box>
  );
}
