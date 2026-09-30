import { msg } from "../lib/messages.ts";
import { buildingDisplayName } from "../lib/buildingDisplay.ts";
import React from "react";
import {
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import ElectricBoltIcon from "@mui/icons-material/ElectricBolt";
import LocalFireDepartmentIcon from "@mui/icons-material/LocalFireDepartment";
import WaterDropIcon from "@mui/icons-material/WaterDrop";
import { AnnualData, Building, type TechnicalSystem } from "../types.ts";
import { systemKindLabel, systemValueLine } from "../lib/systemDisplay.ts";
import {
  ChartBox,
  DetailCard,
  SectionTitle,
} from "../components/detail/DetailView.tsx";
import MetricBarChart from "../components/detail/MetricBarChart.tsx";
import { AgentLabel } from "../components/AgentLabel.tsx";
import {
  useAnnualEnergy,
  useReceivedBenchmarks,
  useSolidData,
} from "../hooks/queries.ts";
import { pickBenchmark } from "../services/aggregation/benchmarkSelector.ts";
import { formatNumber } from "../lib/formatNumber.ts";
import {
  type AnnualMetricDesc,
  ANNUAL_METRICS,
  metricLabel,
} from "../constants/annualMetrics.ts";
import {
  ENERGY_METRICS,
  type EnergyMetricKey,
} from "../services/energy/energyDataset.ts";
import { fromCanonical, unitLabel } from "../services/energy/units.ts";
import {
  ELECTRICITY_COLOR,
  HEAT_COLOR,
  PLANNED_COLOR,
  GENERATION_COLOR,
  RENEWABLE_COLOR,
  WASTEWATER_COLOR,
  WATER_COLOR,
} from "../constants/chartColors.ts";

interface AnnualEnergyProps {
  building: Building;
}

const METRIC_COLORS: Record<EnergyMetricKey, string> = {
  electricityConsumption: ELECTRICITY_COLOR,
  heatConsumption: HEAT_COLOR,
  waterConsumption: WATER_COLOR,
  wastewaterConsumption: WASTEWATER_COLOR,
  renewableSelfGeneratedShare: RENEWABLE_COLOR,
  electricityGeneration: GENERATION_COLOR,
};

const METRIC_ICONS: Partial<Record<EnergyMetricKey, React.ReactElement>> = {
  electricityConsumption: <ElectricBoltIcon fontSize="small" />,
  heatConsumption: <LocalFireDepartmentIcon fontSize="small" />,
  waterConsumption: <WaterDropIcon fontSize="small" />,
  wastewaterConsumption: <WaterDropIcon fontSize="small" />,
};

/** Column-header form: "Electricity (kWh)" / "Renewable %" (unit already in the
 * "%" abbreviation). `unit` is the building's display unit for this metric (canonical,
 * e.g. "kWh", or its own "MWh"). */
const headerOf = (m: AnnualMetricDesc, unit: string) =>
  unit === "%" ? msg(m.shortId) : `${msg(m.shortId)} (${unit})`;

/** Chart-section title from the vocab full label + unit: "Electricity
 * consumption (kWh/year)" / "Renewable self-generated share (%)". */
const chartTitleOf = (m: AnnualMetricDesc, unit: string) =>
  `${metricLabel(m.key)} (${unit === "%" ? "%" : msg("aePerYear", { unit })})`;

class ChartErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[AnnualEnergy] chart render error:", error, info);
  }
  render() {
    if (this.state.error) {
      return (
        <Typography color="error">
          {msg("aeChartError", { message: this.state.error.message })}
        </Typography>
      );
    }
    return this.props.children;
  }
}

/**
 * The detail pane's annual-energy view — ONE component for every building with
 * annual (non-series) datasets, replacing the role-named Investor/Bsp pair.
 * Everything it shows derives from the data present: metric columns and charts
 * come from `ANNUAL_METRICS` filtered to what the years (or the operator average)
 * actually carry. Building master data is NOT shown here — it lives on the building
 * page; the observation header links back (building info on the building, observation
 * info on the observation).
 */
