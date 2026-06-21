import { lazy, Suspense } from "react";
import {
  Box,
  CircularProgress,
  IconButton,
  MenuItem,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import DeleteSweepIcon from "@mui/icons-material/DeleteSweep";
import { useLocation, useSearchParams } from "react-router-dom";
import type { BuildingType } from "../types.ts";
import { observationRoute } from "../routes.ts";
import { useAnnualEnergyByYear, useSolidData } from "../hooks/queries.ts";
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
import CubeAxisBar from "../components/cube/CubeAxisBar.tsx";
import ObservationsMatrix from "../components/observation/ObservationsMatrix.tsx";
import ObservationsTrend from "../components/observation/ObservationsTrend.tsx";
import {
  resolveView,
  showsMetric,
  viewToParams,
} from "../services/cube/observationsAxes.ts";
import {
  clampMetric,
  metricLabelKey,
  SELECTABLE_METRICS,
} from "../services/energy/energyMetric.ts";

// The energy map (geographic markers + year slider) — lazy-loaded; kept
// mounted-but-hidden off the Map view to preserve its Leaflet viewport, exactly as
// the Buildings finder mounts it for ownership.
const BuildingsMap = lazy(() => import("../components/building/BuildingsMap.tsx"));

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
 * The Observations finder (`/observations`): the **energy cube** over the
 * per-building, per-year measured time-series. Buildings is the space/identity view;
 * energy lives here, its natural home. A flat View axis (`?view=`, see
 * `services/cube/observationsAxes.ts`) selects:
 * - **Map** — geographic energy markers banded at the chosen year (+ a year slider);
 * - **List** — the per-building observation summary (each row opens `/observation/:id`,
 *   where years are entered/edited; owners can clear all of a building's data);
 * - **Over time** — the buildings × years efficiency heatmap (`ObservationsMatrix`);
 * - **Trend** — each building's year-over-year direction (`ObservationsTrend`).
 *
 * The energy views share one `?m=` metric; the year `?y=` lives inside `BuildingsMap`.
 */
export default function ObservationsFinder() {
  const { buildings, isLoading } = useSolidData();
  const t = useT();
  const [searchParams, setSearchParams] = useSearchParams();
  const view = resolveView(searchParams);
  const setView = (next: typeof view) =>
    setSearchParams((prev) => viewToParams(next, prev));
  const metric = clampMetric(searchParams.get("m"));
  const setMetric = (m: string) =>
    setSearchParams((prev) => {
      const sp = new URLSearchParams(prev);
      sp.set("m", m);
      return sp;
    }, { replace: true });
  // The finder renders only on /observations; the map is "active" on the Map view.
  const onObservations = useLocation().pathname === "/observations";

  const withObservations = buildings.filter(
    (b) => (b.energyDatasets?.length ?? 0) > 0,
  );
  const { query, setQuery } = useListSearch();
  const filtered = filterByText(withObservations, query, buildingSearchText);
  const paging = usePaging(filtered);
  // The over-time heatmap + trend re-colour over the per-year energy cube, banded
  // against the filtered set as peers. Loaded only when those views are up — the Map
  // view's `BuildingsMap` owns its own (React-Query-deduped) load.
  const energyOn = view === "overtime" || view === "trend";
  const { data: energyByYear } = useAnnualEnergyByYear(withObservations, energyOn);
  const visibleIds = new Set(filtered.map((b) => b.id));

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
        <>
          <SearchField value={query} onChange={setQuery} />
          <Box sx={{ flexGrow: 1 }} />
          <CubeAxisBar
            space={{
              value: view,
              ariaLabel: t("obsViewAria"),
              onChange: setView,
              options: [
                { value: "map", label: t("btnMap") },
                { value: "list", label: t("btnList") },
                { value: "overtime", label: t("obsViewOvertime") },
                { value: "trend", label: t("obsViewTrend") },
              ],
            }}
            metricSlot={showsMetric(view)
              ? (
                <TextField
                  select
                  size="small"
                  value={metric}
                  onChange={(e) => setMetric(e.target.value)}
                  label={t("metricSelectLabel")}
                  sx={{ minWidth: 160 }}
                >
                  {SELECTABLE_METRICS.map((m) => (
                    <MenuItem key={m.key} value={m.key}>
                      {t(metricLabelKey(m.key))}
                    </MenuItem>
                  ))}
                </TextField>
              )
              : undefined}
          />
        </>
      )}
    >
      {/* Map: a fixed-size energy map (same height as the Aggregations map), kept
          mounted — only hidden off the Map view — to preserve the Leaflet viewport. */}
      <Box
        sx={{
          display: view === "map" ? "flex" : "none",
          flexDirection: "column",
          height: 480,
          borderRadius: 1,
          overflow: "hidden",
        }}
      >
        <Suspense fallback={<CircularProgress sx={{ mt: 4, ml: 4 }} />}>
          <BuildingsMap
            active={onObservations && view === "map"}
            colour="energy"
            target="observation"
          />
        </Suspense>
      </Box>

      {/* The rows views (List · Over time · Trend) share the loading/empty states. */}
      {view !== "map" && (
        isLoading
          ? <Typography variant="body2">{t("loadingEllipsis")}</Typography>
          : withObservations.length === 0
          ? <Typography variant="body2">{t("observationsEmpty")}</Typography>
          : filtered.length === 0
          ? (
            <Typography variant="body2">
              {t("searchNoMatches", { query })}
            </Typography>
          )
          : view === "overtime"
          ? (
            <Box sx={{ minHeight: 0, overflow: "auto" }}>
              <ObservationsMatrix
                buildings={filtered}
                energyByYear={energyByYear}
                visibleIds={visibleIds}
                metric={metric}
              />
            </Box>
          )
          : view === "trend"
          ? (
            <ObservationsTrend
              buildings={filtered}
              energyByYear={energyByYear}
              metric={metric}
            />
          )
          : (
            <>
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
              <Pager paging={paging} />
            </>
          )
      )}
    </FinderHeader>
  );
}
