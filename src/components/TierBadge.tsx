import { Stack, Typography } from "@mui/material";
import { type Tier, TIER_LABEL } from "../constants/tiers.ts";
import { msg } from "../lib/messages.ts";
import TierDot from "./TierDot.tsx";

/**
 * The labelled tier indicator — the {@link TierDot} colour atom plus the tier's
 * label ("Mine" / "Shared with me" / "Open data"). One ownership/tier vocabulary
 * across the app: finder rows wear the bare dot, detail surfaces wear the dot +
 * label, both drawn from the same `Tier` / `TIER_COLOR` / `TIER_LABEL` source (so a
 * building's "Mine" on its page is the same blue circle as its row).
 */
export default function TierBadge({ tier }: { tier: Tier }) {
  return (
    <Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
      <TierDot tier={tier} />
      <Typography variant="body2" color="text.secondary">
        {msg(TIER_LABEL[tier])}
      </Typography>
    </Stack>
  );
}
