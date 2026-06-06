import { BuildingType, EnergyType } from "../../types/types.ts";
import {
  Box,
  Card,
  CardContent,
  CardHeader,
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
import { useSolidData } from "../hooks/queries.ts";
import { RefLink, UriLink } from "../components/detail/DetailView.tsx";
import MetricBarChart from "../components/detail/MetricBarChart.tsx";
import UserEnergyChart from "./UserEnergyChart.tsx";
import { Session } from "@inrupt/solid-client-authn-browser";
import { CHART_COLOR_PALETTE } from "../constants/chartColors.ts";
import { isSeriesGranularity } from "../services/utils/durationUtils.ts";

type EnergyProps = {
  selectedBuilding: string;
  operatedBy: string;
  building: BuildingType;
  session: Session;
};

export default function Energy(
  { selectedBuilding, operatedBy, building, session }: EnergyProps,
) {
  const { energyNeed, averages, operatorAverages, isLoading, error } =
    useSolidData();

  // Find the energy data for the selected building
  const energy = energyNeed?.find((e) => e.id.toString() === selectedBuilding);

  // While the global load is in flight, stay blank — the header spinner is the
  // single loading indicator; this avoids a misleading "no data" flash.
  if (isLoading) return null;

  if (error) {
    return (
      <Typography color="error">
        Error loading data: {error}
      </Typography>
    );
  }

  if (!energy || !averages || !operatorAverages) {
    const seriesDatasets = building.energyDatasets?.filter((d) =>
      isSeriesGranularity(d.granularity)
    ) ?? [];
    if (seriesDatasets.length > 0) {
      return (
        <Card>
          <CardHeader
            avatar={<ElectricBoltIcon />}
            title={
              <Typography variant="h5">
                Electricity Consumption for Building {building.id}
              </Typography>
            }
          />
          <CardContent>
            <UserEnergyChart
              seriesDatasets={seriesDatasets}
              session={session}
            />
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

  /** A section's `{ type: value }` map → `[{ name, value }]` rows for Recharts. */
  const chartRows = function (
    string: keyof EnergyType,
  ): Array<{ name: string; value: number }> {
    const sectionData = energy?.[string] as Record<string, number> | undefined;
    if (!sectionData) return [];
    return Object.entries(sectionData).map(([name, value]) => ({
      name,
      value,
    }));
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
    const operator = operatedBy;
    return (
      <>
        <Typography variant="h6">{toTitleCase(title)}</Typography>
          <Container>
            <TableContainer component={Paper}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Energy Type</TableCell>
                    <TableCell align="right">kWh / a</TableCell>
                    <TableCell align="right">Operator Average kWh / a</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {Object.entries(energy[title]).map(([key, value]) => {
                    const industryAverage = averages[key] || 0;
                    const operatorAverage = operatorAverages[operator]?.[key] ||
                      0;
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
                              industryAverage,
                            ),
                          }}
                        >
                          {formatNumber(value)}
                        </TableCell>
                        <TableCell
                          align="right"
                          style={{
                            backgroundColor: getBackgroundColor(
                              operatorAverage,
                              industryAverage,
                            ),
                          }}
                        >
                          {formatNumber(operatorAverage)}
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
                    <TableCell align="right">
                      <strong>
                        {formatNumber(
                          Object.keys(energy[title]).reduce((sum, key) =>
                            sum + (operatorAverages[operator]?.[key] || 0), 0),
                        )}
                      </strong>
                    </TableCell>
                  </TableRow>
                </TableHead>
              </Table>
            </TableContainer>
            <Box sx={{ position: "relative", width: "100%" }}>
              <MetricBarChart
                data={chartRows(title)}
                bars={[{
                  key: "value",
                  name: toTitleCase(title),
                  color: CHART_COLOR_PALETTE[0],
                  palette: CHART_COLOR_PALETTE,
                }]}
                xKey="name"
                yUnit="kWh / a"
                hideLegend
              />
            </Box>
            <Divider />
          </Container>
      </>
    );
  }

  return (
    <Card>
      <CardHeader
        avatar={<ElectricBoltIcon />}
        title={
          <Typography variant="h5">
            {energy.timeSeries
              ? `Electricity Consumption for Building ${energy.id}`
              : `Energy Need for Building ${energy.id} in 2023`}
          </Typography>
        }
      />
      <CardContent>
        <Typography variant="body1">
          <strong>
            id: <UriLink href={energy.uri}>{energy.uri}</UriLink>
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
        <RefLink to="/">🠠 Back to map overview</RefLink>
      </CardContent>
    </Card>
  );
}
