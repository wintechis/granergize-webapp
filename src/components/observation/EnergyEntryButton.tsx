import { useState } from "react";
import { Button } from "@mui/material";
import EditIcon from "@mui/icons-material/Edit";
import type { BuildingType } from "../../types.ts";
import { getSession } from "../../hooks/session.ts";
import EnergyYearDialog from "../EnergyYearDialog.tsx";

/**
 * The data-entry affordance for the observation (energy) detail page: a button
 * that opens {@link EnergyYearDialog} to add / edit / delete a building's annual
 * energy years. This entry point lives ONLY on the full `/observation` detail —
 * the building page keeps energy minimal and links here for it.
 *
 * Only the building's owner can write its energy data, so the button renders
 * nothing for a building shared *with* the user (`isShared`). The write/delete
 * mutations, busy state and invalidations all live inside the dialog (and its
 * hooks); this component only owns the open/close state.
 *
 * The ⌘K palette routes the rich `SaveEnergyYear` verb here as
 * `/observation?action=enter-energy`; the page passes that through as
 * `autoOpen`, which SEEDS the open state in the initial `useState` (no
 * setState-in-effect, mirroring MasterDataSection/SharingSection). Closing calls
 * `onClosed` so the page can strip the `?action=` param.
 */
export default function EnergyEntryButton(
  { building, autoOpen, onClosed }: {
    building: BuildingType;
    /** Open the dialog on mount (the palette routed here `?action=enter-energy`). */
    autoOpen?: boolean;
    /** Called after the dialog closes (the page strips the `?action=` param). */
    onClosed?: () => void;
  },
) {
  // A building shared with the user is read-only here — no write access to the
  // owner's Pod resources; the seed is harmless either way (we return null).
  const [open, setOpen] = useState(
    () => autoOpen === true && !building.isShared,
  );
  if (building.isShared) return null;
  const close = () => {
    setOpen(false);
    onClosed?.();
  };
  return (
    <>
      <Button
        variant="outlined"
        size="small"
        startIcon={<EditIcon />}
        onClick={() => setOpen(true)}
      >
        Edit energy years
      </Button>
      {open && (
        <EnergyYearDialog
          open
          building={building}
          session={getSession()}
          onClose={close}
        />
      )}
    </>
  );
}
