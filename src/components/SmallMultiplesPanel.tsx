import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { BuildingType } from "../types.ts";
import { buildingDisplayName } from "../lib/buildingDisplay.ts";
import { buildingRoute } from "../routes.ts";
import { useT } from "../context/I18nProvider.tsx";
import { type EnergyMetricKey } from "../services/rdf/energyDataset.ts";
import { DEFAULT_METRIC, type MetricFraming } from "../services/energy/energyMetric.ts";
import {
  barFraction,
  buildSmallMultiples,
  type PanelBuilding,
  type SharedScale,
} from "../services/energy/energySmallMultiples.ts";
import { type EnergyByBuildingYear } from "../services/energy/energyTimeCut.ts";
import { bandColor } from "../constants/lensBand.ts";
import { ellipsis } from "../constants/listStyles.ts";

/**
 * The **small-multiples "compare years" view** (Step 4 of `plans/plan-cube-ui.md`):
 * one compact mini-panel per year, laid out side by side, so several years' building
 * sets are seen at once (the time-juxtaposing guise). Each mini-panel renders the
 * visible building set as a short list of per-building bars — bar length and colour
 * read against the SAME cross-year scale (`buildSmallMultiples`), so a building the
 * same colour/length in two panels really has comparable intensity.
 *
 * A pure render over the unit-tested `buildSmallMultiples` and the same
 * `EnergyByBuildingYear` cube the map's energy lens loads. A bar click leaves for
 * `/building/:id` (the finder hands off to the detail page). The tier colours reuse
 * the map energy-lens palette so the two surfaces read in step.
 *
 * Loading is the header indicator's job (CLAUDE.md): a plain "Loading…" / empty-state
 * line while the cube is in flight or empty — no component spinner.
 */

const PANEL_WIDTH = 200;
const ROW_HEIGHT = 16;

function PanelRow(
  { pb, year, scale, framing, noDataLabel }: {
    pb: PanelBuilding;
    year: number;
    scale: SharedScale | null;
    framing: MetricFraming;
    noDataLabel: string;
  },
) {
  const navigate = useNavigate();
  const has = pb.value != null;
  const name = buildingDisplayName(pb.building);
  const unit = framing === "magnitude" ? "kWh" : "kWh/m²/a";
  const title = has
    ? `${name} — ${year}: ${Math.round(pb.value!)} ${unit}`
    : `${name} — ${year}: ${noDataLabel}`;
  const open = () => void navigate(buildingRoute(pb.building.id));
  return (
    <Tooltip title={title} arrow placement="right">
      <Box
        role="button"
        tabIndex={0}
        aria-label={title}
        onClick={open}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            open();
          }
        }}
        sx={{
          height: ROW_HEIGHT,
          borderRadius: 0.5,
          cursor: "pointer",
          backgroundColor: "action.hover",
          overflow: "hidden",
          position: "relative",
          "&:focus-visible": {
            outline: "2px solid",
            outlineColor: "primary.main",
            outlineOffset: 1,
          },
        }}
      >
        <Box
          sx={{
            height: "100%",
            width: `${barFraction(pb.value, scale) * 100}%`,
            minWidth: has ? 3 : 0,
            backgroundColor: bandColor(pb.band, framing),
          }}
        />
      </Box>
    </Tooltip>
  );
}

interface SmallMultiplesPanelProps {
  buildings: BuildingType[];
  /** The per-building annual cube (from `useAnnualEnergyByYear`). */
  energyByYear: EnergyByBuildingYear | undefined;
  /** Ids the shared scale is pooled over (the visible set). */
  visibleIds: ReadonlySet<string>;
  /** The selected observed property (the cube's measure axis). */
  metric?: EnergyMetricKey;
}

export default function SmallMultiplesPanel(
  { buildings, energyByYear, visibleIds, metric = DEFAULT_METRIC }:
    SmallMultiplesPanelProps,
) {
  const t = useT();
  const sm = useMemo(
    () =>
      energyByYear
        ? buildSmallMultiples(buildings, energyByYear, visibleIds, metric)
        : null,
    [buildings, energyByYear, visibleIds, metric],
  );

  if (!sm) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
        {t("loadingEllipsis")}
      </Typography>
    );
  }
  if (sm.panels.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
        {t("compareYearsEmpty")}
      </Typography>
    );
  }

  return (
    <Box sx={{ overflow: "auto", maxHeight: "100%", p: 1 }}>
      <Box sx={{ display: "flex", gap: 2, alignItems: "flex-start" }}>
        {sm.panels.map((panel) => (
          <Paper
            key={panel.year}
            variant="outlined"
            sx={{ p: 1.5, width: PANEL_WIDTH, flexShrink: 0 }}
          >
            <Typography variant="h6" sx={{ mb: 1 }}>
              {panel.year}
            </Typography>
            <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
              {panel.buildings.map((pb) => (
                <Box key={pb.building.id}>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    title={buildingDisplayName(pb.building)}
                    sx={{ ...ellipsis, display: "block" }}
                  >
                    {buildingDisplayName(pb.building)}
                  </Typography>
                  <PanelRow
                    pb={pb}
                    year={panel.year}
                    scale={sm.scale}
                    framing={sm.framing}
                    noDataLabel={t("lensBandNoData")}
                  />
                </Box>
              ))}
            </Box>
          </Paper>
        ))}
      </Box>
    </Box>
  );
}
