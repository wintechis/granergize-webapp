import { msg } from "../../lib/messages.ts";
import { sourceKeys } from "../../services/sources/sourceKeys.ts";
import { buildingSearchText } from "../../lib/buildingDisplay.ts";
import { filterByText } from "../../lib/textSearch.ts";
import { useListSearch } from "../../hooks/useListSearch.ts";
import { useListFacet } from "../../hooks/useListFacet.ts";
import { useOpenBuildings } from "../../hooks/openBuildings.ts";
import { useOpenObservations } from "../../hooks/openObservations.ts";
import { ownDataAnchor, viewportAnchor } from "../../services/sources/openBuildings.ts";
import { getStoredViewport } from "../../lib/mapViewport.ts";
import { TIER_VALUES } from "../../constants/tiers.ts";
import { buildingPin } from "../../lib/buildingPin.ts";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { buildingRoute, observationRoute } from "../../routes.ts";
import { useTrailState } from "../../hooks/navTrail.ts";
import MarkerClusterGroup from "./MarkerClusterGroup.tsx";
import { MapContainer, Marker, Tooltip, WMSTileLayer } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";
import Slider from "@mui/material/Slider";
import IconButton from "@mui/material/IconButton";
import MuiTooltip from "@mui/material/Tooltip";
import { useAnnualEnergyByYear, useSolidData } from "../../hooks/queries.ts";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import PauseIcon from "@mui/icons-material/Pause";
import { useTileActivity } from "../../hooks/tileActivity.ts";
import {
  clampYear,
  type LensBand,
  selectableYears,
  yearLens,
} from "../../services/energy/energyTimeCut.ts";
import {
  clampMetric,
  magnitudeCategoriserFor,
  type MetricFraming,
  metricFraming,
} from "../../services/energy/energyMetric.ts";
import { bandColor, bandLabelKey, legendBands } from "../../constants/lensBand.ts";
import { useT } from "../../context/I18nProvider.tsx";
import { useQueries, useQuery } from "@tanstack/react-query";
import MagnitudeChoroplethLayer from "../region/MagnitudeChoroplethLayer.tsx";
import MagnitudeLegend from "../region/MagnitudeLegend.tsx";
import {
  fetchRegionAgs,
  fetchRegionGeometry,
  type RegionFeatureProps,
  type RegionGrain,
} from "../../services/sources/regionGeometry.ts";
import { buildingsByRegion } from "./buildingsByRegion.ts";
import { dominantBand } from "./markerClusterTint.ts";
import { BuildingMarker, type MapLens } from "./BuildingMarker.tsx";
import {
  BoundsWatcher,
  FitToBuildings,
  InvalidateOnActive,
  ViewportUrlSync,
  ZoomWatcher,
} from "./mapViewportLayers.tsx";

/** Region-LOD thresholds. Below {@link CHOROPLETH_BELOW} the map shades regions (a
 *  portfolio overview) instead of markers/clusters; the choropleth grain is Kreis at/above
 *  {@link ZOOM_KREIS}, coarser Land below it. (Clusters then run up to z16, pins above —
 *  `disableClusteringAtZoom`.) */
const CHOROPLETH_BELOW = 10;
const ZOOM_KREIS = 7;
const DAY = 24 * 60 * 60 * 1000;

// Basemap: the official German basemap.de Web Raster (BKG) via its WMS endpoint
// (CRS EPSG:3857, Leaflet's default). The "farbe" (colour) layer; switch to
// "de_basemapde_web_raster_grau" for the muted grey variant. NOTE: basemap.de
// covers Germany only — buildings outside Germany render on a blank background.
// (Previously CartoDB Positron / OpenStreetMap XYZ tiles via <TileLayer>.)
const BASEMAP_DE = {
  url: "https://sgx.geodatenzentrum.de/wms_basemapde",
  layers: "de_basemapde_web_raster_farbe",
  attribution:
    '&copy; <a href="https://basemap.de/">basemap.de</a> / &copy; <a href="https://www.bkg.bund.de/">BKG</a>',
} as const;


