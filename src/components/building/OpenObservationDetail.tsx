import Divider from "@mui/material/Divider";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import SolarPowerIcon from "@mui/icons-material/SolarPower";
import { useT } from "../../context/I18nProvider.tsx";
import { useOpenObservationDetail } from "../../hooks/openObservations.ts";
import { plantUrl } from "../../services/netztransparenz.ts";
import { metricLabel } from "../../constants/annualMetrics.ts";
import MetricBarChart from "../detail/MetricBarChart.tsx";
import { CHART_COLOR_PALETTE } from "../../constants/chartColors.ts";
import SourceNote from "../SourceNote.tsx";
import { type DataSource, SOURCES } from "../../constants/dataSources.ts";
import {
  BackLink,
  ChartBox,
  DetailCard,
  RdfSourceLink,
  SectionTitle,
} from "../detail/DetailView.tsx";
import { FINDERS } from "../../routes.ts";

/**
 * The in-app, READ-ONLY detail for an open observation — a renewable PLANT drilled to
 * from the Observations `open` tier (`/observation?uri=<mastr-iri>`) instead of bouncing
 * to the upstream document. Built from the SAME detail idiom as the standard pages
 * (`Stack`-divider, `BackLink`, a `DetailCard` + `SectionTitle`/`ChartBox`), but it is
 * NOT a building: master data (capacity, locality) from the MaStR unit + the
 * actually-settled generation per year (netztransparenz) as an annual bar chart, with
 * source attribution (and the raw IRIs as dev-mode links).
 */
export default function OpenObservationDetail({ iri }: { iri: string }) {
  const t = useT();
  const { data, isLoading } = useOpenObservationDetail(iri);
  const years = data ? [...data.byYear.keys()].sort((a, b) => a - b) : [];
  const chartData = years.map((y) => ({
    year: String(y),
    generation: data!.byYear.get(y) ?? 0,
  }));
  const meta = data
    ? [
      data.capacityKw != null ? `${data.capacityKw} kW` : "",
      data.locality,
    ].filter(Boolean).join(" · ")
    : "";
  const sources: DataSource[] = data?.eegNumber
    ? [SOURCES.mastr, SOURCES.netztransparenz]
    : [SOURCES.mastr];
  return (
    <Stack spacing={3} divider={<Divider />} sx={{ width: "100%" }}>
      <BackLink fallback={FINDERS.observations} />
      {isLoading && (
        <Typography variant="body2">{t("loadingEllipsis")}</Typography>
      )}
      {!isLoading && !data && (
        <Typography variant="body2">{t("openObsUnavailable")}</Typography>
      )}
      {!isLoading && data && (
        <DetailCard
          icon={<SolarPowerIcon color="action" />}
          title={data.label || t("obsOpenFallback")}
          subheader={meta || undefined}
        >
          <SectionTitle>{metricLabel("electricityGeneration")}</SectionTitle>
          {chartData.length > 0
            ? (
              <ChartBox>
                <MetricBarChart
                  data={chartData}
                  bars={[{
                    key: "generation",
                    name: metricLabel("electricityGeneration"),
                    color: CHART_COLOR_PALETTE[0],
                  }]}
                  yUnit="kWh"
                  hideLegend
                />
              </ChartBox>
            )
            : (
              <Typography variant="body2" color="text.secondary">
                {t("openObsNoGeneration")}
              </Typography>
            )}
          <SourceNote variant="caption" sources={sources} />
          <RdfSourceLink href={iri} />
          {data.eegNumber && <RdfSourceLink href={plantUrl(data.eegNumber)} />}
        </DetailCard>
      )}
    </Stack>
  );
}
