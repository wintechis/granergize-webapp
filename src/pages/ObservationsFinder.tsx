import { lazy, Suspense, useState } from "react";
import {
  Box,
  Button,
  CircularProgress,
  IconButton,
  MenuItem,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteSweepIcon from "@mui/icons-material/DeleteSweep";
import EnergyYearDialog from "../components/EnergyYearDialog.tsx";
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
import { useListFacet } from "../hooks/useListFacet.ts";
import SearchField from "../components/SearchField.tsx";
import TierFilter from "../components/TierFilter.tsx";
import TierDot from "../components/TierDot.tsx";
import { OBSERVATION_TIERS } from "../constants/tiers.ts";
import CubeAxisBar from "../components/cube/CubeAxisBar.tsx";
import ObservationsMatrix from "../components/observation/ObservationsMatrix.tsx";
import ObservationsOverYears from "../components/observation/ObservationsOverYears.tsx";
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
 * - **Over time** — the buildings × years efficiency heatmap, with a trailing column
 *   flagging each building's year-over-year direction (`ObservationsMatrix`);
 * - **Over years** — the metric's figures over the years, a line per building
 *   (fact-first temporal; `ObservationsOverYears`).
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
  // "Add observation" is owner-only (energy entry is); the create dialog picks among
  // ALL owned buildings — including ones with no observations yet, so a building's
  // FIRST year can be entered (after which it joins the list above).
  const ownedBuildings = buildings.filter((b) => !b.isShared);
  const [createOpen, setCreateOpen] = useState(false);
  const { query, setQuery } = useListSearch();
  // Source-tier selector (the finder collection model): union the ticked tiers — a
  // building's tier is own (`mine`) vs shared-with-me. `open` is offered for parity but
  // currently matches nothing (no per-building open energy observations — see
  // OBSERVATION_TIERS). Filters every non-map view; the map reads the full set itself.
  const tierFacet = useListFacet("tiers", OBSERVATION_TIERS);
  const byTier = withObservations.filter((b) =>
    tierFacet.isSelected(b.isShared ? "shared" : "mine")
  );
  const filtered = filterByText(byTier, query, buildingSearchText);
  const paging = usePaging(filtered);
  // The over-time heatmap (now carrying the trend column) + the over-years chart
  // re-shape the per-year energy cube, banded against the filtered set as peers.
  // Loaded only when those views are up — the Map view's `BuildingsMap` owns its own
  // (React-Query-deduped) load.
  const energyOn = view === "overtime" || view === "overyears";
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
      source={rdf?.observations}
      actions={ownedBuildings.length > 0 && (
        <Button
          variant="outlined"
          startIcon={<AddIcon />}
          onClick={() => setCreateOpen(true)}
        >
          {t("eyAddObservation")}
        </Button>
      )}
      controls={(
        <>
          <SearchField value={query} onChange={setQuery} />
          {/* Per-tier counts (overview-first, independent of search), consistent with
              the Buildings + Aggregations finders. `open` is 0 — no open observations
              yet — which the (0) makes explicit. */}
          <TierFilter
            facet={tierFacet}
            options={OBSERVATION_TIERS}
            counts={{
              mine: withObservations.filter((b) => !b.isShared).length,
              shared: withObservations.filter((b) => b.isShared).length,
              open: 0,
            }}
          />
          {/* The metric (electricity / heat / …) is a query/filter, not a view
              control, so it sits on the LEFT with search + tier — and shows on every
              view incl. the map (to compare metrics there), i.e. all but the List. */}
          {showsMetric(view) && (
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
          )}
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
                { value: "overyears", label: t("obsViewOveryears") },
              ],
            }}
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
          aspectRatio: "16 / 9",
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

      {/* The non-map views (List · Over time · Over years) share loading/empty states. */}
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
          : view === "overyears"
          ? (
            // One line per building gets unreadable past a handful, so page the
            // chart (20/page, shared with the List's pager + `?offset=`); search
            // narrows first. Each page is its own legible set of trajectories.
            <>
              <ObservationsOverYears
                buildings={paging.pageItems}
                energyByYear={energyByYear}
                metric={metric}
              />
              <Pager paging={paging} />
            </>
          )
          : (
            <>
              <Box component="ul" sx={{ listStyle: "none", pl: 0, m: 0 }}>
                {paging.pageItems.map((b) => (
                  <ResourceRow
                    key={b.uri}
                    buildingId={b.id}
                    title={
                      <>
                        <RefLink to={observationRoute(b.id)}>
                          <strong>{buildingDisplayName(b)}</strong>
                        </RefLink>
                        {/* Source-tier dot (mine = owned blue, shared = orange) —
                            the same key the tier filter wears. */}
                        <TierDot tier={b.isShared ? "shared" : "mine"} />
                      </>
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

      {/* Create observations from the finder: the entry dialog with a required
          building picker (the FeatureOfInterest) — energy can't exist without one. */}
      {createOpen && (
        <EnergyYearDialog
          open
          createFrom={ownedBuildings}
          session={getSession()}
          onClose={() => setCreateOpen(false)}
        />
      )}
    </FinderHeader>
  );
}