interface BuildingsMapProps {
  /** Whether the Buildings tab is visible (the map stays mounted while hidden). */
  active?: boolean;
  /** The finder's resolved Colour axis — owned/shared pins vs energy-band pins. */
  colour: MapLens;
  /** Where a marker click drills to: the building page (`/building/:id`, default,
   *  the Buildings finder) or the observation page (`/observation/:id`, the
   *  Observations finder — its map is about the energy, so it opens the energy). */
  target?: "building" | "observation";
}

export default function BuildingsMap(
  { active = true, colour, target = "building" }: BuildingsMapProps,
) {
  const { buildings, error } = useSolidData();
  const navigate = useNavigate();
  const trailState = useTrailState();
  // Drill into a detail page, recording the map as the back trail (history state).
  const go = (route: string) => navigate(route, { state: trailState(route) });
  const t = useT();
  const [searchParams, setSearchParams] = useSearchParams();
  // Search + tier facet are collection-level: the CONTROLS live once in
  // BuildingsFinder's shared chrome; BuildingsMap only *reads* the URL state (same
  // `/buildings` route, no key) to filter what it renders — so a filter set on the
  // List shows on the Map too. They scope the collection feeding EVERY surface
  // (markers, the over-time matrix, the compare-years multiples).
  const { query } = useListSearch();
  const tierFacet = useListFacet("tiers", TIER_VALUES);
  const tierKey = tierFacet.selected.join(",");
  // Open tier: a read-only green-marker layer, fetched around the map viewport centre
  // (`?c`) only when `open` is ticked — same query key as the finder's count/list, so
  // React Query dedups the one fetch. WHAT counts as "open" depends on the target: on
  // the Buildings map it's open *buildings* (LoD2 rooftop potential — building data);
  // on the Observations map it's open *observations* (netztransparenz settled
  // generation). Only the target's layer is enabled, so the map matches the finder's
  // open count + list.
  const openOn = tierFacet.isSelected("open");
  const onObservation = target === "observation";
  // Open layers anchor to the user's OWN buildings (the concentric default), or to the map
  // viewport when exploration mode (`?explore=1`) is on — then panning loads open data
  // wherever you look.
  const exploreOn = searchParams.get("explore") === "1";
  const { centre: openCentre, radiusM: openRadius } = useMemo(
    () => (exploreOn ? viewportAnchor(searchParams) : ownDataAnchor(buildings)),
    [exploreOn, searchParams, buildings],
  );
  const { data: openBuildings = [] } = useOpenBuildings(
    openCentre,
    openRadius,
    openOn && !onObservation,
  );
  const { data: openObservations = [] } = useOpenObservations(
    openCentre,
    openRadius,
    openOn && onObservation,
  );
  const shownBuildings = useMemo(
    () =>
      filterByText(
        buildings.filter((b) =>
          tierFacet.isSelected(b.isShared ? "shared" : "mine")
        ),
        query,
        buildingSearchText,
      ),
    // tierKey stands in for the (freshly-allocated each render) selected array;
    // tierFacet itself is a new object each render, so it's deliberately excluded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [buildings, tierKey, query],
  );
  // Basemap fetches feed the global indicator through the shared hook (one
  // token per tile burst, closed on unmount) — the same wiring as every map.
  const tileEvents = useTileActivity();
  // The map's current bounding box; the energy lens's peer set is computed
  // over the buildings that fall inside it.
  const [bbox, setBbox] = useState<L.LatLngBounds | null>(null);
  // The marker colour mode (owned/shared vs energy band) is the finder's resolved
  // Colour axis, passed in — this surface is only the cube's `space=map` renderer.
  const lens = colour;

  // Buildings currently visible in the map's bounding box (before the first
  // bounds report, treat every located building as visible).
  const visibleBuildings = useMemo(
    () =>
      shownBuildings.filter((b) =>
        b.lat != null && b.long != null &&
        (!bbox || bbox.contains([b.lat, b.long]))
      ),
    [shownBuildings, bbox],
  );

  // The per-year energy cube the energy lens re-colours over: every reachable
  // annual figure across the set, keyed by building id and year. Loaded only when
  // the energy lens is up, so a user on the plain ownership map pays no extra GETs.
  const { data: energyByYear } = useAnnualEnergyByYear(
    buildings,
    lens === "energy",
  );

  // The selected observed property (the cube's measure axis) — URI-encoded
  // navigational state (`?m=`), like the year, so a metric choice is shareable and
  // survives a reload. Decoded through `clampMetric` (an unknown/stale value falls
  // back to the default electricity consumption). Every cube surface honours this
  // ONE choice.
  const metric = useMemo(
    () => clampMetric(searchParams.get("m")),
    [searchParams],
  );
  const framing = metricFraming(metric);

  // The selectable year range = the union of reachable buildings' dataset years
  // (no fixed range). Empty until the per-year energy has loaded.
  const years = useMemo(
    () => (energyByYear ? selectableYears(energyByYear) : []),
    [energyByYear],
  );

  // The selected year is URI-encoded navigational state (`?y=`), so a time-cut is
  // shareable and survives a reload. Clamp the decoded value to the selectable
  // set — a stale/shared link can't select a year no building has — defaulting to
  // the latest (the map's pre-slider behaviour). Held in component state so
  // dragging is smooth; the URL is written on commit (see onYearChangeCommitted).
  const urlYear = useMemo(() => {
    const raw = searchParams.get("y");
    return raw != null && Number.isFinite(Number(raw)) ? Number(raw) : null;
  }, [searchParams]);
  const selectedYear = useMemo(
    () => clampYear(years, urlYear),
    [years, urlYear],
  );

  // Drag-local year so the slider tracks the thumb at 60fps without rewriting the
  // URL on every pixel; null = "follow the committed/URL year".
  const [draftYear, setDraftYear] = useState<number | null>(null);
  const activeYear = draftYear ?? selectedYear;

  // The cluster bubbles are tinted from the marker icons; the refresh effect
  // that recomputes them lives below, keyed on the lens categoriser itself
  // (`lensAtYear`), so EVERY input that re-bands a marker — lens, metric, year,
  // the visible peer set after a pan — also refreshes the clusters.
  const buildingClusterRef = useRef<L.MarkerClusterGroup | null>(null);

  // Animation play/pause state — declared here so the URI writers can stop it.
  const [playing, setPlaying] = useState(false);

  const writeYear = (year: number) => {
    setSearchParams((prev) => {
      const sp = new URLSearchParams(prev);
      sp.set("y", String(year));
      return sp;
    }, { replace: true });
  };

  // Animation: a timer stepping the selected year over the range, wrapping at the
  // end. Torn down on unmount and whenever it stops (the cleanup clears the
  // interval), so it never outlives the page.
  // The animation runs only while the energy lens is up and ≥2 years exist; the
  // guard here (rather than a setState-in-effect reset) keeps the timer from
  // firing when those conditions lapse, and the cleanup tears it down on unmount.
  const animating = playing && lens === "energy" && years.length >= 2;
  useEffect(() => {
    if (!animating) return;
    const id = setInterval(() => {
      const cur = clampYear(years, urlYear) ?? years[0];
      const next = years[(years.indexOf(cur) + 1) % years.length];
      writeYear(next);
    }, 1200);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animating, years, urlYear]);

  // The visible peer set (ids) the lens categorises against — panning re-frames
  // it, year-scrubbing re-cuts the cube. The categoriser is parameterised by the
  // active year, not duplicated.
  const visibleIds = useMemo(
    () => new Set(visibleBuildings.map((b) => b.id)),
    [visibleBuildings],
  );
  const lensAtYear = useMemo(
    () =>
      energyByYear
        ? yearLens(buildings, visibleIds, energyByYear, activeYear, metric)
        : null,
    [buildings, visibleIds, energyByYear, activeYear, metric],
  );
  const bandFor = (id: string): LensBand =>
    lensAtYear ? lensAtYear.band(id) : "none";

  // Markers update their icon in place when the lens re-bands them; tell the
  // cluster group to recompute its bubbles too (otherwise a metric/year/pan
  // change leaves the clusters showing the previous band's colour).
  useEffect(() => {
    buildingClusterRef.current?.refreshClusters();
  }, [lens, lensAtYear]);

  // Region-LOD (#2): below CHOROPLETH_BELOW the map shades regions instead of drawing
  // markers/clusters — a portfolio-wide overview that coarsens to Land as you zoom out.
  const [zoom, setZoom] = useState(() => getStoredViewport()?.zoom ?? 6.5);
  const showChoropleth = zoom < CHOROPLETH_BELOW;
  const grain: RegionGrain = zoom < ZOOM_KREIS ? "land" : "kreis";
  const regionGeo = useQuery({
    // The trailing null is the bbox slot — the key shape the other maps use,
    // so the whole-layer geometry is cached ONCE across all of them.
    queryKey: [...sourceKeys.regionGeometry, grain, null],
    queryFn: () => fetchRegionGeometry(grain),
    // Only when the choropleth is actually shown AND the tab is visible (the map stays
    // mounted-hidden on other tabs — don't fetch geometry for an off-screen map).
    enabled: showChoropleth && active,
    staleTime: DAY,
    // Best-effort decorative overlay: a wrapper outage drops the choropleth, never toasts.
    meta: { silent: true },
  });
  // Resolve each shown building's region AGS by dereferencing its dcterms:spatial
  // concept — the authoritative bare AGS is the concept's own dcterms:identifier
  // (memoised per IRI in fetchRegionAgs). Only while the choropleth is actually shown.
  const conceptIris = useMemo(
    () => [
      ...new Set(
        shownBuildings
          .map((b) => b.regionConceptIri)
          .filter((x): x is string => !!x),
      ),
    ],
    [shownBuildings],
  );
  const agsQueries = useQueries({
    queries: conceptIris.map((iri) => ({
      queryKey: [...sourceKeys.regionAgs, iri],
      queryFn: () => fetchRegionAgs(iri),
      enabled: showChoropleth && active,
      staleTime: Infinity, // region codes are immutable
    })),
  });
  // Destructure the (referentially-unstable) query results to plain data + a stable
  // signature, then a concept→AGS lookup.
  const agsData = agsQueries.map((q) => q.data);
  const agsSig = agsData.join("|");
  const agsByConcept = new Map<string, string>();
  conceptIris.forEach((iri, i) => {
    const a = agsData[i];
    if (a) agsByConcept.set(iri, a);
  });
  // Group the shown buildings into regions, filling each building's AGS from its
  // resolved concept (a freshly geocoded building already carries its own regionAgs).
  const regionGrouping = useMemo(
    () =>
      buildingsByRegion(
        shownBuildings.map((b) =>
          b.regionAgs || !b.regionConceptIri
            ? b
            : { ...b, regionAgs: agsByConcept.get(b.regionConceptIri) }
        ),
        grain,
      ),
    // agsByConcept is rebuilt each render, but its content is captured by agsSig.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shownBuildings, grain, agsSig],
  );
  // Ownership lens shades by building COUNT (a magnitude ramp over the per-region counts);
  // energy lens shades each region by its DOMINANT band (the rule the clusters use).
  const choroplethFraming: MetricFraming = lens === "energy" ? framing : "magnitude";
  const countBand = useMemo(
    () =>
      magnitudeCategoriserFor(
        [...regionGrouping.byAgs.values()].map((bs) => bs.length),
      ),
    [regionGrouping],
  );
  const regionBandOf = (p: RegionFeatureProps): LensBand => {
    const bs = regionGrouping.byAgs.get(p.ags);
    if (!bs || bs.length === 0) return "none";
    return lens === "energy"
      ? dominantBand(bs.map((b) => bandFor(b.id)), framing)
      : countBand(bs.length);
  };
  const regionTooltip = (p: RegionFeatureProps): string => {
    const head = `<strong>${p.label || p.code || ""}</strong>`;
    const bs = regionGrouping.byAgs.get(p.ags);
    if (!bs || bs.length === 0) return `${head}<br/>${t("lensBandNoData")}`;
    const count = t("buildingCount", { count: bs.length });
    if (lens === "energy") {
      const band = dominantBand(bs.map((b) => bandFor(b.id)), framing);
      return `${head}<br/>${count} · ${t(bandLabelKey(band, framing))}`;
    }
    return `${head}<br/>${count}`;
  };

  // Navigate to a building's detail page — the map is a pure finder, so a
  // marker click leaves the map for `/building/:id` (the same as a List row).
  const openBuilding = (id: string) =>
    go(target === "observation" ? observationRoute(id) : buildingRoute(id));

  return (
    // No padding: the map fills the finder's fixed 480px frame flush, matching
    // AggregationsMap (this was a full-page route once, hence the old p:3).
    <Box
      sx={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
      }}
    >
      {error && (
        <Typography color="error" sx={{ mb: 2 }}>
          Error: {error}
        </Typography>
      )}

      {/* The geographic map — the cube's space=map renderer. `position:relative`
          so the energy legend can overlay a corner. The finder keeps this whole
          surface mounted-but-hidden while on List, preserving the Leaflet viewport. */}
      <Box
        sx={{
          position: "relative",
          flex: 1,
          minHeight: 0,
          display: "flex",
        }}
      >
      <MapContainer
        className="map-container"
        center={[50.976558, 10.404674]}
        zoom={6.5}
        zoomSnap={0.5}
        style={{ flex: 1, minHeight: 0 }}
      >
        <WMSTileLayer
          url={BASEMAP_DE.url}
          layers={BASEMAP_DE.layers}
          format="image/png"
          transparent={false}
          attribution={BASEMAP_DE.attribution}
          eventHandlers={tileEvents}
        />
        <InvalidateOnActive active={active} />
        <FitToBuildings active={active} buildings={shownBuildings} />
        <ViewportUrlSync />
        <BoundsWatcher active={active} onChange={setBbox} />
        <ZoomWatcher active={active} onChange={setZoom} />
        {showChoropleth
          ? (regionGeo.data && (
            <MagnitudeChoroplethLayer
              data={regionGeo.data}
              bandOf={regionBandOf}
              tooltip={regionTooltip}
              framing={choroplethFraming}
              remountKey={grain}
              styleVersion={`${lens}:${framing}:${activeYear ?? ""}:${regionGrouping.byAgs.size}`}
            />
          ))
          : (
            <MarkerClusterGroup ref={buildingClusterRef}>
              {shownBuildings.map((building) => (
                building.lat != null && building.long != null && (
                  <BuildingMarker
                    key={building.id}
                    building={building}
                    position={[building.lat, building.long]}
                    lens={lens}
                    band={bandFor(building.id)}
                    framing={framing}
                    onClick={() => openBuilding(building.id)}
                  />
                )
              ))}
            </MarkerClusterGroup>
          )}
        {/* Open-data layers (LoD2 buildings + nearby settled-generation observations) —
            read-only green markers, shown only when the `open` tier is ticked. Off-Pod,
            anchored to the user's own buildings; a click drills to the in-app read-only
            detail (`/building?uri=` / `/observation?uri=`), not the upstream document.
            Clustered in their OWN group so the green stays distinct from owned/shared. */}
        {openOn && (
          <MarkerClusterGroup>
            {openBuildings.map((b) => (
              b.lat != null && b.long != null && (
                <Marker
                  key={b.uri}
                  position={[b.lat, b.long]}
                  icon={buildingPin(false, true)}
                  eventHandlers={{
                    click: () => {
                      void go(buildingRoute(b.uri));
                    },
                  }}
                >
                  <Tooltip direction="top" offset={[0, -38]}>
                    {t("openBuildingLabel")}
                    {b.openKwp != null ? ` — ${Math.round(b.openKwp)} kWp` : ""}
                  </Tooltip>
                </Marker>
              )
            ))}
            {openObservations.map((o) => {
              const latest = Math.max(...o.byYear.keys());
              return (
                <Marker
                  key={o.iri}
                  position={[o.lat, o.long]}
                  icon={buildingPin(false, true)}
                  eventHandlers={{
                    click: () => {
                      void go(observationRoute(o.iri));
                    },
                  }}
                >
                  <Tooltip direction="top" offset={[0, -38]}>
                    {o.label || t("obsOpenFallback")}
                    {` — ${(o.byYear.get(latest) ?? 0).toLocaleString()} kWh (${latest})`}
                  </Tooltip>
                </Marker>
              );
            })}
          </MarkerClusterGroup>
        )}
      </MapContainer>
        {/* Count-density legend for the ownership-lens choropleth (the energy choropleth
            reuses the band legend below). */}
        {showChoropleth && lens === "ownership" && (
          <MagnitudeLegend framing="magnitude" />
        )}
        {/* Buildings the choropleth can't place (no stored region) — surfaced, not hidden. */}
        {showChoropleth && regionGrouping.unplaced > 0 && (
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{
              // Top-RIGHT: the Leaflet zoom control sits top-left and must stay clickable.
              position: "absolute",
              right: 8,
              top: 8,
              zIndex: 1000,
              bgcolor: "background.paper",
              border: 1,
              borderColor: "divider",
              borderRadius: 1,
              px: 1,
            }}
          >
            {t("mapChoroplethUnplaced", { count: regionGrouping.unplaced })}
          </Typography>
        )}
        {/* Energy band legend — overlaid in the map's bottom-left corner. Ownership
            needs no swatch: the Mine/Shared tier dots above carry that colour key. */}
        {lens === "energy" && (
          <Box
            sx={{
              position: "absolute",
              left: 8,
              bottom: 8,
              zIndex: 1000,
              bgcolor: "background.paper",
              border: 1,
              borderColor: "divider",
              borderRadius: 1,
              boxShadow: 2,
              p: 1,
              display: "flex",
              flexDirection: "column",
              gap: 0.5,
            }}
          >
            {legendBands(framing).map((b) => (
              <Box
                key={b}
                sx={{ display: "flex", alignItems: "center", gap: 0.75 }}
              >
                <Box
                  sx={{
                    width: 10,
                    height: 10,
                    backgroundColor: bandColor(b, framing),
                    borderRadius: "50%",
                    flexShrink: 0,
                  }}
                />
                <Typography variant="body2">
                  {t(bandLabelKey(b, framing))}
                </Typography>
              </Box>
            ))}
          </Box>
        )}
      </Box>
      {/* Time-cut slider — scrub the year the energy lens colours by (≥2 years →
          play through). A thin row beneath the map; the list/heatmap shows all
          years at once, so it needs no slider. */}
      {lens === "energy" && years.length > 0 && (
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1.5,
            mt: 1,
            flexShrink: 0,
          }}
        >
          <MuiTooltip title={animating ? "Pause" : "Play through years"}>
            <span>
              <IconButton
                size="small"
                onClick={() => setPlaying((p) => !p)}
                disabled={years.length < 2}
                aria-label={animating ? "Pause year animation" : "Play year animation"}
              >
                {animating ? <PauseIcon /> : <PlayArrowIcon />}
              </IconButton>
            </span>
          </MuiTooltip>
          <Slider
            size="small"
            aria-label={msg("cubeYearAria")}
            value={activeYear ?? years[years.length - 1]}
            min={years[0]}
            max={years[years.length - 1]}
            step={null}
            marks={years.map((y) => ({ value: y }))}
            valueLabelDisplay="auto"
            disabled={years.length < 2}
            onChange={(_e, v) => {
              setPlaying(false);
              setDraftYear(typeof v === "number" ? v : v[0]);
            }}
            onChangeCommitted={(_e, v) => {
              const year = typeof v === "number" ? v : v[0];
              setDraftYear(null);
              writeYear(year);
            }}
            sx={{ flexGrow: 1, minWidth: 120 }}
          />
          <Typography variant="body2" sx={{ minWidth: 40, textAlign: "right" }}>
            {activeYear ?? "—"}
          </Typography>
        </Box>
      )}
    </Box>
  );
}
