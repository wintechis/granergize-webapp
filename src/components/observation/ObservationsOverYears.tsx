import { useMemo } from "react";
import Typography from "@mui/material/Typography";
import { type Building } from "../../types.ts";
import { type EnergyMetricKey } from "../../services/energy/energyDataset.ts";
import { DEFAULT_METRIC } from "../../services/energy/energyMetric.ts";
import { type EnergyByBuildingYear } from "../../services/energy/energyTimeCut.ts";
import { buildOverYears } from "../../services/energy/energyOverYears.ts";
import { annualMetricDesc } from "../../constants/annualMetrics.ts";
import { CHART_COLOR_PALETTE } from "../../constants/chartColors.ts";
import MetricLineChart from "../detail/MetricLineChart.tsx";
import { useT } from "../../context/I18nProvider.tsx";

/**
 * The Observations finder's **over-years** view: the selected metric's measured
 * figures across the reachable years, one line per building — the portfolio's
 * trajectories. Fact-first temporal: time is the x-axis, the building is a *series*
 * (not the unit), so trends and divergence read at a glance. Plots the RAW figures
 * (the facts themselves, e.g. kWh), not the per-m² intensity the heatmap/map band by.
 * Reuses the shared `MetricLineChart`; loading is the header indicator's job (CLAUDE.md).
 */
export default function ObservationsOverYears(
  { buildings, energyByYear, metric = DEFAULT_METRIC }: {
    buildings: Building[];
    energyByYear: EnergyByBuildingYear | undefined;
    metric?: EnergyMetricKey;
  },
) {
  const t = useT();
  const { years, data, lines } = useMemo(() => {
    const { years, data, series } = energyByYear
      ? buildOverYears(buildings, energyByYear, metric)
      : { years: [] as number[], data: [], series: [] };
    // Pair each building's series with a palette colour (the chrome's concern).
    const lines = series.map((s, i) => ({
      ...s,
      color: CHART_COLOR_PALETTE[i % CHART_COLOR_PALETTE.length],
    }));
    return { years, data, lines };
  }, [buildings, energyByYear, metric]);

  if (!energyByYear) {
    return <Typography variant="body2">{t("loadingEllipsis")}</Typography>;
  }
  if (years.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        {t("eyNoneYet")}
      </Typography>
    );
  }
  return (
    <MetricLineChart
      data={data}
      lines={lines}
      xKey="year"
      yUnit={annualMetricDesc(metric)?.unit ?? ""}
      height={360}
    />
  );
}
