import { Box, IconButton, Tooltip, Typography } from "@mui/material";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import { QRCodeSVG } from "qrcode.react";
import { useNotification } from "../../context/NotificationContext.tsx";
import { roomRoute } from "../../routes.ts";
import { logError } from "../../lib/logError.ts";
import { SectionTitle } from "../detail/DetailView.tsx";

/**
 * The room page's INVITE section: a QR code plus a copy-invite-link affordance.
 * Both encode the same app deep link (`<app root>/room/<encoded room URI>`) — what
 * the room page opens (and joins) on mount — so showing the QR or copying the link
 * lets others join this data room. Extracted from the old Connect-tab room
 * expansion.
 */
export default function RoomInviteSection({ roomUri }: { roomUri: string }) {
  const { showNotification } = useNotification();

  // Real-path deep link under BrowserRouter: <origin><app root><room path>. The
  // app root comes from the R-b base detection (window.__APP_BASE__, ends in "/");
  // `roomRoute` returns a leading-slash path, so drop one slash when joining.
  const appRoot = globalThis.__APP_BASE__ ?? globalThis.location.pathname;
  const inviteLink = `${globalThis.location.origin}${appRoot}${
    roomRoute(roomUri).slice(1)
  }`;

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(inviteLink);
      showNotification("Invite link copied", "success");
    } catch (err) {
      logError("copy invite link to clipboard", err);
      showNotification("Could not copy link", "error");
    }
  };

  return (
    <Box>
      <SectionTitle>Invite</SectionTitle>
      <QRCodeSVG value={inviteLink} size={160} />
      <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
        Show this QR code, or copy the invite link, so others can join this data
        room.
      </Typography>
      <Tooltip title="Copy invite link">
        <IconButton
          size="small"
          aria-label="Copy invite link"
          onClick={handleCopyLink}
          sx={{ mt: 1 }}
        >
          <ContentCopyIcon fontSize="small" />
        </IconButton>
      </Tooltip>
    </Box>
  );
}
