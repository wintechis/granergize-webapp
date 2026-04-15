import { Link } from "react-router-dom";
import { BuildingType, EnergyType } from "../../types/types.ts";
import {
  Box,
  Card,
  CardContent,
  CardHeader,
  CircularProgress,
  Container,
  Divider,
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
import { alpha } from "@mui/material/styles";
import ElectricBoltIcon from "@mui/icons-material/ElectricBolt";
import Item from "@mui/material/ListItem";
import "chart.js/auto";
import type { ChartData, ChartOptions } from "chart.js";
import { Bar } from "react-chartjs-2";
import { useSolidData } from "../context/SolidDataContext.tsx";
import UserEnergyChart from "./UserEnergyChart.tsx";
import { Session } from "@inrupt/solid-client-authn-browser";
import { CHART_COLOR_PALETTE } from "../constants/chartColors.ts";

type EnergyProps = {
  selectedBuilding: string;
  operatedBy: string;
  building: BuildingType;
  session: Session;
};

export default function Energy({ selectedBuilding, operatedBy, building, session }: EnergyProps) {
  const { energyNeed, averages, agentAverages, isLoading, error, role } =
    useSolidData();

  // Find the energy data for the selected building
  const energy = energyNeed?.find((e) => e.id.toString() === selectedBuilding);

  if (isLoading) {
    return (
      <Box
        display="flex"
        justifyContent="center"
        alignItems="center"
        height="100%"
      >
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Typography color="error">
        Error loading data: {error}
      </Typography>
    );
  }

  if (!energy || !averages || !agentAverages) {
    // User-role energy is loaded on demand in UserEnergyChart; bypass the guard
    if (role === "user" && building.energyData && building.energyData.length > 0) {
      return (
        <Card>
          <CardHeader
            avatar={<ElectricBoltIcon />}
            title={
              <Typography variant="h4">
                Electricity Consumption for Building {building.id}
              </Typography>
            }
          />
          <CardContent>
            <UserEnergyChart availableDates={building.energyData} session={session} />
          </CardContent>
        </Card>
      );
    }
    return (
      <Typography>
        No energy data available for this building. You may not have access to
        this data.
      </Typography>
    );
  }

  function formatNumber(value: number): string {
    return new Intl.NumberFormat("de-DE", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  }

  function sumUpPropValues(obj: Record<string, unknown>): number {
    if (typeof obj === "object" && obj !== null) {
      return Object.values(obj)
        .filter((value): value is number => typeof value === "number")
        .reduce((sum, value) => sum + value, 0);
    }
    return 0;
  }

  function toTitleCase(str: string) {
    return str.replace(
      /\w\S*/g,
      (text) => text.charAt(0).toUpperCase() + text.substring(1).toLowerCase(),
    );
  }

  const chartData = function (
    string: keyof EnergyType,
  ): ChartData<"bar", number[], unknown> {
    if (energy === undefined) {
      return {
        labels: [],
        datasets: [],
      };
    }

    const sectionData = energy[string] as Record<string, number> | undefined;
    if (!sectionData) {
      return { labels: [], datasets: [] };
    }
    return {
      labels: Object.keys(sectionData),
      datasets: [
        {
          label: "Energy Need",
          data: Object.values(sectionData),
          backgroundColor: CHART_COLOR_PALETTE,
          borderColor: CHART_COLOR_PALETTE,
          borderWidth: 1,
        },
      ],
    };
  };

  const options: ChartOptions<"bar"> = {
    elements: {
      bar: {
        inflateAmount: 0,
      },
    },
    plugins: {
      legend: {
        display: false,
      },
    },
    scales: {
      x: {
        title: {
          display: true,
          text: "Energy Type",
        },
      },
      y: {
        title: {
          display: true,
          text: "kWh / a",
        },
        afterFit: (scale) => {
          scale.width = 100;
        },
        beginAtZero: true,
        max: Math.max(
          0,
          ...Object.values(energy["energyNeed"] || {}).map((v) =>
            typeof v === "number" ? v : 0
          ),
          ...Object.values(energy["energyGeneration"] || {}).map((v) =>
            typeof v === "number" ? v : 0
          ),
          ...Object.values(energy["energyStorage"] || {}).map((v) =>
            typeof v === "number" ? v : 0
          ),
          ...Object.values(energy["energyDistribution"] || {}).map((v) =>
            typeof v === "number" ? v : 0
          ),
          ...Object.values(energy["energyTransfer"] || {}).map((v) =>
            typeof v === "number" ? v : 0
          ),
          ...Object.values(energy["energyUsage"] || {}).map((v) =>
            typeof v === "number" ? v : 0
          ),
          ...Object.values(energy["environmentalFactor"] || {}).map((v) =>
            typeof v === "number" ? v : 0
          ),
        ),
      },
    },
    layout: {
      autoPadding: false,
    },
  };

  function getBackgroundColor(value: number, average: number): string {
    const deviation = value - average;
    const percentageDeviation = Math.abs(deviation / average) * 100;
    const saturation = Math.min(percentageDeviation, 100); // Cap saturation at 100%

    if (deviation < 0) {
      // Below average — use theme success.light (#a5d6a7)
      return alpha("#a5d6a7", saturation / 100);
    } else {
      // Above average — use theme error.light (#ef9a9a)
      return alpha("#ef9a9a", saturation / 100);
    }
  }

  function createEnergyGrid(title: keyof EnergyType) {
    if (!energy) {
      return null;
    }
    if (!energy[title]) {
      return;
    }
    const agent = operatedBy; // Assuming energy object has operatedBy property
    return (
      <>
        <Typography variant="h5">{toTitleCase(title)}</Typography>
        <Item component="div" sx={{ m: 0, p: 0 }}>
          <Container>
            <TableContainer component={Paper}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Energy Type</TableCell>
                    <TableCell align="right">kWh / a</TableCell>
                    {/* <TableCell align="right">
                      Industry Average kWh / a
                    </TableCell> */}
                    <TableCell align="right">Agent Average kWh / a</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {Object.entries(energy[title]).map(([key, value]) => {
                    const industryAverage = averages[key] || 0;
                    const agentAverage = agentAverages[agent]?.[key] || 0;
                    const comparisonValue = industryAverage;
                    return (
                      <TableRow hover key={key}>
                        <TableCell component="th" scope="row">
                          {key}
                        </TableCell>
                        <TableCell
                          align="right"
                          style={{
                            backgroundColor: getBackgroundColor(
                              value,
                              comparisonValue,
                            ),
                          }}
                        >
                          {formatNumber(value)}
                        </TableCell>
                        {/* <TableCell
                          align="right"
                          style={{
                            backgroundColor: getBackgroundColor(
                              industryAverage,
                              comparisonValue,
                            ),
                          }}
                        >
                          {formatNumber(industryAverage)}
                        </TableCell> */}
                        <TableCell
                          align="right"
                          style={{
                            backgroundColor: getBackgroundColor(
                              agentAverage,
                              comparisonValue,
                            ),
                          }}
                        >
                          {formatNumber(agentAverage)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
                <TableHead>
                  <TableRow hover>
                    <TableCell>
                      <strong>Total</strong>
                    </TableCell>
                    <TableCell align="right">
                      <strong>
                        {typeof energy[title] === "object" &&
                            energy[title] !== null
                          ? formatNumber(
                            sumUpPropValues(
                              energy[title] as Record<string, unknown>,
                            ),
                          )
                          : 0}
                      </strong>
                    </TableCell>
                    {/* <TableCell align="right">
                      <strong>
                        {formatNumber(
                          Object.keys(energy[title]).reduce(
                            (sum, key) => sum + (averages[key] || 0),
                            0,
                          ),
                        )}
                      </strong>
                    </TableCell> */}
                    <TableCell align="right">
                      <strong>
                        {formatNumber(
                          Object.keys(energy[title]).reduce((sum, key) =>
                            sum + (agentAverages[agent]?.[key] || 0), 0),
                        )}
                      </strong>
                    </TableCell>
                  </TableRow>
                </TableHead>
              </Table>
            </TableContainer>
            <Box sx={{ position: "relative", width: "100%" }}>
              <Bar data={chartData(title)} options={options} />
            </Box>
            <Divider />
          </Container>
        </Item>
      </>
    );
  }

  return (
    <Card>
      <CardHeader
        avatar={<ElectricBoltIcon />}
        title={
          <Typography variant="h4">
            {energy.timeSeries
              ? `Electricity Consumption for Building ${energy.id}`
              : `Energy Need for Building ${energy.id} in 2023`}
          </Typography>
        }
      />
      <CardContent>
        <Typography variant="body1">
          <strong>
            id: <Link to={energy.uri}>{energy.uri}</Link>
          </strong>
        </Typography>
        <Divider />
        <Stack spacing={2}>
            {createEnergyGrid("energyNeed")}
            {createEnergyGrid("energyGeneration")}
            {createEnergyGrid("energyStorage")}
            {createEnergyGrid("energyDistribution")}
            {createEnergyGrid("energyTransfer")}
            {createEnergyGrid("energyUsage")}
            {createEnergyGrid("environmentalFactor")}
        </Stack>
        <Link to="/">🠠 Back to map overview</Link>
      </CardContent>
    </Card>
  );
}
