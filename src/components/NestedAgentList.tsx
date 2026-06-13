import { Box, IconButton, Tooltip, Typography } from "@mui/material";
import DeleteIcon from "@mui/icons-material/Delete";
import { AgentLabel } from "./AgentLabel.tsx";
import { ellipsis } from "../constants/listStyles.ts";

/**
 * The "shared with" sub-list under a resource row: each grantee as an
 * `AgentLabel` with a revoke action. One component so the buildings and views
 * lists (and any future "shared with" surface) render identically — they had
 * drifted (one used `<small>`, the other a caption; one lacked the revoke
 * Tooltip). Renders nothing when empty.
 */
export default function NestedAgentList(
  { agents, label, onRevoke, isRevoking, revokeLabel = "Revoke access" }: {
    agents: string[];
    /** Optional heading above the list (e.g. "Shared with:"). */
    label?: string;
    onRevoke: (webId: string) => void;
    /** Per-agent busy flag, to disable that row's revoke while it's in flight. */
    isRevoking?: (webId: string) => boolean;
    revokeLabel?: string;
  },
) {
  if (agents.length === 0) return null;
  return (
    <Box sx={{ mt: 0.5 }}>
      {label && (
        <Typography variant="caption" color="text.secondary">{label}</Typography>
      )}
      <Box component="ul" sx={{ listStyle: "none", pl: 2.5, mt: 0.5, mb: 0 }}>
        {agents.map((webId) => (
          <Box
            component="li"
            key={webId}
            sx={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 1,
            }}
          >
            <Typography
              component="span"
              variant="caption"
              title={webId}
              sx={ellipsis}
            >
              <AgentLabel value={webId} />
            </Typography>
            <Tooltip title={revokeLabel}>
              <IconButton
                size="small"
                aria-label={revokeLabel}
                onClick={() => onRevoke(webId)}
                disabled={isRevoking?.(webId)}
              >
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
        ))}
      </Box>
    </Box>
  );
}
