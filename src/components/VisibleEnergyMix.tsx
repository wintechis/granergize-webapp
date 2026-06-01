import { Box, Paper, Typography } from "@mui/material";
import type { BuildingType, EnergyType } from "../../types/types.ts";

/** camelCase energy-source key → human-readable label. */
function humanize(key: string): string {
  const spaced = key.replace(/([a-z])([A-Z])/g, "$1 $2");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

interface VisibleEnergyMixProps {
  /** Buildings currently inside the map's bounding box. */
  buildings: BuildingType[];
  /** All loaded per-building energy data, matched to buildings by `id`. */
  energyNeed: EnergyType[];
}

/**
 * Energy mix aggregated over the buildings currently visible in the map's
 * bounding box. Sums each energy-need source across those visible buildings
 * that have loaded energy data, so it recomputes as the map is panned/zoomed.
 */
export default function VisibleEnergyMix(
  { buildings, energyNeed }: VisibleEnergyMixProps,
) {
  const totals: Record<string, number> = {};
  let withData = 0;
  for (const b of buildings) {
    const energy = energyNeed.find((e) => e.id === b.id);
    if (!energy) continue;
    withData++;
    for (const [key, value] of Object.entries(energy.energyNeed)) {
      if (typeof value === "number" && !Number.isNaN(value)) {
        totals[key] = (totals[key] ?? 0) + value;
      }
    }
  }

  const rows = Object.entries(totals).sort((a, b) => b[1] - a[1]);
  const total = rows.reduce((sum, [, value]) => sum + value, 0);

  return (
    <Paper variant="outlined" sx={{ mt: 2, px: 1.5, py: 1 }}>
      <Typography variant="h6">
        Energy mix — visible area
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
        {buildings.length} building{buildings.length === 1 ? "" : "s"} in view
        {withData < buildings.length && `, ${withData} with energy data`}
      </Typography>
      {rows.length === 0
        ? (
          <Typography variant="body2" color="text.secondary">
            No energy data in view.
          </Typography>
        )
        : (
          <Box
            component="table"
            sx={{
              width: "100%",
              borderCollapse: "collapse",
              "& td": { py: 0.25, verticalAlign: "baseline" },
            }}
          >
            <tbody>
              {rows.map(([key, value]) => (
                <tr key={key}>
                  <td>
                    <Typography variant="body2">{humanize(key)}</Typography>
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <Typography variant="body2">
                      {value.toLocaleString()}{" "}
                      ({total ? Math.round((value / total) * 100) : 0}%)
                    </Typography>
                  </td>
                </tr>
              ))}
            </tbody>
          </Box>
        )}
    </Paper>
  );
}
