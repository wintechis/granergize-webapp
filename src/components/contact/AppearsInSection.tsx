import { msg } from "../../lib/messages.ts";
import { Box, Typography } from "@mui/material";
import { useSolidData } from "../../hooks/queries.ts";
import { DetailRow, RefLink, SectionTitle } from "../detail/DetailView.tsx";
import { appearancesOf } from "../../services/agents/agentAppearances.ts";
import { buildingDisplayName } from "../../lib/buildingDisplay.ts";
import { buildingRoute } from "../../routes.ts";

/**
 * The buildings visible to the user that reference this agent, grouped by the
 * role(s) the agent plays on each (operatedBy / ownedBy / investor /
 * attributedTo / …), each linking to its building page.
 */
export default function AppearsInSection({ webId }: { webId: string }) {
  const { buildings, isLoading } = useSolidData();
  const appearances = appearancesOf(webId, buildings);
  return (
    <Box>
      <SectionTitle divider>{msg("secAppearsIn")}</SectionTitle>
      {isLoading ? <Typography>{msg("loadingEllipsis")}</Typography> : (
        appearances.length === 0
          ? (
            <Typography color="text.secondary">
              Not referenced by any building you can see.
            </Typography>
          )
          : (
            appearances.map(({ building, roles }) => (
              <DetailRow
                key={building.id}
                label={roles.join(", ")}
                value={
                  <RefLink to={buildingRoute(building.id)}>
                    {buildingDisplayName(building)}
                  </RefLink>
                }
                dense
              />
            ))
          )
      )}
    </Box>
  );
}
