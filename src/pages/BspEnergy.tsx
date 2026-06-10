import React, { useEffect, useState } from "react";
import { Session } from "@inrupt/solid-client-authn-browser";
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
} from "../types.ts";
import {
  ChartBox,
  DetailCard,
  DetailRow,
  SectionTitle,
} from "../components/detail/DetailView.tsx";
import MetricBarChart from "../components/detail/MetricBarChart.tsx";
import { loadEnergyDatasets } from "../services/rdf/energyDataset.ts";
import { isSeriesGranularity } from "../services/rdf/durationUtils.ts";
import { energyKeyFor, useSolidData } from "../hooks/queries.ts";
import { formatNumber } from "../lib/formatNumber.ts";
import {
  ELECTRICITY_COLOR,
  HEAT_COLOR,
  PLANNED_COLOR,
  WASTEWATER_COLOR,
  WATER_COLOR,
} from "../constants/chartColors.ts";

interface BspEnergyProps {
  building: BuildingType;
  session: Session;
}

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

export default function BspEnergy({ building, session }: BspEnergyProps) {
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

  const companyName = building.companyName as string | undefined;
  const logisticsFunction = building.logisticsFunction as string | undefined;
  const climateControlType = building.climateControlType as string | undefined;
  const greenLeaseShare = building.greenLeaseShare as number | undefined;
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

        {annualData.length === 0 && plannedData.length === 0
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
                    {/* One row per actual year, plus a secondary "(planned)"
                        row when Soll figures exist — table and chart agree on
                        the scenario dimension. */}
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
                        <TableCell align="right">
                          {operatorAvg["Wastewater"] != null
                            ? formatNumber(operatorAvg["Wastewater"], 1)
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
                  "Operated by" agent, each counted with its latest actual year
                  (the Betreiber benchmark).
                </Typography>
              )}

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
                    <MetricBarChart
                      data={metricData((d) => d.electricityConsumption)}
                      bars={metricBars("Electricity (kWh)", ELECTRICITY_COLOR)}
                      yUnit="kWh"
                    />
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
                  <SectionTitle
                    divider
                    icon={<WaterDropIcon fontSize="small" />}
                  >
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
                    <MetricBarChart
                      data={metricData((d) => d.wastewaterConsumption)}
                      bars={metricBars("Wastewater (m³)", WASTEWATER_COLOR)}
                      yUnit="m³"
                    />
                  </ChartBox>
                </>
              )}
            </>
          )}
      </DetailCard>
    </ChartErrorBoundary>
  );
}
