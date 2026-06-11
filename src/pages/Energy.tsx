import { BuildingType, EnergyType } from "../types.ts";
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
import { useReceivedBenchmarks, useSolidData } from "../hooks/queries.ts";
import { pickBenchmark } from "../services/aggregation/benchmarkSelector.ts";
import { AgentLabel } from "../components/AgentLabel.tsx";
import { BackLink, RdfSourceLink } from "../components/detail/DetailView.tsx";
import { useDevMode } from "../hooks/devMode.ts";
import MetricBarChart from "../components/detail/MetricBarChart.tsx";
import UserEnergyChart from "./UserEnergyChart.tsx";

import {
  CHART_COLOR_PALETTE,
  ENERGY_ABOVE_AVG_COLOR,
  ENERGY_BELOW_AVG_COLOR,
} from "../constants/chartColors.ts";
import { isSeriesGranularity } from "../services/rdf/durationUtils.ts";
import { formatNumber } from "../lib/formatNumber.ts";

type EnergyProps = {
  selectedBuilding: string;
  building: BuildingType;
};

export default function Energy(
  { selectedBuilding, building }: EnergyProps,
) {
  const { energyNeed, portfolioAverages, operatorAverages, isLoading, error } =
    useSolidData();
  // BSP benchmark snapshots shared with this user; the comparison figure prefers
  // these over the local portfolio mean when one covers the row's metric.
  const { data: benchmarks = [] } = useReceivedBenchmarks();
  // Distinct BSPs behind the received benchmarks, for the provenance caption.
  const benchmarkProviders = [
    ...new Set(
      benchmarks.map((b) => b.computedBy).filter((w): w is string => Boolean(w)),
    ),
  ];
  const dev = useDevMode();

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

  if (!energy) {
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
            {seriesDatasets.map((d) => (
              <RdfSourceLink key={d.url} href={d.url} />
            ))}
            <UserEnergyChart seriesDatasets={seriesDatasets} />
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

  // Tint a value against a reference average; no reference (≤ 0) → no tint.
  function getBackgroundColor(value: number, average: number): string {
    if (!(average > 0)) return "transparent";
    const deviation = value - average;
    const percentageDeviation = Math.abs(deviation / average) * 100;
    const saturation = Math.min(percentageDeviation, 100); // Cap saturation at 100%

    if (deviation < 0) {
      // Below average — a pale success-green tint, saturated by deviation.
      return alpha(ENERGY_BELOW_AVG_COLOR, saturation / 100);
    } else {
      // Above average — a pale error-red tint, saturated by deviation.
      return alpha(ENERGY_ABOVE_AVG_COLOR, saturation / 100);
    }
  }

  function createEnergyGrid(title: keyof EnergyType) {
    if (!energy) {
      return null;
    }
    if (!energy[title]) {
      return;
    }
    // The Betreiber-Durchschnitt: the mean consumption across all buildings of
    // this building's operator (operatedBy), keyed by the same metric labels as
    // the row. Empty when the building has no operator or no operator peers.
    const operatorAvg =
      (typeof building.operatedBy === "string" &&
        operatorAverages[building.operatedBy]) || {};
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
                    <TableCell align="right">Portfolio average kWh / a</TableCell>
                    <TableCell align="right">Operator average kWh / a</TableCell>
                    <TableCell align="right">Benchmark kWh / a</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {Object.entries(energy[title]).map(([key, value]) => {
                    const portfolioAverage = portfolioAverages[key] || 0;
                    const operatorAverage = operatorAvg[key] || 0;
                    const benchmark = pickBenchmark(benchmarks, key);
                    // Compare the building's own value against the external
                    // benchmark when one covers this metric; else the operator
                    // (Betreiber) average when comparable buildings of the same
                    // operator exist; else the portfolio mean.
                    const reference = benchmark
                      ? benchmark.value
                      : operatorAverage > 0
                      ? operatorAverage
                      : portfolioAverage;
                    return (
                      <TableRow hover key={key}>
                        <TableCell component="th" scope="row">
                          {key}
                        </TableCell>
                        <TableCell
                          align="right"
                          style={{
                            backgroundColor: getBackgroundColor(value, reference),
                          }}
                        >
                          {formatNumber(value, 2)}
                        </TableCell>
                        <TableCell align="right">
                          {formatNumber(portfolioAverage, 2)}
                        </TableCell>
                        <TableCell align="right">
                          {operatorAverage > 0
                            ? formatNumber(operatorAverage, 2)
                            : "—"}
                        </TableCell>
                        <TableCell align="right">
                          {benchmark ? formatNumber(benchmark.value, 2) : "—"}
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
                            2,
                          )
                          : 0}
                      </strong>
                    </TableCell>
                    <TableCell align="right">
                      <strong>
                        {formatNumber(
                          Object.keys(energy[title]).reduce((sum, key) =>
                            sum + (portfolioAverages[key] || 0), 0),
                          2,
                        )}
                      </strong>
                    </TableCell>
                    <TableCell align="right">
                      <strong>
                        {(() => {
                          const total = Object.keys(energy[title]).reduce(
                            (sum, key) => sum + (operatorAvg[key] || 0),
                            0,
                          );
                          return total > 0 ? formatNumber(total, 2) : "—";
                        })()}
                      </strong>
                    </TableCell>
                    <TableCell align="right">
                      <strong>
                        {(() => {
                          const total = Object.keys(energy[title]).reduce(
                            (sum, key) =>
                              sum + (pickBenchmark(benchmarks, key)?.value ?? 0),
                            0,
                          );
                          return total > 0 ? formatNumber(total, 2) : "—";
                        })()}
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
              // The year the bulk load actually used (latest accessible actual
              // annual year) — plumbed through EnergyType, never hardcoded.
              : `Energy Need for Building ${energy.id}${
                energy.year ? ` in ${energy.year}` : ""
              }`}
          </Typography>
        }
      />
      <CardContent>
        {dev && (
          <>
            <RdfSourceLink href={energy.uri} />
            <Divider />
          </>
        )}
        <Stack spacing={2}>
          {createEnergyGrid("energyNeed")}
          {createEnergyGrid("energyGeneration")}
          {createEnergyGrid("energyStorage")}
          {createEnergyGrid("energyDistribution")}
          {createEnergyGrid("energyTransfer")}
          {createEnergyGrid("energyUsage")}
          {createEnergyGrid("environmentalFactor")}
        </Stack>
        {benchmarkProviders.length > 0 && (
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ mt: 2, display: "flex", alignItems: "center", flexWrap: "wrap", gap: 0.5 }}
          >
            Benchmark provided by{" "}
            {benchmarkProviders.map((webId) => (
              <AgentLabel key={webId} value={webId} />
            ))}
          </Typography>
        )}
        <BackLink />
      </CardContent>
    </Card>
  );
}
