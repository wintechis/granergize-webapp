import { Box, Typography } from "@mui/material";
import type { BuildingType } from "../types.ts";

/** A building's display name: its label, else its code, else "Building <id>". */
function buildingDisplayName(b: BuildingType): string {
  return b.label || b.buildingCode || `Building ${b.id}`;
}

/** One-line address ("Street, 12345 City"), omitting the parts that are unset. */
function buildingAddressLine(b: BuildingType): string {
  const cityLine = [b.postalCode, b.locality].filter(Boolean).join(" ");
  return [b.streetAddress, cityLine].filter(Boolean).join(", ");
}

/**
 * A dialog header that names the building it acts on — `<action> — <name>` with the
 * address beneath. Reused by every per-building dialog so they identify their subject
 * the same way (the "one widget vocabulary" convention), e.g. so the user doesn't lose
 * track of which building they're entering energy for (heike-3 #4).
 */
export function BuildingDialogTitle(
  { building, action }: { building: BuildingType; action: string },
) {
  const addr = buildingAddressLine(building);
  return (
    <Box>
      <Typography variant="h6" component="span" sx={{ display: "block" }}>
        {action} — {buildingDisplayName(building)}
      </Typography>
      {addr && (
        <Typography variant="body2" color="text.secondary">
          {addr}
        </Typography>
      )}
    </Box>
  );
}
