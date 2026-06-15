import { Box, Chip, Stack, Typography } from "@mui/material";
import ElectricBoltIcon from "@mui/icons-material/ElectricBolt";
import type { BuildingType } from "../../types.ts";
import { buildingDisplayName } from "../../lib/buildingDisplay.ts";
import { BackLink } from "../detail/DetailView.tsx";
import EnergyEntryButton from "./EnergyEntryButton.tsx";

/**
 * The observation (energy) page's header, matching the building/contact/
 * aggregation/room detail headers: a back link, the building's name + an
 * owned/shared badge (energy belongs to its building, so the page is titled by
 * it), the year the annual view is showing, and — for an owned building — the
 * "Edit energy years" action (the one place energy is entered; self-hidden for a
 * building shared with the user, which is read-only).
 */
export default function ObservationHeader(
  { building, year }: { building: BuildingType; year?: number },
) {
  const shared = building.isShared ?? false;
  return (
    <Box>
      <Box sx={{ mb: 1 }}>
        <BackLink />
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
            <Chip
              size="small"
              label={shared ? "Shared with you" : "Owned"}
              color={shared ? "warning" : "primary"}
              variant="outlined"
            />
          </Stack>
          <Typography variant="body2" color="text.secondary">
            Energy{year ? ` · latest year ${year}` : ""}
          </Typography>
        </Box>
        {!shared && (
          <Box sx={{ flexShrink: 0 }}>
            <EnergyEntryButton building={building} />
          </Box>
        )}
      </Stack>
    </Box>
  );
}
