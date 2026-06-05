import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { type RequestLogEntry } from "../services/utils/networkActivity.ts";
import {
  currentStorageRoot,
  displayLabel,
  useNetworkActivity,
  useRequestLog,
} from "./requestActivity.ts";

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

/** One monospace row in the request list. */
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
 * The shared request list: in-flight requests first (marked pending), then the
 * recent finished-request history (status, pod-relative path, duration). Used
 * both by the header indicator's log dialog and by the full-page activity
 * screen, so what the user sees in either place is identical. Self-subscribes
 * to the activity store.
 */
export default function RequestActivityList(
  { emptyText = "No requests yet." }: { emptyText?: string },
) {
  const active = useNetworkActivity();
  const logEntries = useRequestLog();
  const root = currentStorageRoot();

  if (active.length === 0 && logEntries.length === 0) {
    return <Typography color="text.secondary">{emptyText}</Typography>;
  }

  return (
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
  );
}
