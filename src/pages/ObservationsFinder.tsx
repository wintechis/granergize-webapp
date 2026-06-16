import { Box, Typography } from "@mui/material";
import type { BuildingType } from "../types.ts";
import { observationRoute } from "../routes.ts";
import { useSolidData } from "../hooks/queries.ts";
import { getSession } from "../hooks/session.ts";
import { tryPodResources } from "../services/pod/solidUtils.ts";
import { isSeriesGranularity } from "../services/rdf/durationUtils.ts";
import { buildingDisplayName } from "../lib/buildingDisplay.ts";
import { RdfSourceLink, RefLink } from "../components/detail/DetailView.tsx";
import { useT } from "../context/I18nProvider.tsx";
import ResourceRow from "../components/ResourceRow.tsx";
import Pager from "../components/Pager.tsx";
import { usePaging } from "../hooks/usePaging.ts";

/**
 * One observation collection per building today: `/observation/:id` is keyed by
 * the building id (energy is the only observed property — see the redesign
 * plan §2a), so the finder lists every building that carries
 * `cons:hasEnergyDataset` data, owned or shared-in. Read-only: observations are
 * entered/edited on the observation page itself, so a row only navigates there.
 */

/** A short read-out of the years (and resolution) a building has observations for. */
function datasetSummary(b: BuildingType): string {
  const refs = b.energyDatasets ?? [];
  const years = [...new Set(refs.map((d) => d.year))].sort((a, c) => a - c);
  if (years.length === 0) return "";
  const range = years.length === 1
    ? String(years[0])
    : `${years[0]}–${years[years.length - 1]}`;
  const hasSeries = refs.some((d) => isSeriesGranularity(d.granularity));
  const kind = hasSeries ? "annual + time series" : "annual";
  return `${years.length} year${years.length === 1 ? "" : "s"} (${range}) · ${kind}`;
}

/**
 * The Observations finder (`/observations`): the energy/observation collections
 * reachable to you — each owned or shared-in building with observation data —
 * each row opening that building's observation (energy) detail page.
 */
export default function ObservationsFinder() {
  const { buildings, isLoading } = useSolidData();
  const t = useT();
  const withObservations = buildings.filter(
    (b) => (b.energyDatasets?.length ?? 0) > 0,
  );
  const paging = usePaging(withObservations);

  // Dev-mode-only source link to the backing observations container (self-hides
  // outside dev mode); null until the storage root resolves.
  const webId = getSession().info.webId;
  const rdf = webId ? tryPodResources(webId) : null;

  return (
    <Box
      component="section"
      sx={{ p: 3, flexGrow: 1, minHeight: 0, overflow: "auto" }}
    >
      <Typography variant="h6" sx={{ mb: 1 }}>Observations</Typography>
      {rdf && <RdfSourceLink href={rdf.observations} />}
      {isLoading
        ? <Typography variant="body2">Loading…</Typography>
        : withObservations.length === 0
        ? (
          <Typography variant="body2">
            {t("observationsEmpty")}
          </Typography>
        )
        : (
          <Box component="ul" sx={{ listStyle: "none", pl: 0, m: 0 }}>
            {paging.pageItems.map((b) => (
              <ResourceRow
                key={b.uri}
                buildingId={b.id}
                title={
                  <RefLink to={observationRoute(b.id)}>
                    <strong>{buildingDisplayName(b)}</strong>
                  </RefLink>
                }
                subtitle={datasetSummary(b)}
              />
            ))}
          </Box>
        )}
      <Pager paging={paging} />
    </Box>
  );
}
