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
import { BuildingType, InvestorAnnualData } from "../../types/types.ts";
import {
  ChartBox,
  DetailCard,
  SectionTitle,
} from "../components/detail/DetailView.tsx";
import MetricBarChart from "../components/detail/MetricBarChart.tsx";
import { loadEnergyDatasets } from "../services/utils/energyDataset.ts";
import { isSeriesGranularity } from "../services/utils/durationUtils.ts";

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
  // Annual figures are separate gran:EnergyDataset resources; fetch the
  // building's annual years (actual + planned) on demand for the Soll-Ist view.
  const [annualData, setAnnualData] = useState<InvestorAnnualData[]>([]);
  const [plannedData, setPlannedData] = useState<InvestorAnnualData[]>([]);
  const [loading, setLoading] = useState(true);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [building.id]);

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

  /** One metric → a row-per-year `[{ year, actual, planned? }]` for Recharts. */
  const metricData = (get: (d: InvestorAnnualData) => number | undefined) =>
    yearsNum.map((y) => {
      const a = actualByYear.get(y);
      const p = plannedByYear.get(y);
      return {
        year: String(y),
        actual: a ? (get(a) ?? 0) : 0,
        ...(hasPlanned ? { planned: p ? (get(p) ?? 0) : 0 } : {}),
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
              {annualData.map((d) => (
                <TableRow hover key={d.year}>
                  <TableCell>{d.year}</TableCell>
                  <TableCell align="right">
                    {d.electricityConsumption != null
                      ? formatNumber(d.electricityConsumption)
                      : "—"}
                  </TableCell>
                  <TableCell align="right">
                    {d.renewableSelfGeneratedShare != null
                      ? formatNumber(d.renewableSelfGeneratedShare, 1) +
                        " %"
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
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>

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
