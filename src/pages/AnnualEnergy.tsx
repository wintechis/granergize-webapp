import { msg } from "../lib/messages.ts";
import { buildingDisplayName } from "../lib/buildingDisplay.ts";
import React from "react";
import {
  Chip,
  Paper,
  Stack,
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
import SolarPowerIcon from "@mui/icons-material/SolarPower";
import BatteryChargingFullIcon from "@mui/icons-material/BatteryChargingFull";
import WorkspacePremiumIcon from "@mui/icons-material/WorkspacePremium";
import {
  AnnualData,
  BuildingType,
  InvestorCertification,
  type SystemKind,
  type TechnicalSystem,
} from "../types.ts";
import {
  ChartBox,
  DetailCard,
  DetailRow,
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
import type { EnergyMetricKey } from "../services/rdf/energyDataset.ts";
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
  building: BuildingType;
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
 * "%" abbreviation). The compact label is a catalog id; the unit stays as-is. */
const headerOf = (m: AnnualMetricDesc) =>
  m.unit === "%" ? msg(m.shortId) : `${msg(m.shortId)} (${m.unit})`;

/** Chart-section title from the vocab full label + unit: "Electricity
 * consumption (kWh/year)" / "Renewable self-generated share (%)". */
const chartTitleOf = (m: AnnualMetricDesc) =>
  `${metricLabel(m.key)} (${m.unit === "%" ? "%" : `${m.unit}/year`})`;

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
          Chart error: {this.state.error.message}
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
 * come from `ANNUAL_METRICS` filtered to what the years (or the operator
 * average) actually carry, and the master-data block renders whichever of its
 * fields the building has.
 */
/** Master-data row label for an energy unit. */
const systemRowLabel = (kind: SystemKind): string =>
  kind === "battery"
    ? "Battery storage"
    : kind === "chp"
    ? "Cogeneration (CHP)"
    : "PV System";

/** Master-data row icon for an energy unit. */
const systemRowIcon = (kind: SystemKind) =>
  kind === "battery"
    ? <BatteryChargingFullIcon />
    : kind === "chp"
    ? <LocalFireDepartmentIcon />
    : <SolarPowerIcon />;

/** "Yes (750 kW el, 126 kW th, since 2018)" — the unit's capacities + year. */
const systemChipLabel = (s: TechnicalSystem): string => {
  const p: string[] = [];
  if (s.capacityKW != null) {
    p.push(`${formatNumber(s.capacityKW, 1)} kW${s.kind === "chp" ? " el" : ""}`);
  }
  if (s.storageCapacityKWh != null) p.push(`${formatNumber(s.storageCapacityKWh, 1)} kWh`);
  if (s.thermalCapacityKW != null) p.push(`${formatNumber(s.thermalCapacityKW, 1)} kW th`);
  if (s.commissioningYear != null) p.push(`since ${s.commissioningYear}`);
  return p.length ? `Yes (${p.join(", ")})` : "Yes";
};

export default function AnnualEnergy({ building }: AnnualEnergyProps) {
  // Annual figures are separate cons:EnergyDataset resources, read through the
  // data layer (cached, fingerprint-keyed — see useAnnualEnergy).
  const annual = useAnnualEnergy(building);
  const actual = annual.data?.actual ?? [];
  const planned = annual.data?.planned ?? [];
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

  // Master data shown above the table — whichever fields this building carries
  // (one generic building shape; the block is not tied to any producer kind).
  const companyName = building.companyName as string | undefined;
  const logisticsFunction = building.logisticsFunction as string | undefined;
  const climateControlType = building.climateControlType as string | undefined;
  const greenLeaseShare = building.greenLeaseShare as number | undefined;
  const tenancyType = building.tenancyType as string | undefined;
  const numberOfLoadingDocks = building.numberOfLoadingDocks as
    | number
    | undefined;
  const systems = (building.systems ?? []) as TechnicalSystem[];
  const certifications =
    (building.certifications ?? []) as InvestorCertification[];
  const leaseType = building.leaseType as string | undefined;
  const tenantIndustry = building.tenantIndustry as string | undefined;
  const indoorTemperatureClass = building.indoorTemperatureClass as
    | string
    | undefined;
  const hasMasterData = Boolean(
    climateControlType || tenancyType || leaseType || tenantIndustry ||
      indoorTemperatureClass || numberOfLoadingDocks != null ||
      greenLeaseShare != null || systems.length > 0 ||
      certifications.length > 0,
  );

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
      ? [{ key: "planned", name: `${label} (planned)`, color: PLANNED_COLOR }]
      : []),
  ];

  const cells = (d: AnnualData) =>
    visibleMetrics.map((m) => (
      <TableCell key={m.key} align="right">
        {d[m.key] != null ? formatNumber(d[m.key] as number, m.decimals) : "—"}
      </TableCell>
    ));

  return (
    <ChartErrorBoundary>
      <DetailCard
        icon={<ElectricBoltIcon />}
        title={`Annual Energy and Water — ${buildingDisplayName(building)}`}
        subheader={[companyName, logisticsFunction].filter(Boolean).join(" · ") ||
          undefined}
        spacing={2}
      >
        {hasMasterData && (
          <Stack spacing={0.5}>
            {climateControlType && (
              <DetailRow label={msg("aeClimateControl")} value={climateControlType} />
            )}
            {tenancyType && (
              <DetailRow label={msg("aeTenancyType")} value={tenancyType} />
            )}
            {leaseType && <DetailRow label={msg("aeLeaseType")} value={leaseType} />}
            {tenantIndustry && (
              <DetailRow label={msg("aeTenantIndustry")} value={tenantIndustry} />
            )}
            {indoorTemperatureClass && (
              <DetailRow
                label={msg("aeIndoorTemp")}
                value={indoorTemperatureClass}
              />
            )}
            {numberOfLoadingDocks != null && (
              <DetailRow label={msg("aeLoadingDocks")} value={numberOfLoadingDocks} />
            )}
            {greenLeaseShare != null && (
              <DetailRow
                label={msg("aeGreenLease")}
                value={`${formatNumber(greenLeaseShare, 1)} %`}
              />
            )}
            {systems.map((s) => (
              <DetailRow
                key={s.id}
                label={systemRowLabel(s.kind)}
                value={
                  <Chip
                    icon={systemRowIcon(s.kind)}
                    label={systemChipLabel(s)}
                    size="small"
                    color="success"
                    variant="outlined"
                  />
                }
              />
            ))}
            {certifications.length > 0 && (
              <DetailRow
                label={msg("aeCertifications")}
                value={
                  <Stack direction="row" spacing={0.5} sx={{ flexWrap: "wrap" }}>
                    {certifications.map((cert, i) => (
                      <Chip
                        key={i}
                        icon={<WorkspacePremiumIcon />}
                        label={[cert.type, cert.level, cert.scope]
                          .filter(Boolean)
                          .join(" · ")}
                        size="small"
                        color="primary"
                        variant="outlined"
                      />
                    ))}
                  </Stack>
                }
              />
            )}
          </Stack>
        )}

        {yearsNum.length === 0
          ? (
            <Typography color="text.secondary">
              No annual energy data available for this building.
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
                          <strong>{headerOf(m)}</strong>
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
                              {y} (planned)
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
                  Operator average — mean across all buildings with the same
                  "Operated by" agent, each counted with its latest actual year
                  (the Betreiber benchmark).
                </Typography>
              )}
              {hasPortfolio && (
                <Typography variant="body2" color="text.secondary">
                  Portfolio average — mean across your own buildings carrying the
                  metric.
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
                  Benchmark provided by{" "}
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
                      {chartTitleOf(m)}
                    </SectionTitle>
                    <ChartBox>
                      <MetricBarChart
                        data={metricData((d) => d[m.key])}
                        bars={metricBars(headerOf(m), METRIC_COLORS[m.key])}
                        yUnit={m.unit}
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