export default function AnnualEnergy({ building }: AnnualEnergyProps) {
  // Annual figures are separate cons:EnergyDataset resources, read through the
  // data layer (cached, fingerprint-keyed — see useAnnualEnergy).
  const annual = useAnnualEnergy(building);
  const actual = annual.data?.actual ?? [];
  const planned = annual.data?.planned ?? [];
  // This building's own (non-canonical) unit per metric, when it has one — the figures
  // stay canonical, so the table/chart convert to + label with the building's unit.
  const units = annual.data?.units ?? {};
  const displayUnit = (m: AnnualMetricDesc): string =>
    units[m.key] ? unitLabel(units[m.key]!) : m.unit;
  const toDisplay = (m: AnnualMetricDesc, v: number | undefined) =>
    v == null || !units[m.key]
      ? v
      : fromCanonical(v, units[m.key]!, ENERGY_METRICS[m.key].unit);
  // The Betreiber-Durchschnitt (heike-4): per-metric mean across all buildings
  // sharing this building's operator (`operatedBy`), each contributing its
  // latest actual year (computed in loadEnergy; keyed by the canonical metric
  // keys `electricityConsumption`/… — same as the per-year data and the metric
  // schema). Empty when no operator is set or no peer carries annual figures.
  const { operatorAverages, portfolioAverages } = useSolidData();
  const operatorAvg =
    (typeof building.operatedBy === "string" &&
      operatorAverages[building.operatedBy]) || {};
  const hasOperatorAvg = Object.keys(operatorAvg).length > 0;
  // The portfolio mean (across the user's OWN buildings) and the received-BSP
  // benchmark, shown as two more comparison rows beneath the operator average —
  // the same comparison figures the page's old per-metric grid carried, folded
  // into this single annual table so there is ONE annual view.
  const hasPortfolio = Object.values(portfolioAverages).some((v) => v > 0);
  const { data: benchmarks = [] } = useReceivedBenchmarks();
  // Distinct BSPs behind the received benchmarks, for the provenance caption.
  const benchmarkProviders = [
    ...new Set(
      benchmarks.map((b) => b.computedBy).filter((w): w is string =>
        Boolean(w)
      ),
    ),
  ];

  if (annual.isLoading) {
    return <Typography color="text.secondary">Loading…</Typography>;
  }

  const actualByYear = new Map(actual.map((d) => [d.year, d]));
  const plannedByYear = new Map(planned.map((d) => [d.year, d]));
  const yearsNum = [...new Set([...actual, ...planned].map((d) => d.year))]
    .sort((a, b) => a - b);
  const hasPlanned = planned.length > 0;

  // The metrics this building's data actually carries (schema order keeps
  // electricity first); columns, cells and charts all derive from this.
  const visibleMetrics = ANNUAL_METRICS.filter((m) =>
    [...actual, ...planned].some((d) => d[m.key] != null) ||
    operatorAvg[m.key] != null
  );

  // The building's PRODUCING systems (PV, CHP) — building-level generation is
  // their output, so the generation chart names them (the same kind + description
  // line the building page's system rows and the per-unit tables use).
  const producingSystems = ((building.systems ?? []) as TechnicalSystem[])
    .filter((s) => s.kind === "pv" || s.kind === "chp");

  // A benchmark is shown only when a received BSP snapshot covers at least one
  // visible metric (mirrors hasOperatorAvg's gating).
  const benchmarkFor = (key: string) => pickBenchmark(benchmarks, key)?.value;
  const hasBenchmark = visibleMetrics.some((m) =>
    benchmarkFor(m.key) != null
  );

  /** One metric → a row-per-year `[{ year, actual?, planned? }]` for Recharts.
   * A missing figure stays ABSENT (a gap), not a fabricated 0-height bar —
   * "no data" and "zero consumption" must stay distinguishable. */
  const metricData = (get: (d: AnnualData) => number | undefined) =>
    yearsNum.map((y) => {
      const a = actualByYear.get(y);
      const p = plannedByYear.get(y);
      const actualV = a ? get(a) : undefined;
      const plannedV = p ? get(p) : undefined;
      return {
        year: String(y),
        ...(actualV != null ? { actual: actualV } : {}),
        ...(hasPlanned && plannedV != null ? { planned: plannedV } : {}),
      };
    });
  /** Actual + (when present) the planned/Soll comparison bar for a metric. */
  const metricBars = (label: string, color: string) => [
    { key: "actual", name: label, color },
    ...(hasPlanned
      ? [{ key: "planned", name: `${label} ${msg("aePlannedSuffix")}`, color: PLANNED_COLOR }]
      : []),
  ];

  const cells = (d: AnnualData) =>
    visibleMetrics.map((m) => (
      <TableCell key={m.key} align="right">
        {d[m.key] != null
          ? formatNumber(toDisplay(m, d[m.key]) as number, m.decimals)
          : "—"}
      </TableCell>
    ));

  return (
    <ChartErrorBoundary>
      <DetailCard
        icon={<ElectricBoltIcon />}
        title={msg("aeTitle", { name: buildingDisplayName(building) })}
        spacing={2}
      >
        {yearsNum.length === 0
          ? (
            <Typography color="text.secondary">
              {msg("aeNoAnnualData")}
            </Typography>
          )
          : (
            <>
              {/* Summary table */}
              <TableContainer component={Paper} variant="outlined">
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>
                        <strong>{msg("lblYear")}</strong>
                      </TableCell>
                      {visibleMetrics.map((m) => (
                        <TableCell key={m.key} align="right">
                          <strong>{headerOf(m, displayUnit(m))}</strong>
                        </TableCell>
                      ))}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {/* One row per actual year, plus a secondary "(planned)"
                        row when Soll figures exist — table and chart agree on
                        the scenario dimension, and a planned-only year is not
                        invisible. */}
                    {yearsNum.flatMap((y) => {
                      const a = actualByYear.get(y);
                      const p = plannedByYear.get(y);
                      return [
                        a && (
                          <TableRow hover key={y}>
                            <TableCell>{y}</TableCell>
                            {cells(a)}
                          </TableRow>
                        ),
                        p && (
                          <TableRow hover key={`${y}-planned`}>
                            <TableCell sx={{ color: "text.secondary" }}>
                              {y} {msg("aePlannedSuffix")}
                            </TableCell>
                            {cells(p)}
                          </TableRow>
                        ),
                      ].filter(Boolean);
                    })}
                    {hasOperatorAvg && (
                      <TableRow>
                        <TableCell>
                          <strong>{msg("aeOperatorAvg")}</strong>
                        </TableCell>
                        {/* The carrier keys are the consumption metrics' schema
                            labels; the renewable share is a ratio and stays out
                            of the operator aggregation. */}
                        {visibleMetrics.map((m) => (
                          <TableCell key={m.key} align="right">
                            {operatorAvg[m.key] != null
                              ? formatNumber(operatorAvg[m.key], m.decimals)
                              : "—"}
                          </TableCell>
                        ))}
                      </TableRow>
                    )}
                    {hasPortfolio && (
                      <TableRow>
                        <TableCell>
                          <strong>{msg("aePortfolioAvg")}</strong>
                        </TableCell>
                        {visibleMetrics.map((m) => (
                          <TableCell key={m.key} align="right">
                            {portfolioAverages[m.key] != null &&
                                portfolioAverages[m.key] > 0
                              ? formatNumber(portfolioAverages[m.key], m.decimals)
                              : "—"}
                          </TableCell>
                        ))}
                      </TableRow>
                    )}
                    {hasBenchmark && (
                      <TableRow>
                        <TableCell>
                          <strong>{msg("aeBenchmark")}</strong>
                        </TableCell>
                        {visibleMetrics.map((m) => {
                          const b = benchmarkFor(m.key);
                          return (
                            <TableCell key={m.key} align="right">
                              {b != null ? formatNumber(b, m.decimals) : "—"}
                            </TableCell>
                          );
                        })}
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
              {hasOperatorAvg && (
                <Typography variant="body2" color="text.secondary">
                  {msg("aeOperatorAvgNote")}
                </Typography>
              )}
              {hasPortfolio && (
                <Typography variant="body2" color="text.secondary">
                  {msg("aePortfolioAvgNote")}
                </Typography>
              )}
              {benchmarkProviders.length > 0 && (
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    flexWrap: "wrap",
                    gap: 0.5,
                  }}
                >
                  {msg("aeBenchmarkProvidedBy")}{" "}
                  {benchmarkProviders.map((webId) => (
                    <AgentLabel key={webId} value={webId} />
                  ))}
                </Typography>
              )}

              {/* One chart per metric the years carry. */}
              {visibleMetrics
                .filter((m) =>
                  [...actual, ...planned].some((d) => d[m.key] != null)
                )
                .map((m) => (
                  <React.Fragment key={m.key}>
                    <SectionTitle divider icon={METRIC_ICONS[m.key]}>
                      {chartTitleOf(m, displayUnit(m))}
                    </SectionTitle>
                    {m.key === "electricityGeneration" &&
                      producingSystems.length > 0 && (
                      <Typography variant="body2" color="text.secondary">
                        {msg("aeGeneratedBy")}:{" "}
                        {producingSystems
                          .map((s) =>
                            `${systemKindLabel(s.kind)}: ${systemValueLine(s)}`
                          )
                          .join(" — ")}
                      </Typography>
                    )}
                    <ChartBox>
                      <MetricBarChart
                        data={metricData((d) => toDisplay(m, d[m.key]))}
                        bars={metricBars(
                          headerOf(m, displayUnit(m)),
                          METRIC_COLORS[m.key],
                        )}
                        yUnit={displayUnit(m)}
                      />
                    </ChartBox>
                  </React.Fragment>
                ))}
            </>
          )}
      </DetailCard>
    </ChartErrorBoundary>
  );
}
