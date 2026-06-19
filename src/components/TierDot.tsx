import Box from "@mui/material/Box";
import { type Tier, TIER_COLOR } from "../constants/tiers.ts";

/**
 * A small colour-coded dot for a source tier — mine = owned blue, shared = orange,
 * open = green, the SAME key the {@link import("./TierFilter.tsx").default} wears.
 * Shown beside a finder-list item so its tier reads at a glance without the label.
 */
export default function TierDot({ tier }: { tier: Tier }) {
  return (
    <Box
      component="span"
      aria-hidden
      sx={{
        display: "inline-block",
        width: 10,
        height: 10,
        borderRadius: "50%",
        backgroundColor: TIER_COLOR[tier],
        ml: 1,
        flexShrink: 0,
        verticalAlign: "middle",
      }}
    />
  );
}
