import React from "react";
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
import AnalyticsIcon from "@mui/icons-material/Analytics";
import WorkspacePremiumIcon from "@mui/icons-material/WorkspacePremium";
import {
  BuildingType,
  InvestorAnnualData,
  InvestorCertification,
} from "../../types/types.ts";
import {
  ChartBox,
  DetailCard,
  DetailRow,
  SectionTitle,
} from "../components/detail/DetailView.tsx";

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
  const certifications =
    (building.certifications ?? []) as InvestorCertification[];
  const leaseType = building.leaseType as string | undefined;
  const tenantIndustry = building.tenantIndustry as string | undefined;
  const indoorTemperatureClass = building.indoorTemperatureClass as
    | string
    | undefined;

  return (
    <ChartErrorBoundary>
      <DetailCard
        icon={<AnalyticsIcon />}
        title={`Benchmark Data — ${
          companyName ?? building.label ?? building.id
        }`}
        subheader={logisticsFunction}
        spacing={2}
      >
        {/* Building metadata */}
        <Stack spacing={0.5}>
          {climateControlType && (
            <DetailRow label="Climate Control" value={climateControlType} />
          )}
          {indoorTemperature && (
            <DetailRow label="Indoor Temperature" value={indoorTemperature} />
          )}
          {tenancyType && <DetailRow label="Tenancy Type" value={tenancyType} />}
          {leaseType && <DetailRow label="Lease Type" value={leaseType} />}
          {tenantIndustry && (
            <DetailRow label="Tenant Industry" value={tenantIndustry} />
          )}
          {indoorTemperatureClass && (
            <DetailRow
              label="Indoor Temp. Class"
              value={indoorTemperatureClass}
            />
          )}
          {numberOfLoadingDocks != null && (
            <DetailRow label="Loading Docks" value={numberOfLoadingDocks} />
          )}
          {greenLeaseShare != null && (
            <DetailRow
              label="Green Lease Share"
              value={`${formatNumber(greenLeaseShare, 1)} %`}
            />
          )}
          {hasPVSystem != null && (
            <DetailRow
              label="PV System"
              value={hasPVSystem
                ? (
                  <Chip
                    icon={<SolarPowerIcon />}
                    label={pvInstallationYear != null
                      ? `Yes (since ${pvInstallationYear}${
                        pvCapacityKW != null
                          ? `, ${formatNumber(pvCapacityKW, 1)} kW`
                          : ""
                      })`
                      : "Yes"}
                    size="small"
                    color="success"
                    variant="outlined"
                  />
                )
                : <Chip label="No" size="small" variant="outlined" />}
            />
          )}
          {certifications.length > 0 && (
            <DetailRow
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

        {annualData.length === 0
          ? (
            <Typography color="text.secondary">
              No annual energy data available for this building.
            </Typography>
          )
          : (
            <>
              {/* Summary table */}
              <SectionTitle divider icon={<ElectricBoltIcon fontSize="small" />}>
                Annual Energy & Water Consumption
              </SectionTitle>
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

              {/* Electricity chart */}
              {annualData.some((d) => d.electricityConsumption != null) && (
                <>
                  <SectionTitle
                    divider
                    icon={<ElectricBoltIcon fontSize="small" />}
                  >
                    Electricity Consumption (kWh/year)
                  </SectionTitle>
                  <ChartBox>
                    <Bar data={electricityData} options={baseOptions} />
                  </ChartBox>
                </>
              )}

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
                    <Bar data={heatData} options={baseOptions} />
                  </ChartBox>
                </>
              )}

              {/* Water chart */}
              {annualData.some((d) => d.waterConsumption != null) && (
                <>
                  <SectionTitle
                    divider
                    icon={<WaterDropIcon fontSize="small" />}
                  >
                    Water Consumption (m³/year)
                  </SectionTitle>
                  <ChartBox>
                    <Bar data={waterData} options={volumeOptions} />
                  </ChartBox>
                </>
              )}

              {/* Wastewater chart */}
              {annualData.some((d) => d.wastewaterConsumption != null) && (
                <>
                  <SectionTitle
                    divider
                    icon={<WaterDropIcon fontSize="small" />}
                  >
                    Wastewater Consumption (m³/year)
                  </SectionTitle>
                  <ChartBox>
                    <Bar data={wastewaterData} options={volumeOptions} />
                  </ChartBox>
                </>
              )}
            </>
          )}
      </DetailCard>
    </ChartErrorBoundary>
  );
}
