import React from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
} from "chart.js";
import type { ChartData, ChartOptions } from "chart.js";
import { Bar } from "react-chartjs-2";

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);
import {
  Box,
  Card,
  CardContent,
  CardHeader,
  Divider,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
  Paper,
} from "@mui/material";
import ElectricBoltIcon from "@mui/icons-material/ElectricBolt";
import LocalFireDepartmentIcon from "@mui/icons-material/LocalFireDepartment";
import WaterDropIcon from "@mui/icons-material/WaterDrop";
import { BuildingType, InvestorAnnualData } from "../../types/types.ts";

interface InvestorEnergyProps {
  building: BuildingType;
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

const barOptions: ChartOptions<"bar"> = {
  responsive: true,
  plugins: { legend: { display: false } },
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
      return <Typography color="error">Chart error: {this.state.error.message}</Typography>;
    }
    return this.props.children;
  }
}

export default function InvestorEnergy({ building }: InvestorEnergyProps) {
  const annualData = (building.annualData ?? []) as InvestorAnnualData[];

  if (annualData.length === 0) {
    return (
      <Typography color="text.secondary">
        No annual energy data available for this building.
      </Typography>
    );
  }

  const years = annualData.map((d) => String(d.year));

  // Electricity
  const electricityData: ChartData<"bar", number[], unknown> = {
    labels: years,
    datasets: [
      {
        label: "Electricity (kWh)",
        data: annualData.map((d) => d.electricityConsumption ?? 0),
        backgroundColor: ELECTRICITY_COLOR,
        borderColor: ELECTRICITY_COLOR,
        borderWidth: 1,
      },
    ],
  };

  const renewableData: ChartData<"bar", number[], unknown> = {
    labels: years,
    datasets: [
      {
        label: "Renewable Self-Generated (%)",
        data: annualData.map((d) => d.renewableSelfGeneratedShare ?? 0),
        backgroundColor: RENEWABLE_COLOR,
        borderColor: RENEWABLE_COLOR,
        borderWidth: 1,
      },
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
        data: annualData.map((d) => d.heatConsumption ?? 0),
        backgroundColor: HEAT_COLOR,
        borderColor: HEAT_COLOR,
        borderWidth: 1,
      },
    ],
  };

  // Water
  const waterData: ChartData<"bar", number[], unknown> = {
    labels: years,
    datasets: [
      {
        label: "Water (m³)",
        data: annualData.map((d) => d.waterConsumption ?? 0),
        backgroundColor: WATER_COLOR,
        borderColor: WATER_COLOR,
        borderWidth: 1,
      },
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
    <Stack spacing={2}>
      {/* Summary Table */}
      <Card variant="outlined">
        <CardHeader
          avatar={<ElectricBoltIcon />}
          title={`Annual Energy & Water — Building ${building.label ?? building.id}`}
        />
        <CardContent>
          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell><strong>Year</strong></TableCell>
                  <TableCell align="right"><strong>Electricity (kWh)</strong></TableCell>
                  <TableCell align="right"><strong>Renewable (%)</strong></TableCell>
                  <TableCell align="right"><strong>Heat (kWh)</strong></TableCell>
                  <TableCell align="right"><strong>Water (m³)</strong></TableCell>
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
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </CardContent>
      </Card>

      <Divider />

      {/* Electricity chart */}
      <Box>
        <Typography variant="h6" gutterBottom sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <ElectricBoltIcon fontSize="small" /> Electricity Consumption (kWh/year)
        </Typography>
        <Bar data={electricityData} options={barOptions} />
      </Box>

      {/* Renewable share chart */}
      <Box>
        <Typography variant="h6" gutterBottom>
          Renewable Self-Generated Share (%)
        </Typography>
        <Bar data={renewableData} options={renewableOptions} />
      </Box>

      {/* Heat chart */}
      {annualData.some((d) => d.heatConsumption != null) && (
        <Box>
          <Typography variant="h6" gutterBottom sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <LocalFireDepartmentIcon fontSize="small" /> Heat Consumption (kWh/year)
          </Typography>
          <Bar data={heatData} options={barOptions} />
        </Box>
      )}

      {/* Water chart */}
      {annualData.some((d) => d.waterConsumption != null) && (
        <Box>
          <Typography variant="h6" gutterBottom sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <WaterDropIcon fontSize="small" /> Water Consumption (m³/year)
          </Typography>
          <Bar data={waterData} options={waterOptions} />
        </Box>
      )}
    </Stack>
    </ChartErrorBoundary>
  );
}
