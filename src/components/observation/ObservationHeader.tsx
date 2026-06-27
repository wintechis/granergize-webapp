import { Box, Stack, Typography } from "@mui/material";
import ElectricBoltIcon from "@mui/icons-material/ElectricBolt";
import type { Building } from "../../types.ts";
import { buildingDisplayName } from "../../lib/buildingDisplay.ts";
import { buildingRoute, FINDERS } from "../../routes.ts";
import { BackLink, RefLink } from "../detail/DetailView.tsx";
import EnergyEntryButton from "./EnergyEntryButton.tsx";

/**
 * The observation (energy) page's header. The observations are kept **independent of
 * the building**: the page is identified by the building's name but does NOT inherit
 * its owned/shared badge — instead it LINKS to the building's own page. Carries a
 * back link, the latest annual year, and — for a building the user owns — the "Edit
 * energy years" action (the one place energy is entered; self-hidden for a
 * shared/read-only building).
 */
export default function ObservationHeader(
  { building, year, onEdit }: {
    building: Building;
    year?: number;
    /** Open the inline energy-year editor (which lives on the page — `Energy.tsx`). */
    onEdit: () => void;
  },
) {
  const shared = building.isShared ?? false;
  return (
    <Box>
      <Box sx={{ mb: 1 }}>
        <BackLink fallback={FINDERS.observations} />
      </Box>
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={2}
        sx={{ alignItems: "flex-start", justifyContent: "space-between" }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Stack
            direction="row"
            spacing={1}
            sx={{ alignItems: "center", mb: 0.5 }}
          >
            <ElectricBoltIcon color="action" />
            <Typography variant="h5">{buildingDisplayName(building)}</Typography>
          </Stack>
          <Typography variant="body2" color="text.secondary">
            Energy{year ? ` · latest year ${year}` : ""}
          </Typography>
          {/* The observations link OUT to the building rather than inheriting its
              owned/shared identity — keeping the energy view independent. */}
          <Typography variant="body2" sx={{ mt: 0.5 }}>
            <RefLink to={buildingRoute(building.id)}>Building details</RefLink>
          </Typography>
        </Box>
        {!shared && (
          <Box sx={{ flexShrink: 0 }}>
            <EnergyEntryButton building={building} onEdit={onEdit} />
          </Box>
        )}
      </Stack>
    </Box>
  );
}
