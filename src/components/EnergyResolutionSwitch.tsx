import { type ReactNode, useState } from "react";
import { Stack, ToggleButton, ToggleButtonGroup } from "@mui/material";

export type EnergyResolution = "annual" | "series";

/**
 * Dispatch between the two temporal-resolution views of a building's energy
 * data. With only one kind present that view renders directly; with both, a
 * toggle lets the user switch. Annual is the default — the aggregates are
 * already bulk-loaded, while the series keeps its lazy load until selected.
 */
export default function EnergyResolutionSwitch(
  { annual, series }: { annual?: ReactNode; series?: ReactNode },
) {
  const [resolution, setResolution] = useState<EnergyResolution>("annual");
  if (annual == null || series == null) return <>{annual ?? series}</>;
  return (
    <Stack spacing={2}>
      <ToggleButtonGroup
        size="small"
        exclusive
        value={resolution}
        onChange={(_e, v: EnergyResolution | null) => v && setResolution(v)}
        aria-label="Energy data resolution"
        sx={{ alignSelf: "flex-start" }}
      >
        <ToggleButton value="annual">Annual</ToggleButton>
        <ToggleButton value="series">Time series</ToggleButton>
      </ToggleButtonGroup>
      {resolution === "annual" ? annual : series}
    </Stack>
  );
}
