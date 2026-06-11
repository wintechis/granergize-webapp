import { Box, Typography } from "@mui/material";
import type { BuildingType } from "../types.ts";
import {
  buildingAddressLine,
  buildingDisplayName,
} from "../lib/buildingDisplay.ts";

/**
 * A dialog header that names the building it acts on — `<action> — <name>` with the
 * address beneath. Reused by every per-building dialog so they identify their subject
 * the same way (the "one widget vocabulary" convention), e.g. so the user doesn't lose
 * track of which building they're entering energy for (heike-3 #4).
 */
export function BuildingDialogTitle(
  { building, action }: { building: BuildingType; action: string },
) {
  const name = buildingDisplayName(building);
  const addr = buildingAddressLine(building);
  return (
    <Box>
      <Typography variant="h6" component="span" sx={{ display: "block" }}>
        {action} — {name}
      </Typography>
      {/* When the name already IS the street address (no label/code set), the
          address line would just repeat it — show it only when it adds info. */}
      {addr && addr !== name && !addr.startsWith(`${name},`) && (
        <Typography variant="body2" color="text.secondary">
          {addr}
        </Typography>
      )}
    </Box>
  );
}
