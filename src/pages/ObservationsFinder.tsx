import { Box, IconButton, Tooltip, Typography } from "@mui/material";
import DeleteSweepIcon from "@mui/icons-material/DeleteSweep";
import type { BuildingType } from "../types.ts";
import { observationRoute } from "../routes.ts";
import { useSolidData } from "../hooks/queries.ts";
import { useDeleteEnergyYear } from "../hooks/mutations.ts";
import { useConfirm } from "../context/ConfirmContext.tsx";
import { useNotification } from "../context/NotificationContext.tsx";
import { buildingFileUri } from "../services/rdf/building/buildingId.ts";
import { getSession } from "../hooks/session.ts";
import { tryPodResources } from "../services/pod/solidUtils.ts";
import { isSeriesGranularity } from "../services/rdf/durationUtils.ts";
import { buildingDisplayName, buildingSearchText } from "../lib/buildingDisplay.ts";
import { filterByText } from "../lib/textSearch.ts";
import { RefLink } from "../components/detail/DetailView.tsx";
import { useT } from "../context/I18nProvider.tsx";
import ResourceRow from "../components/ResourceRow.tsx";
import FinderHeader from "../components/FinderHeader.tsx";
import Pager from "../components/Pager.tsx";
import { usePaging } from "../hooks/usePaging.ts";
import { useListSearch } from "../hooks/useListSearch.ts";
import SearchField from "../components/SearchField.tsx";

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
  const { query, setQuery } = useListSearch();
  const filtered = filterByText(withObservations, query, buildingSearchText);
  const paging = usePaging(filtered);

  // "Clear data" — delete ALL of an owned building's observations (every dataset),
  // keeping the building. No bulk intent exists, so loop the per-dataset delete over
  // the building's links; once empty, the building drops out of this finder.
  const del = useDeleteEnergyYear();
  const { confirm } = useConfirm();
  const { showNotification } = useNotification();
  const handleClearObservations = async (b: BuildingType) => {
    const refs = b.energyDatasets ?? [];
    const years = new Set(refs.map((r) => r.year)).size;
    if (
      !await confirm({
        title: t("obsClearTitle"),
        message: t("obsClearConfirm", { name: buildingDisplayName(b), years }),
        confirmLabel: t("btnDelete"),
      })
    ) return;
    const fileUri = (b.sourceUri ?? buildingFileUri(b.uri)) as string;
    for (const r of refs) {
      await del.mutateAsync({
        fileUri,
        subjectUri: b.uri as string,
        dataset: {
          year: r.year,
          granularity: r.granularity,
          scenario: r.scenario,
          featureOfInterest: r.featureOfInterest,
        },
      }).catch(() => {});
    }
    showNotification(t("obsCleared", { name: buildingDisplayName(b) }), "success");
  };

  // Dev-mode-only source link to the backing observations container (self-hides
  // outside dev mode); null until the storage root resolves.
  const webId = getSession().info.webId;
  const rdf = webId ? tryPodResources(webId) : null;

  return (
    <FinderHeader
      title={t("navObservations")}
      count={withObservations.length}
      source={rdf?.observations}
      controls={withObservations.length > 0 && (
        <SearchField value={query} onChange={setQuery} />
      )}
    >
      {isLoading
        ? <Typography variant="body2">{t("loadingEllipsis")}</Typography>
        : withObservations.length === 0
        ? (
          <Typography variant="body2">
            {t("observationsEmpty")}
          </Typography>
        )
        : filtered.length === 0
        ? (
          <Typography variant="body2">
            {t("searchNoMatches", { query })}
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
                actions={b.isShared ? undefined : (
                  <Tooltip title={t("obsClearAria")}>
                    <IconButton
                      size="small"
                      color="error"
                      aria-label={t("obsClearAria")}
                      disabled={del.isPending}
                      onClick={() => void handleClearObservations(b)}
                    >
                      <DeleteSweepIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                )}
              />
            ))}
          </Box>
        )}
      <Pager paging={paging} />
    </FinderHeader>
  );
}
