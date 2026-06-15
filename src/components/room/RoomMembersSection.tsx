import { Box, Typography } from "@mui/material";
import type { DataRoomMember } from "../../services/interop/dataRoom.ts";
import { roleLabel } from "../../constants/roles.ts";
import { AgentLabel } from "../AgentLabel.tsx";
import { SectionTitle } from "../detail/DetailView.tsx";

/**
 * The room page's MEMBERS section: the list of agents in this room, each with the
 * role(s) they self-assigned. Derived in memory from the room log (folded once by
 * `useRoomState`). Extracted from the old Connect-tab room expansion.
 */
export default function RoomMembersSection(
  { members }: { members: DataRoomMember[] },
) {
  return (
    <Box>
      <SectionTitle>Members</SectionTitle>
      {members.length === 0
        ? (
          <Typography variant="body2" color="text.secondary">
            No members yet.
          </Typography>
        )
        : (
          <Box component="ul" sx={{ listStyle: "none", pl: 0, m: 0 }}>
            {members.map((m) => (
              <Box component="li" key={m.webId} sx={{ mb: 0.5 }}>
                <AgentLabel value={m.webId} /> —{" "}
                <Typography
                  component="span"
                  variant="caption"
                  color="text.secondary"
                >
                  {m.roles.map((role) => roleLabel(role)).join(", ") ||
                    "no role"}
                </Typography>
              </Box>
            ))}
          </Box>
        )}
    </Box>
  );
}
