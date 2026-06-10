import React, { useEffect, useState } from "react";
import { Session } from "@inrupt/solid-client-authn-browser";
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
import { BuildingType, InvestorAnnualData } from "../types.ts";
import {
  ChartBox,
  DetailCard,
  SectionTitle,
} from "../components/detail/DetailView.tsx";
import MetricBarChart from "../components/detail/MetricBarChart.tsx";
import { loadEnergyDatasets } from "../services/rdf/energyDataset.ts";
import { isSeriesGranularity } from "../services/rdf/durationUtils.ts";
import { energyKeyFor, useSolidData } from "../hooks/queries.ts";

interface InvestorEnergyProps {
  building: BuildingType;
  session: Session;
}

function formatNumber(value: number, decimals = 0): string {
  return new Intl.NumberFormat("de-DE", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

const ELECTRICITY_COLOR = "rgba(31, 120, 180, 0.8)";
const HEAT_COLOR = "rgba(227, 26, 28, 0.8)";
const WATER_COLOR = "rgba(51, 160, 44, 0.8)";
const RENEWABLE_COLOR = "rgba(178, 223, 138, 0.9)";
// Planned (Soll) figures — one neutral colour across metrics, shown beside actual.
const PLANNED_COLOR = "rgba(120, 120, 120, 0.55)";

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
    console.error("[InvestorEnergy] chart render error:", error, info);
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

export default function InvestorEnergy(
  { building, session }: InvestorEnergyProps,
) {
  // Annual figures are separate cons:EnergyDataset resources; fetch the
  // building's annual years (actual + planned) on demand for the Soll-Ist view.
  const [annualData, setAnnualData] = useState<InvestorAnnualData[]>([]);
  const [plannedData, setPlannedData] = useState<InvestorAnnualData[]>([]);
  const [loading, setLoading] = useState(true);
  // The Betreiber-Durchschnitt (heike-4): per-carrier mean across all buildings
  // sharing this building's operator (`operatedBy`), each contributing its
  // latest actual year (computed in loadEnergy; keys are the carrier labels
  // "Electricity"/"Heat"/"Water"/"Wastewater"). Empty when no operator is set
  // or no peer carries annual figures.
  const { operatorAverages } = useSolidData();
  const operatorAvg =
    (typeof building.operatedBy === "string" &&
      operatorAverages[building.operatedBy]) || {};
  const hasOperatorAvg = Object.keys(operatorAvg).length > 0;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      const refs = (building.energyDatasets ?? []).filter(
        (r) => !isSeriesGranularity(r.granularity),
      );
      const datasets = await loadEnergyDatasets(
        refs,
        session.fetch.bind(session),
      );
      const rows = (scenario: "actual" | "planned") =>
        datasets
          .filter((d) => d.scenario === scenario && d.metrics)
          .map((d) => ({ year: d.year, ...d.metrics }) as InvestorAnnualData)
          .sort((a, b) => a.year - b.year);
      if (!cancelled) {
        setAnnualData(rows("actual"));
        setPlannedData(rows("planned"));
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Keyed on the dataset-link fingerprint, not just the id: saving/deleting an
    // energy year changes the links but not the id, and the open tab must reload
    // (the same under-covered-fold class energyKeyFor fixes for the bulk query).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [building.id, energyKeyFor([building])]);

  if (loading) {
    return <Typography color="text.secondary">Loading…</Typography>;
  }
  if (annualData.length === 0 && plannedData.length === 0) {
    return (
      <Typography color="text.secondary">
        No annual energy data available for this building.
      </Typography>
    );
  }

  const actualByYear = new Map(annualData.map((d) => [d.year, d]));
  const plannedByYear = new Map(plannedData.map((d) => [d.year, d]));
  const yearsNum = [
    ...new Set([...annualData, ...plannedData].map((d) => d.year)),
  ].sort((a, b) => a - b);
  const hasPlanned = plannedData.length > 0;

  /** One metric → a row-per-year `[{ year, actual?, planned? }]` for Recharts.
   * A missing figure stays ABSENT (a gap), not a fabricated 0-height bar —
   * "no data" and "zero consumption" must stay distinguishable. */
  const metricData = (get: (d: InvestorAnnualData) => number | undefined) =>
    yearsNum.map((y) => {
      const a = actualByYear.get(y);
      const p = plannedByYear.get(y);
      const actual = a ? get(a) : undefined;
      const planned = p ? get(p) : undefined;
      return {
        year: String(y),
        ...(actual != null ? { actual } : {}),
        ...(hasPlanned && planned != null ? { planned } : {}),
      };
    });
  /** Actual + (when present) the planned/Soll comparison bar for a metric. */
  const metricBars = (label: string, color: string) => [
    { key: "actual", name: label, color },
    ...(hasPlanned
      ? [{ key: "planned", name: `${label} (planned)`, color: PLANNED_COLOR }]
      : []),
  ];

  return (
    <ChartErrorBoundary>
      <DetailCard
        icon={<ElectricBoltIcon />}
        title={`Annual Energy & Water — Building ${
          building.label ?? building.id
        }`}
        spacing={2}
      >
        {/* Summary table */}
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>
                  <strong>Year</strong>
                </TableCell>
                <TableCell align="right">
                  <strong>Electricity (kWh)</strong>
                </TableCell>
                <TableCell align="right">
                  <strong>Renewable (%)</strong>
                </TableCell>
                <TableCell align="right">
                  <strong>Heat (kWh)</strong>
                </TableCell>
                <TableCell align="right">
                  <strong>Water (m³)</strong>
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {/* One row per actual year, plus a secondary "(planned)" row when
                  Soll figures exist — table and chart agree on the scenario
                  dimension, and a planned-only year is no longer invisible. */}
              {yearsNum.flatMap((y) => {
                const a = actualByYear.get(y);
                const p = plannedByYear.get(y);
                const cells = (d: InvestorAnnualData) => (
                  <>
                    <TableCell align="right">
                      {d.electricityConsumption != null
                        ? formatNumber(d.electricityConsumption)
                        : "—"}
                    </TableCell>
                    <TableCell align="right">
                      {d.renewableSelfGeneratedShare != null
                        ? formatNumber(d.renewableSelfGeneratedShare, 1) + " %"
                        : "—"}
                    </TableCell>
                    <TableCell align="right">
                      {d.heatConsumption != null
                        ? formatNumber(d.heatConsumption)
                        : "—"}
                    </TableCell>
                    <TableCell align="right">
                      {d.waterConsumption != null
                        ? formatNumber(d.waterConsumption, 1)
                        : "—"}
                    </TableCell>
                  </>
                );
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
                    <strong>Operator average</strong>
                  </TableCell>
                  <TableCell align="right">
                    {operatorAvg["Electricity"] != null
                      ? formatNumber(operatorAvg["Electricity"])
                      : "—"}
                  </TableCell>
                  {/* Renewable share is not part of the operator aggregation. */}
                  <TableCell align="right">—</TableCell>
                  <TableCell align="right">
                    {operatorAvg["Heat"] != null
                      ? formatNumber(operatorAvg["Heat"])
                      : "—"}
                  </TableCell>
                  <TableCell align="right">
                    {operatorAvg["Water"] != null
                      ? formatNumber(operatorAvg["Water"], 1)
                      : "—"}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
        {hasOperatorAvg && (
          <Typography variant="body2" color="text.secondary">
            Operator average — mean across all buildings with the same
            "Operated by" agent, each counted with its latest actual year (the
            Betreiber benchmark).
          </Typography>
        )}

        {/* Electricity chart */}
        <SectionTitle divider icon={<ElectricBoltIcon fontSize="small" />}>
          Electricity Consumption (kWh/year)
        </SectionTitle>
        <ChartBox>
          <MetricBarChart
            data={metricData((d) => d.electricityConsumption)}
            bars={metricBars("Electricity (kWh)", ELECTRICITY_COLOR)}
            yUnit="kWh"
          />
        </ChartBox>

        {/* Renewable share chart */}
        <SectionTitle divider>
          Renewable Self-Generated Share (%)
        </SectionTitle>
        <ChartBox>
          <MetricBarChart
            data={metricData((d) => d.renewableSelfGeneratedShare)}
            bars={metricBars(
              "Renewable Self-Generated (%)",
              RENEWABLE_COLOR,
            )}
            yUnit="%"
          />
        </ChartBox>

        {/* Heat chart */}
        {annualData.some((d) => d.heatConsumption != null) && (
          <>
            <SectionTitle
              divider
              icon={<LocalFireDepartmentIcon fontSize="small" />}
            >
              Heat Consumption (kWh/year)
            </SectionTitle>
            <ChartBox>
              <MetricBarChart
                data={metricData((d) => d.heatConsumption)}
                bars={metricBars("Heat (kWh)", HEAT_COLOR)}
                yUnit="kWh"
              />
            </ChartBox>
          </>
        )}

        {/* Water chart */}
        {annualData.some((d) => d.waterConsumption != null) && (
          <>
            <SectionTitle divider icon={<WaterDropIcon fontSize="small" />}>
              Water Consumption (m³/year)
            </SectionTitle>
            <ChartBox>
              <MetricBarChart
                data={metricData((d) => d.waterConsumption)}
                bars={metricBars("Water (m³)", WATER_COLOR)}
                yUnit="m³"
              />
            </ChartBox>
          </>
        )}
      </DetailCard>
    </ChartErrorBoundary>
  );
}
