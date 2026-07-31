import { lazy, Suspense, useState } from "react";
import IconAction from "../components/IconAction.tsx";
import {
  Box,
  Button,
  CircularProgress,
  MenuItem,
  TextField,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import BookmarkAddIcon from "@mui/icons-material/BookmarkAdd";
import LinkIcon from "@mui/icons-material/Link";
import DeleteSweepIcon from "@mui/icons-material/DeleteSweep";
import DeleteIcon from "@mui/icons-material/Delete";
import EnergyYearEditor from "../components/EnergyYearEditor.tsx";
import Modal from "../components/Modal.tsx";
import BuildingPicker from "../components/BuildingPicker.tsx";
import { useLocation, useSearchParams } from "react-router-dom";
import type { Building } from "../types.ts";
import type { BuildinglessObservation } from "../services/energy/energyDataset.ts";
import { ACTION_PARAM, observationRoute } from "../routes.ts";
import {
  useAnnualEnergyByYear,
  useBuildinglessObservations,
  useSolidData,
} from "../hooks/queries.ts";
import {
  useClearObservations,
  useDeleteEnergyYear,
  useLinkObservationToBuilding,
} from "../hooks/mutations.ts";
import { useConfirm } from "../context/ConfirmContext.tsx";
import { useNotification } from "../context/NotificationContext.tsx";
import { buildingFileUri } from "../services/rdf/building/buildingId.ts";
import { getSession } from "../hooks/session.ts";
import { tryPodResources } from "../services/pod/solidUtils.ts";
import { datasetSummary, buildingDisplayName, buildingSearchText } from "../lib/buildingDisplay.ts";
import { filterByText } from "../lib/textSearch.ts";
import { RefLink } from "../components/detail/DetailView.tsx";
import { useT } from "../context/I18nProvider.tsx";
import ResourceRow from "../components/ResourceRow.tsx";
import FinderHeader from "../components/FinderHeader.tsx";
import ExploreControl from "../components/ExploreControl.tsx";
import Pager from "../components/Pager.tsx";
import { usePaging } from "../hooks/usePaging.ts";
import { useListSearch } from "../hooks/useListSearch.ts";
import { useListFacet } from "../hooks/useListFacet.ts";
import { rememberedValue, rememberValue } from "../lib/facetMemory.ts";
import SearchField from "../components/SearchField.tsx";
import TierFilter from "../components/TierFilter.tsx";
import TierDot from "../components/TierDot.tsx";
import { OBSERVATION_TIERS } from "../constants/tiers.ts";
import { useOpenObservations } from "../hooks/openObservations.ts";
import { ownDataAnchor, viewportAnchor } from "../services/sources/openBuildings.ts";
import { RdfSourceLink } from "../components/detail/DetailView.tsx";
import CubeAxisBar from "../components/cube/CubeAxisBar.tsx";
import ObservationsMatrix from "../components/observation/ObservationsMatrix.tsx";
import ObservationsOverYears from "../components/observation/ObservationsOverYears.tsx";
import ObservationsPivot from "../components/observation/ObservationsPivot.tsx";
import {
  resolveView,
  showsMetric,
  viewToParams,
} from "../services/cube/observationsAxes.ts";
import {
  metricToParams,
  resolveMetric,
} from "../services/cube/coordinate.ts";
import {
  clampMetric,
  metricLabelKey,
  SELECTABLE_METRICS,
} from "../services/energy/energyMetric.ts";
import { metricLabel } from "../constants/annualMetrics.ts";

// The energy map (geographic markers + year slider) — lazy-loaded; kept
// mounted-but-hidden off the Map view to preserve its Leaflet viewport, exactly as
// the Buildings finder mounts it for ownership.
const BuildingsMap = lazy(() => import("../components/building/BuildingsMap.tsx"));
// The saved-views (aggregations) projection — its own chunk (it pulls the choropleth
// map + the timeline chart), fetched only when that view is selected, exactly as the
// former `/aggregations` route chunk was.
const AggregationsPanel = lazy(() =>
  import("../components/aggregation/AggregationsPanel.tsx")
);


/**
 * The Observations finder (`/observations`, presented as **Explore** — the `/explore`
 * alias redirects here until Step 3 of `plans/plan-cube-centered-ui.md` swaps them):
 * the **energy cube** over the
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
 * - **Pivot** — the same rows × years grid with the row level chosen (`?rows=`):
 *   buildings, or their Gemeinde/Kreis/Land/Bund roll-up, a region row drilling one
 *   level down scoped to itself (`?in=`) (`ObservationsPivot`).
 * - **Aggregations** — the **saved views** projection (Step 2 of the cube-centered
 *   plan): the folded former Aggregations finder (`AggregationsPanel`), keeping its
 *   own `?guise=list|map|timeline` sub-axis — a saved view IS a stored coordinate +
 *   roll-up spec, and the region choropleth IS this cube at a region feature level.
 *   `/aggregations` redirects onto it (`src/routes.ts`).
 *
 * The energy views share one `?m=` metric; the year `?y=` lives inside `BuildingsMap`.
 */
export default function ObservationsFinder() {
  const { buildings, isLoading } = useSolidData();
  const t = useT();
  const [searchParams, setSearchParams] = useSearchParams();
  // The view axis sticks for the session (like the tier facet): URL > remembered >
  // default. A nav-tab re-entry (bare URL) restores the last map/list/… you chose.
  const view = resolveView(searchParams, rememberedValue("view"));
  const setView = (next: typeof view) => {
    rememberValue("view", next);
    setSearchParams((prev) => viewToParams(next, prev));
  };
  // "Save as aggregation" — hand the coordinate you're looking at to the saved-views
  // projection with its create dialog open (`?view=aggregations&action=create-aggregation`),
  // reusing the palette-routed create flow rather than a second dialog. The rest of the
  // query string (the cube coordinate) rides along, so a Back returns to this very cut.
  const saveAsAggregation = () => {
    rememberValue("view", "aggregations");
    setSearchParams((prev) => {
      const sp = viewToParams("aggregations", prev);
      sp.set(ACTION_PARAM, "create-aggregation");
      return sp;
    });
  };
  // The measure axis of the cube coordinate (`services/cube/coordinate.ts`) — read and
  // written through it, so every projection lenses on the same resolved metric.
  const metric = resolveMetric(searchParams);
  const setMetric = (m: string) =>
    setSearchParams(
      (prev) => metricToParams(clampMetric(m), prev),
      { replace: true },
    );
  // The finder renders only on /observations; the map is "active" on the Map view.
  const onObservations = useLocation().pathname === "/observations";
  // The saved-views projection renders a different collection (aggregations), so the
  // observation-collection chrome and body stand down for it.
  const savedViews = view === "aggregations";

  const withObservations = buildings.filter(
    (b) => (b.energyDatasets?.length ?? 0) > 0,
  );
  // Building-less (unbound) observations — own-Pod readings not yet linked to a
  // building; shown as their own loose rows in the List, with a "Link to a building"
  // action. Loaded only on the finder (a container listing).
  const { data: looseObs = [] } = useBuildinglessObservations(
    buildings,
    onObservations,
  );
  // "Add observation" opens the create dialog over ALL owned buildings (including ones
  // with no observations yet, so a building's FIRST year can be entered). The building
  // is optional — clearing it (or having none) writes a building-less observation — so
  // the action is offered even with no owned buildings.
  const ownedBuildings = buildings.filter((b) => !b.isShared);
  const [createOpen, setCreateOpen] = useState(false);
  // The building-less observation being linked (the link dialog) + the picked target.
  const [linkObs, setLinkObs] = useState<BuildinglessObservation | null>(null);
  const [linkTarget, setLinkTarget] = useState("");
  const { query, setQuery } = useListSearch();
  // Source-tier selector (the finder collection model): union the ticked tiers — a
  // building's tier is own (`mine`) vs shared-with-me. `open` is offered for parity but
  // currently matches nothing (no per-building open energy observations — see
  // OBSERVATION_TIERS). Filters every non-map view; the map reads the full set itself.
  const tierFacet = useListFacet("tiers", OBSERVATION_TIERS);
  const byTier = withObservations.filter((b) =>
    tierFacet.isSelected(b.isShared ? "shared" : "mine")
  );
  // Open tier: nearby renewable installations' actually-settled generation
  // (netztransparenz, joined via MaStR), fetched around the user's OWN buildings (the
  // concentric ring) only when `open` is ticked.
  // Read-only, and a SEPARATE List section (not the building-keyed cube) — like the
  // building-less loose section. Anchored to the user's OWN buildings (concentric default),
  // or to the map viewport when exploration mode (`?explore=1`) is on.
  const openOn = tierFacet.isSelected("open");
  const exploreOn = searchParams.get("explore") === "1";
  const { centre: openCentre, radiusM: openRadius } = exploreOn
    ? viewportAnchor(searchParams)
    : ownDataAnchor(buildings);
  const { data: openObs = [] } = useOpenObservations(openCentre, openRadius, openOn);
  const filtered = filterByText(byTier, query, buildingSearchText);
  const paging = usePaging(filtered);
  // The over-time heatmap (now carrying the trend column) + the over-years chart
  // re-shape the per-year energy cube, banded against the filtered set as peers.
  // Loaded only when those views are up — the Map view's `BuildingsMap` owns its own
  // (React-Query-deduped) load.
  const energyOn = view === "overtime" || view === "overyears" || view === "pivot";
  const { data: energyByYear } = useAnnualEnergyByYear(withObservations, energyOn);
  const visibleIds = new Set(filtered.map((b) => b.id));

  // "Clear data" — delete ALL of an owned building's observations (every dataset),
  // keeping the building; once empty, the building drops out of this finder. The
  // bulk loop lives in the ClearObservations core (best-effort per dataset); its
  // Tally outcome drives an honest success/partial toast below.
  const del = useDeleteEnergyYear();
  const clearObs = useClearObservations();
  const linkMut = useLinkObservationToBuilding();
  const closeLink = () => {
    setLinkObs(null);
    setLinkTarget("");
  };
  const { confirm } = useConfirm();
  const { showNotification } = useNotification();
  const handleClearObservations = async (b: Building) => {
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
    let tally;
    try {
      tally = await clearObs.mutateAsync({
        fileUri,
        subjectUri: b.uri as string,
        datasets: refs.map((r) => ({
          year: r.year,
          granularity: r.granularity,
          scenario: r.scenario,
          featureOfInterest: r.featureOfInterest,
        })),
      });
    } catch {
      return; // the central mutation toast already reported the failure
    }
    if (tally.done === tally.total) {
      showNotification(t("obsCleared", { name: buildingDisplayName(b) }), "success");
    } else {
      showNotification(
        t("obsClearedPartial", {
          done: tally.done,
          total: tally.total,
          name: buildingDisplayName(b),
        }),
        "error",
      );
    }
  };

  // Delete a single building-less observation (it's the user's own, unbound data).
  const handleDeleteLoose = async (o: BuildinglessObservation) => {
    if (
      !await confirm({
        title: t("obsClearTitle"),
        message: t("obsDeleteLooseConfirm", { year: o.year }),
        confirmLabel: t("btnDelete"),
      })
    ) return;
    del.mutate({ observationUri: o.uri });
  };

  // Dev-mode-only source link to the backing observations container (self-hides
  // outside dev mode); null until the storage root resolves.
  const webId = getSession().info.webId;
  const rdf = webId ? tryPodResources(webId) : null;

  return (
    <FinderHeader
      title={t("navObservations")}
      source={rdf?.observations}
      actions={savedViews ? undefined : (
        <>
          {/* Save this cut as a saved view: the cell-rendering projections (the
              geographic map and the pivot) are the ones that HOLD a coordinate worth
              saving; the plain List and the per-building charts don't. */}
          {(view === "map" || view === "pivot") && (
            <Button
              variant="outlined"
              startIcon={<BookmarkAddIcon />}
              onClick={saveAsAggregation}
            >
              {t("obsSaveAsAggregation")}
            </Button>
          )}
          <Button
            variant="outlined"
            startIcon={<AddIcon />}
            onClick={() => setCreateOpen(true)}
          >
            {t("eyAddObservation")}
          </Button>
        </>
      )}
      controls={(
        <>
          {/* The observation-collection controls belong to the cell views; the saved-
              views projection brings its own search / tier facet / guise toggle (it is
              a different collection), so they'd be a confusing second set. */}
          {!savedViews && (
            <>
              <SearchField value={query} onChange={setQuery} />
              {/* Per-tier counts (overview-first, independent of search), consistent with
                  the Buildings finder. `open` counts the nearby settled-generation
                  installations for the current viewport (0 until the map is panned, or
                  outside the netztransparenz pilot). */}
              <TierFilter
                facet={tierFacet}
                options={OBSERVATION_TIERS}
                counts={{
                  mine: withObservations.filter((b) => !b.isShared).length,
                  shared: withObservations.filter((b) => b.isShared).length,
                  open: openObs.length,
                }}
              />
              {openOn && <ExploreControl />}
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
            </>
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
                { value: "pivot", label: t("obsViewPivot") },
                { value: "aggregations", label: t("navAggregations") },
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

      {/* The saved-views projection: the folded former Aggregations finder, with its
          own heading/controls and its `?guise=` sub-axis. */}
      {savedViews && (
        <Suspense fallback={<CircularProgress sx={{ mt: 4, ml: 4 }} />}>
          <AggregationsPanel />
        </Suspense>
      )}

      {/* The non-map cell views (List · Over time · Over years · Pivot) share
          loading/empty states. */}
      {view !== "map" && !savedViews && (
        <>
          {isLoading && (
            <Typography variant="body2">{t("loadingEllipsis")}</Typography>
          )}
          {/* Nothing at all: no buildings with energy AND no loose observations (and,
              in the List, no open generation either). */}
          {!isLoading && withObservations.length === 0 && looseObs.length === 0 &&
            !(view === "list" && openObs.length > 0) && (
            <Typography variant="body2">{t("observationsEmpty")}</Typography>
          )}
          {/* Over time / Over years compare BUILDINGS over time, so building-less
              observations can't appear there (no building row, no per-m² area). When
              they're all there is, point to the List rather than a misleading empty. */}
          {!isLoading && view !== "list" && withObservations.length === 0 &&
            looseObs.length > 0 && (
            <Typography variant="body2" color="text.secondary">
              {t("obsLooseOnlyHint", { count: looseObs.length })}
            </Typography>
          )}
          {/* Buildings exist but the search filtered them all out. */}
          {!isLoading && withObservations.length > 0 && filtered.length === 0 && (
            <Typography variant="body2">
              {t("searchNoMatches", { query })}
            </Typography>
          )}
          {!isLoading && view === "overtime" && filtered.length > 0 && (
            <Box sx={{ minHeight: 0, overflow: "auto" }}>
              <ObservationsMatrix
                buildings={filtered}
                energyByYear={energyByYear}
                visibleIds={visibleIds}
                metric={metric}
              />
            </Box>
          )}
          {/* Pivot: the same grid with a chosen row level (buildings or their
              Gemeinde/Kreis/Land/Bund roll-up, `?rows=`, drill scope `?in=`); it
              pages nothing — the roll-up itself is what keeps the row count
              readable. */}
          {!isLoading && view === "pivot" && filtered.length > 0 && (
            <Box sx={{ minHeight: 0, overflow: "auto" }}>
              <ObservationsPivot
                buildings={filtered}
                energyByYear={energyByYear}
                metric={metric}
              />
            </Box>
          )}
          {!isLoading && view === "overyears" && filtered.length > 0 && (
            // One line per building gets unreadable past a handful, so page the chart
            // (20/page, shared with the List's pager + `?offset=`).
            <>
              <ObservationsOverYears
                buildings={paging.pageItems}
                energyByYear={energyByYear}
                metric={metric}
              />
              <Pager paging={paging} />
            </>
          )}
          {!isLoading && view === "list" && filtered.length > 0 && (
            <>
              <Box component="ul" sx={{ listStyle: "none", pl: 0, m: 0 }}>
                {paging.pageItems.map((b) => {
                  // The backing observation resources (dev-only source links, like the
                  // building IRI in the Buildings finder): one per energy dataset
                  // (`observations/{year}/{id}.ttl#ds`). RdfSourceLink self-hides
                  // outside Developer mode.
                  const refs = b.energyDatasets ?? [];
                  return (
                  <ResourceRow
                    key={b.uri}
                    buildingId={b.id}
                    title={
                      <>
                        <RefLink to={observationRoute(b.id)}>
                          <strong>{buildingDisplayName(b)}</strong>
                        </RefLink>
                        {/* Source-tier dot (mine = owned blue, shared = orange). */}
                        <TierDot tier={b.isShared ? "shared" : "mine"} />
                        {refs.map((d) => (
                          <RdfSourceLink key={d.uri} href={d.uri} inline />
                        ))}
                      </>
                    }
                    subtitle={datasetSummary(b, t)}
                    actions={b.isShared ? undefined : (
                      <IconAction
  label={t("obsClearAria")}
  icon={<DeleteSweepIcon fontSize="small" />}
  color="error"
  disabled={clearObs.isPending}
  onClick={() => void handleClearObservations(b)}
/>
                    )}
                  />
                  );
                })}
              </Box>
              <Pager paging={paging} />
            </>
          )}
          {/* Building-less observations — in the List, regardless of buildings. */}
          {!isLoading && view === "list" && looseObs.length > 0 && (
            <Box sx={{ mt: 3 }}>
              <Typography variant="h6" sx={{ mb: 1 }}>
                {t("obsWithoutBuilding")}
              </Typography>
              <Box component="ul" sx={{ listStyle: "none", pl: 0, m: 0 }}>
                {looseObs.map((o) => (
                  <ResourceRow
                    key={o.uri}
                    title={
                      <>
                        <strong>{o.year}</strong>
                        <TierDot tier="mine" />
                        {/* The dataset node IRI (dev-only source link). */}
                        <RdfSourceLink href={o.uri} inline />
                      </>
                    }
                    subtitle={Object.keys(o.metrics ?? {})
                      .map((k) => metricLabel(k))
                      .join(" · ")}
                    actions={
                      <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                        {ownedBuildings.length > 0 && (
                          <Button
                            size="small"
                            startIcon={<LinkIcon />}
                            onClick={() => setLinkObs(o)}
                          >
                            {t("obsLinkToBuilding")}
                          </Button>
                        )}
                        <IconAction
  label={t("btnDelete")}
  icon={<DeleteIcon fontSize="small" />}
  color="error"
  disabled={del.isPending}
  onClick={() => void handleDeleteLoose(o)}
/>
                      </Box>
                    }
                  />
                ))}
              </Box>
            </Box>
          )}
          {/* Open generation (nearby) — read-only settled generation of renewable
              installations near the viewport (netztransparenz via MaStR). Viewport-
              driven, so it needs the map panned; a separate section like the loose one,
              and List-only (the building-comparison views don't plot it). */}
          {!isLoading && view === "list" && openOn && !openCentre && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 3 }}>
              {t(exploreOn ? "exploreChooseArea" : "openNeedsOwnBuilding")}
            </Typography>
          )}
          {!isLoading && view === "list" && openObs.length > 0 && (
            <Box sx={{ mt: 3 }}>
              <Typography variant="h6" sx={{ mb: 1 }}>
                {t("obsOpenSection")}
              </Typography>
              <Box component="ul" sx={{ listStyle: "none", pl: 0, m: 0 }}>
                {openObs.map((o) => {
                  const latest = Math.max(...o.byYear.keys());
                  const kwh = o.byYear.get(latest) ?? 0;
                  return (
                    <ResourceRow
                      key={o.iri}
                      title={
                        <>
                          {/* Drill to the in-app read-only plant detail, not the
                              upstream unit doc; the dev source link keeps the raw IRI. */}
                          <RefLink to={observationRoute(o.iri)}>
                            <strong>{o.label || t("obsOpenFallback")}</strong>
                          </RefLink>
                          <TierDot tier="open" />
                          <RdfSourceLink href={o.iri} inline />
                        </>
                      }
                      subtitle={t("obsOpenGenerationRow", {
                        kwh: kwh.toLocaleString(),
                        year: latest,
                      })}
                    />
                  );
                })}
              </Box>
            </Box>
          )}
        </>
      )}

      {/* Create observations from the finder: binding is OPTIONAL — the picker defaults
          to UNBOUND (a building-less series, linked to a building later), and you may bind
          it to a building (then a subsystem) if you want. */}
      {createOpen && (
        <EnergyYearEditor
          open
          createFrom={ownedBuildings}
          session={getSession()}
          onClose={() => setCreateOpen(false)}
        />
      )}

      {/* Link a building-less observation to a building (late FoI binding). */}
      {linkObs && (
        <Modal
          open
          onClose={closeLink}
          title={t("obsLinkToBuilding")}
          busy={linkMut.isPending}
          actions={
            <>
              <Button
                variant="text"
                onClick={closeLink}
                disabled={linkMut.isPending}
              >
                {t("btnCancel")}
              </Button>
              <Button
                variant="contained"
                disabled={linkMut.isPending || !linkTarget}
                onClick={() =>
                  linkMut.mutate({
                    observationUri: linkObs.uri,
                    buildingFileUri: buildingFileUri(linkTarget),
                    buildingSubjectUri: linkTarget,
                    granularity: linkObs.granularity,
                    scenario: linkObs.scenario,
                  }, { onSuccess: closeLink })}
              >
                {linkMut.isPending ? t("btnSaving") : t("obsLinkToBuilding")}
              </Button>
            </>
          }
        >
          <BuildingPicker
            buildings={ownedBuildings}
            label={t("eyBuildingLabel")}
            value={linkTarget}
            onChange={setLinkTarget}
            disabled={linkMut.isPending}
          />
        </Modal>
      )}
    </FinderHeader>
  );
}
