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
  Chip,
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
import SolarPowerIcon from "@mui/icons-material/SolarPower";
import AnalyticsIcon from "@mui/icons-material/Analytics";
import WorkspacePremiumIcon from "@mui/icons-material/WorkspacePremium";
import { BuildingType, InvestorAnnualData, InvestorCertification } from "../../types/types.ts";

interface BspEnergyProps {
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
const WASTEWATER_COLOR = "rgba(0, 150, 136, 0.8)";

const baseOptions: ChartOptions<"bar"> = {
  responsive: true,
  plugins: { legend: { display: false } },
  scales: {
    x: { title: { display: true, text: "Year" } },
    y: { beginAtZero: true },
  },
};

const volumeOptions: ChartOptions<"bar"> = {
  ...baseOptions,
  scales: {
    x: { title: { display: true, text: "Year" } },
    y: { beginAtZero: true, title: { display: true, text: "m³" } },
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
    console.error("[BspEnergy] chart render error:", error, info);
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

function MetaRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Box sx={{ display: "flex", gap: 1, alignItems: "baseline" }}>
      <Typography variant="body2" color="text.secondary" sx={{ minWidth: 180 }}>
        {label}
      </Typography>
      <Typography variant="body2">{value}</Typography>
    </Box>
  );
}

export default function BspEnergy({ building }: BspEnergyProps) {
  const annualData = (building.annualData ?? []) as InvestorAnnualData[];

  const years = annualData.map((d) => String(d.year));

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

  const wastewaterData: ChartData<"bar", number[], unknown> = {
    labels: years,
    datasets: [
      {
        label: "Wastewater (m³)",
        data: annualData.map((d) => d.wastewaterConsumption ?? 0),
        backgroundColor: WASTEWATER_COLOR,
        borderColor: WASTEWATER_COLOR,
        borderWidth: 1,
      },
    ],
  };

  const companyName = building.companyName as string | undefined;
  const logisticsFunction = building.logisticsFunction as string | undefined;
  const climateControlType = building.climateControlType as string | undefined;
  const greenLeaseShare = building.greenLeaseShare as number | undefined;
  const indoorTemperature = building.indoorTemperature as string | undefined;
  const tenancyType = building.tenancyType as string | undefined;
  const numberOfLoadingDocks = building.numberOfLoadingDocks as
    | number
    | undefined;
  const hasPVSystem = building.hasPVSystem as boolean | undefined;
  const pvInstallationYear = building.pvInstallationYear as number | undefined;
  const pvCapacityKW = building.pvCapacityKW as number | undefined;
  const certifications = (building.certifications ?? []) as InvestorCertification[];
  const leaseType = building.leaseType as string | undefined;
  const tenantIndustry = building.tenantIndustry as string | undefined;
  const indoorTemperatureClass = building.indoorTemperatureClass as string | undefined;

  return (
    <ChartErrorBoundary>
      <Stack spacing={2}>
        {/* Building metadata */}
        <Card variant="outlined">
          <CardHeader
            avatar={<AnalyticsIcon />}
            title={`Benchmark Data — ${companyName ?? building.label ?? building.id}`}
            subheader={logisticsFunction}
          />
          <CardContent>
            <Stack spacing={0.5}>
              {climateControlType && (
                <MetaRow label="Climate Control" value={climateControlType} />
              )}
              {indoorTemperature && (
                <MetaRow label="Indoor Temperature" value={indoorTemperature} />
              )}
              {tenancyType && (
                <MetaRow label="Tenancy Type" value={tenancyType} />
              )}
              {leaseType && (
                <MetaRow label="Lease Type" value={leaseType} />
              )}
              {tenantIndustry && (
                <MetaRow label="Tenant Industry" value={tenantIndustry} />
              )}
              {indoorTemperatureClass && (
                <MetaRow label="Indoor Temp. Class" value={indoorTemperatureClass} />
              )}
              {numberOfLoadingDocks != null && (
                <MetaRow
                  label="Loading Docks"
                  value={numberOfLoadingDocks}
                />
              )}
              {greenLeaseShare != null && (
                <MetaRow
                  label="Green Lease Share"
                  value={`${formatNumber(greenLeaseShare, 1)} %`}
                />
              )}
              {hasPVSystem != null && (
                <MetaRow
                  label="PV System"
                  value={
                    hasPVSystem ? (
                      <Chip
                        icon={<SolarPowerIcon />}
                        label={
                          pvInstallationYear != null
                            ? `Yes (since ${pvInstallationYear}${pvCapacityKW != null ? `, ${formatNumber(pvCapacityKW, 1)} kW` : ""})`
                            : "Yes"
                        }
                        size="small"
                        color="success"
                        variant="outlined"
                      />
                    ) : (
                      <Chip label="No" size="small" variant="outlined" />
                    )
                  }
                />
              )}
              {certifications.length > 0 && (
                <MetaRow
                  label="Certifications"
                  value={
                    <Stack direction="row" spacing={0.5} flexWrap="wrap">
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
          </CardContent>
        </Card>

        {annualData.length === 0 ? (
          <Typography color="text.secondary">
            No annual energy data available for this building.
          </Typography>
        ) : (
          <>
            {/* Summary table */}
            <Card variant="outlined">
              <CardHeader
                avatar={<ElectricBoltIcon />}
                title="Annual Energy & Water Consumption"
              />
              <CardContent>
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
                          <strong>Heat (kWh)</strong>
                        </TableCell>
                        <TableCell align="right">
                          <strong>Water (m³)</strong>
                        </TableCell>
                        <TableCell align="right">
                          <strong>Wastewater (m³)</strong>
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
                            {d.heatConsumption != null
                              ? formatNumber(d.heatConsumption)
                              : "—"}
                          </TableCell>
                          <TableCell align="right">
                            {d.waterConsumption != null
                              ? formatNumber(d.waterConsumption, 1)
                              : "—"}
                          </TableCell>
                          <TableCell align="right">
                            {d.wastewaterConsumption != null
                              ? formatNumber(d.wastewaterConsumption, 1)
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
            {annualData.some((d) => d.electricityConsumption != null) && (
              <Box>
                <Typography
                  variant="h6"
                  gutterBottom
                  sx={{ display: "flex", alignItems: "center", gap: 1 }}
                >
                  <ElectricBoltIcon fontSize="small" /> Electricity Consumption
                  (kWh/year)
                </Typography>
                <Bar data={electricityData} options={baseOptions} />
              </Box>
            )}

            {/* Heat chart */}
            {annualData.some((d) => d.heatConsumption != null) && (
              <Box>
                <Typography
                  variant="h6"
                  gutterBottom
                  sx={{ display: "flex", alignItems: "center", gap: 1 }}
                >
                  <LocalFireDepartmentIcon fontSize="small" /> Heat Consumption
                  (kWh/year)
                </Typography>
                <Bar data={heatData} options={baseOptions} />
              </Box>
            )}

            {/* Water chart */}
            {annualData.some((d) => d.waterConsumption != null) && (
              <Box>
                <Typography
                  variant="h6"
                  gutterBottom
                  sx={{ display: "flex", alignItems: "center", gap: 1 }}
                >
                  <WaterDropIcon fontSize="small" /> Water Consumption
                  (m³/year)
                </Typography>
                <Bar data={waterData} options={volumeOptions} />
              </Box>
            )}

            {/* Wastewater chart */}
            {annualData.some((d) => d.wastewaterConsumption != null) && (
              <Box>
                <Typography
                  variant="h6"
                  gutterBottom
                  sx={{ display: "flex", alignItems: "center", gap: 1 }}
                >
                  <WaterDropIcon fontSize="small" /> Wastewater Consumption
                  (m³/year)
                </Typography>
                <Bar data={wastewaterData} options={volumeOptions} />
              </Box>
            )}
          </>
        )}
      </Stack>
    </ChartErrorBoundary>
  );
}
