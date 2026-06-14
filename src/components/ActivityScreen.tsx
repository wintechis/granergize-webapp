import { type ReactNode } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import RequestActivityList from "./RequestActivityList.tsx";

interface ActivityScreenProps {
  /** What is happening, e.g. "Removing all app data…" or "Loading…". */
  title: ReactNode;
  /** When given, shows a Cancel button wired to this handler. */
  onCancel?: () => void;
  cancelLabel?: string;
}

/**
 * A full-page progress screen that shows the live network requests behind a
 * long transition (login redirect, initial load, "Remove all app data"), so the
 * user sees what the app is doing instead of a blank wait. Same flex-centering
 * as the login screen, and the same Granergize "G" mark on top, so the whole
 * login → app load reads as one continuous branded screen rather than a chain
 * of different-looking waits. The request list scrolls within a bounded region;
 * an optional Cancel button is shown when `onCancel` is provided.
 */
export default function ActivityScreen(
  { title, onCancel, cancelLabel = "Cancel" }: ActivityScreenProps,
) {
  return (
    <Box
      sx={{
        width: "100%",
        minHeight: "100vh",
        // Keep full content height so a long request list overflows downward to
        // the normal browser scrollbar (see Login.tsx for the same #root note).
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        py: 4,
        px: 2,
      }}
    >
      <Box
        sx={{
          width: "100%",
          maxWidth: 720,
          display: "flex",
          flexDirection: "column",
          gap: 3,
        }}
      >
        <Box
          sx={{
            width: 64,
            height: "auto",
            "& img": { width: "100%", height: "auto", display: "block" },
          }}
        >
          <img
            src={`${import.meta.env.BASE_URL}favicon.svg`}
            alt="Granergize"
          />
        </Box>
        <Typography variant="h6">{title}</Typography>
        <Box sx={{ maxHeight: "50vh", overflowY: "auto" }}>
          <RequestActivityList emptyText="" />
        </Box>
        {onCancel && (
          <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
            <Button variant="outlined" onClick={onCancel}>
              {cancelLabel}
            </Button>
          </Box>
        )}
      </Box>
    </Box>
  );
}
