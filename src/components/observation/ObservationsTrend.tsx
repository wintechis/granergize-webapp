import { useMemo } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { type BuildingType } from "../../types.ts";
import { buildingDisplayName } from "../../lib/buildingDisplay.ts";
import { buildingRoute } from "../../routes.ts";
import { type EnergyMetricKey } from "../../services/rdf/energyDataset.ts";
import { DEFAULT_METRIC } from "../../services/energy/energyMetric.ts";
import { type EnergyByBuildingYear } from "../../services/energy/energyTimeCut.ts";
import {
  type EnergyTrend,
  trendForBuildings,
} from "../../services/energy/energyTrend.ts";
import {
  MARKER_NO_DATA_COLOR,
  TREND_FLAT_COLOR,
  TREND_IMPROVING_COLOR,
  TREND_WORSENING_COLOR,
} from "../../constants/chartColors.ts";
import { type MessageId } from "../../lib/messages.ts";
import ResourceRow from "../ResourceRow.tsx";
import { RefLink } from "../detail/DetailView.tsx";
import { useT } from "../../context/I18nProvider.tsx";

/** Trend → its colour (the colourblind-safe diverging palette) + i18n label key. */
const TREND_META: Record<EnergyTrend, { color: string; label: MessageId }> = {
  improving: { color: TREND_IMPROVING_COLOR, label: "trendImproving" },
  flat: { color: TREND_FLAT_COLOR, label: "trendFlat" },
  worsening: { color: TREND_WORSENING_COLOR, label: "trendWorsening" },
  unknown: { color: MARKER_NO_DATA_COLOR, label: "trendUnknown" },
};

/**
 * The Observations finder's **trend** view: one row per building flagged by its
 * year-over-year direction on the selected metric (improving / flat / worsening, or
 * unknown without two comparable years). A pure render over `trendForBuildings` (the
 * unit-tested distiller) and the same `EnergyByBuildingYear` cube the map + heatmap
 * use — so a building's trend reads on the same intensity. Each row navigates to
 * `/building/:id` (the finder's navigation loop). Loading is the header indicator's
 * job (CLAUDE.md): a plain "Loading…" line while the cube is in flight.
 */
export default function ObservationsTrend(
  { buildings, energyByYear, metric = DEFAULT_METRIC }: {
    buildings: BuildingType[];
    energyByYear: EnergyByBuildingYear | undefined;
    metric?: EnergyMetricKey;
  },
) {
  const t = useT();
  const trends = useMemo(
    () => (energyByYear ? trendForBuildings(buildings, energyByYear, metric) : null),
    [buildings, energyByYear, metric],
  );

  if (!trends) {
    return <Typography variant="body2">{t("loadingEllipsis")}</Typography>;
  }
  return (
    <Box component="ul" sx={{ listStyle: "none", pl: 0, m: 0 }}>
      {buildings.map((b) => {
        const meta = TREND_META[trends.get(b.id) ?? "unknown"];
        return (
          <ResourceRow
            key={b.uri}
            title={
              <RefLink to={buildingRoute(b.id)}>{buildingDisplayName(b)}</RefLink>
            }
            actions={
              <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
                <Box
                  sx={{
                    width: 10,
                    height: 10,
                    borderRadius: "50%",
                    backgroundColor: meta.color,
                    flexShrink: 0,
                  }}
                />
                <Typography variant="body2" color="text.secondary">
                  {t(meta.label)}
                </Typography>
              </Box>
            }
          />
        );
      })}
    </Box>
  );
}
