import React, { useEffect, useState } from "react";
import { Session } from "@inrupt/solid-client-authn-browser";
import {
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LinearScale,
  Title,
  Tooltip,
} from "chart.js";
import type { ChartData, ChartOptions } from "chart.js";
import { Bar } from "react-chartjs-2";

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
);
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

const barOptions: ChartOptions<"bar"> = {
  responsive: true,
  plugins: { legend: { display: true } }, // distinguishes actual vs planned bars
  scales: {
    x: { title: { display: true, text: "Year" } },
    y: { beginAtZero: true },
  },
};

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
  const years = yearsNum.map(String);
  const hasPlanned = plannedData.length > 0;

  /** Actual values for a metric across the (union) years. */
  const actualOf = (get: (d: InvestorAnnualData) => number | undefined) =>
    yearsNum.map((y) => {
      const d = actualByYear.get(y);
      return d ? (get(d) ?? 0) : 0;
    });
  /** The planned-scenario comparison dataset for a metric (Soll-Ist), or none. */
  const plannedSet = (
    label: string,
    get: (d: InvestorAnnualData) => number | undefined,
  ) =>
    hasPlanned
      ? [{
        label: `${label} (planned)`,
        data: yearsNum.map((y) => {
          const d = plannedByYear.get(y);
          return d ? (get(d) ?? 0) : 0;
        }),
        backgroundColor: PLANNED_COLOR,
        borderColor: PLANNED_COLOR,
        borderWidth: 1,
      }]
      : [];

  // Electricity
  const electricityData: ChartData<"bar", number[], unknown> = {
    labels: years,
    datasets: [
      {
        label: "Electricity (kWh)",
        data: actualOf((d) => d.electricityConsumption),
        backgroundColor: ELECTRICITY_COLOR,
        borderColor: ELECTRICITY_COLOR,
        borderWidth: 1,
      },
      ...plannedSet("Electricity (kWh)", (d) => d.electricityConsumption),
    ],
  };

  const renewableData: ChartData<"bar", number[], unknown> = {
    labels: years,
    datasets: [
      {
        label: "Renewable Self-Generated (%)",
        data: actualOf((d) => d.renewableSelfGeneratedShare),
        backgroundColor: RENEWABLE_COLOR,
        borderColor: RENEWABLE_COLOR,
        borderWidth: 1,
      },
      ...plannedSet(
        "Renewable Self-Generated (%)",
        (d) => d.renewableSelfGeneratedShare,
      ),
    ],
  };

  const renewableOptions: ChartOptions<"bar"> = {
    ...barOptions,
    scales: {
      x: { title: { display: true, text: "Year" } },
      y: { beginAtZero: true, max: 100, title: { display: true, text: "%" } },
    },
  };

  //  Heat
  const heatData: ChartData<"bar", number[], unknown> = {
    labels: years,
    datasets: [
      {
        label: "Heat (kWh)",
        data: actualOf((d) => d.heatConsumption),
        backgroundColor: HEAT_COLOR,
        borderColor: HEAT_COLOR,
        borderWidth: 1,
      },
      ...plannedSet("Heat (kWh)", (d) => d.heatConsumption),
    ],
  };

  // Water
  const waterData: ChartData<"bar", number[], unknown> = {
    labels: years,
    datasets: [
      {
        label: "Water (m³)",
        data: actualOf((d) => d.waterConsumption),
        backgroundColor: WATER_COLOR,
        borderColor: WATER_COLOR,
        borderWidth: 1,
      },
      ...plannedSet("Water (m³)", (d) => d.waterConsumption),
    ],
  };

  const waterOptions: ChartOptions<"bar"> = {
    ...barOptions,
    scales: {
      x: { title: { display: true, text: "Year" } },
      y: { beginAtZero: true, title: { display: true, text: "m³" } },
    },
  };

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
          <Bar data={electricityData} options={barOptions} />
        </ChartBox>

        {/* Renewable share chart */}
        <SectionTitle divider>
          Renewable Self-Generated Share (%)
        </SectionTitle>
        <ChartBox>
          <Bar data={renewableData} options={renewableOptions} />
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
              <Bar data={heatData} options={barOptions} />
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
              <Bar data={waterData} options={waterOptions} />
            </ChartBox>
          </>
        )}
      </DetailCard>
    </ChartErrorBoundary>
  );
}
