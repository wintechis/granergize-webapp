import { Box, IconButton, Tooltip, Typography } from "@mui/material";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import { msg } from "../../lib/messages.ts";
import type { DataRoomMember } from "../../services/interop/dataRoom.ts";
import { useNotification } from "../../context/NotificationContext.tsx";
import { logError } from "../../lib/logError.ts";
import { ellipsis } from "../../constants/listStyles.ts";
import { AgentLabel } from "../AgentLabel.tsx";
import { SectionTitle } from "../detail/DetailView.tsx";

/**
 * The room page's MEMBERS section — and the room's whole point: a **directory of
 * the people in it**, each as a name plus the WebID you share with. Derived in
 * memory from the room log (folded once by `useRoomState`).
 *
 * A room grants no access on its own and is never a share target; you read a WebID
 * here (copy it with one click) and use it in an ordinary person-to-person share.
 * The WebID is shown outside Developer mode on purpose: it is identity, not
 * storage plumbing (CLAUDE.md), and it is the thing this section exists to give you.
 */
export default function RoomMembersSection(
  { members }: { members: DataRoomMember[] },
) {
  const { showNotification } = useNotification();

  const handleCopy = async (webId: string) => {
    try {
      await navigator.clipboard.writeText(webId);
      showNotification(msg("webIdCopied"), "success");
    } catch (err) {
      logError("copy WebID to clipboard", err);
      showNotification(msg("webIdCopyFailed"), "error");
    }
  };

  return (
    <Box>
      <SectionTitle>{msg("secMembers")}</SectionTitle>
      {members.length === 0
        ? (
          <Typography variant="body2" color="text.secondary">
            {msg("roomMembersEmpty")}
          </Typography>
        )
        : (
          <Box component="ul" sx={{ listStyle: "none", pl: 0, m: 0 }}>
            {members.map((m) => (
              <Box
                component="li"
                key={m.webId}
                sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}
              >
                <Box sx={{ minWidth: 0 }}>
                  <AgentLabel value={m.webId} />
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ ...ellipsis, display: "block" }}
                  >
                    {m.webId}
                  </Typography>
                </Box>
                <Tooltip title={msg("roomCopyWebId")}>
                  <IconButton
                    size="small"
                    aria-label={msg("roomCopyWebId")}
                    onClick={() => void handleCopy(m.webId)}
                  >
                    <ContentCopyIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Box>
            ))}
          </Box>
        )}
    </Box>
  );
}
