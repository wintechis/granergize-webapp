import { Button } from "@mui/material";
import EditIcon from "@mui/icons-material/Edit";
import type { Building } from "../../types.ts";
import { msg } from "../../lib/messages.ts";

/**
 * The data-entry affordance in the observation (energy) page header: a button that opens
 * the INLINE energy-year editor on the page. The editor itself lives in `Energy.tsx`, which
 * owns the open state (seeded by the palette's `?action=enter-energy`); this button only
 * toggles it on. Self-hidden for a building shared *with* the user (read-only — no write
 * access to the owner's Pod resources).
 */
export default function EnergyEntryButton(
  { building, onEdit }: { building: Building; onEdit: () => void },
) {
  if (building.isShared) return null;
  return (
    <Button
      variant="outlined"
      size="small"
      startIcon={<EditIcon />}
      onClick={onEdit}
    >
      {msg("btnEditEnergyYears")}
    </Button>
  );
}
