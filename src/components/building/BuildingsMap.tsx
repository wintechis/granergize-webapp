import { msg } from "../../lib/messages.ts";
import { buildingDisplayName, buildingSearchText } from "../../lib/buildingDisplay.ts";
import { filterByText } from "../../lib/textSearch.ts";
import { useListSearch } from "../../hooks/useListSearch.ts";
import { useListFacet } from "../../hooks/useListFacet.ts";
import { useOpenBuildings } from "../../hooks/openBuildings.ts";
import { useOpenObservations } from "../../hooks/openObservations.ts";
import { ownDataAnchor } from "../../services/openBuildings.ts";
import { getStoredViewport, setStoredViewport } from "../../lib/mapViewport.ts";
import { TIER_VALUES } from "../../constants/tiers.ts";
import { buildingPin } from "../../lib/buildingPin.ts";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { buildingRoute, observationRoute } from "../../routes.ts";
import { useTrailState } from "../../hooks/navTrail.ts";
import { BuildingType } from "../../types.ts";
import {
  MapContainer,
  Marker,
  Tooltip,
  useMap,
  useMapEvents,
  WMSTileLayer,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";
import Slider from "@mui/material/Slider";
import IconButton from "@mui/material/IconButton";
import MuiTooltip from "@mui/material/Tooltip";
import {
  useAnnualEnergyByYear,
  useResolveAgent,
  useResolveOrg,
  useSolidData,
} from "../../hooks/queries.ts";
import CorporateFareIcon from "@mui/icons-material/CorporateFare";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import PauseIcon from "@mui/icons-material/Pause";
import {
  beginActivity,
  endActivity,
} from "../../lib/networkActivity.ts";
import { safeImageSrc } from "../../lib/safeHref.ts";
import {
  clampYear,
  type LensBand,
  selectableYears,
  yearLens,
} from "../../services/energy/energyTimeCut.ts";
import {
  clampMetric,
  type MetricFraming,
  metricFraming,
} from "../../services/energy/energyMetric.ts";
import { bandColor, bandLabelKey, legendBands } from "../../constants/lensBand.ts";
import { useT } from "../../context/I18nProvider.tsx";

/** What the map markers' colour encodes: ownership (owned/shared, the default) or
 * the energy band at the chosen year. The cube's `space=map` renderer; the `rows`
 * surfaces (List, over-time heatmap) live in the finder. (The trend lens and the
 * compare-years view were dropped.) */
type MapLens = "ownership" | "energy";

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


/**
 * Energy-lens marker: a filled circle tinted by the building's energy **band** for
 * the selected metric — an efficiency tier (consumption) or a neutral magnitude
 * bucket (generation). Shown for EVERY building (not just those with a producer
 * logo) so the categorisation is always legible. The band is baked into the
 * `className` (`energy-marker energy-<band>`) so the e2e spec can assert it.
 */
const categoryIconCache = new Map<string, L.DivIcon>();
function createCategoryIcon(band: LensBand, framing: MetricFraming): L.DivIcon {
  const key = `${framing}:${band}`;
  const hit = categoryIconCache.get(key);
  if (hit) return hit;
  const shadow = "box-shadow:0 1px 4px rgba(0,0,0,0.45);";
  const icon = L.divIcon({
    className: `energy-marker energy-${band}`,
    html:
      `<div style="width:28px;height:28px;border-radius:50%;background:${
        bandColor(band, framing)
      };border:3px solid #fff;${shadow}"></div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
    popupAnchor: [0, -17],
  });
  categoryIconCache.set(key, icon);
  return icon;
}

/**
 * One map marker. A dedicated component so the per-producer org-logo lookup
 * (`useResolveOrg`) is a single hook call per marker rather than inside the
 * buildings `.map()`. The marker itself is an owned/shared-coloured pin; the
 * producer's (`attributedTo`) organisation — name and logo, when they resolve —
 * shows in the hover card, as does the operator (`operatedBy`) agent's name and
 * logo when present. A click navigates to the building's detail page.
 */
function BuildingMarker(
  { building, position, onClick, lens, band, framing }: {
    building: BuildingType;
    position: [number, number];
    onClick: () => void;
    lens: MapLens;
    band: LensBand;
    framing: MetricFraming;
  },
) {
  const { data: org } = useResolveOrg(building.attributedTo);
  // The logo URL is the raw `foaf:logo` value from a THIRD PARTY's profile
  // (shared-in buildings resolve foreign producers) — sanitize before rendering.
  const logoSrc = org?.logoUrl ? safeImageSrc(org.logoUrl) : null;
  // The operator (`operatedBy`) is resolved against the agent's OWN document
  // (`foaf:name` + `foaf:img`/logo), which is where these operator-org nodes
  // state their name and logo — they carry no `org:memberOf` for resolveAgentOrg.
  const { data: operator } = useResolveAgent(building.operatedBy);
  const operatorName = operator?.name && building.operatedBy ? operator.name : null;
  const operatorLogoSrc = operator?.avatarUrl
    ? safeImageSrc(operator.avatarUrl)
    : null;
  const icon = lens === "energy"
    ? createCategoryIcon(band, framing)
    : buildingPin(building.isShared ?? false);
  const tooltipOffset: [number, number] = lens === "ownership"
    ? [0, -38]
    : [0, -20];
  return (
    <Marker
      position={position}
      icon={icon}
      eventHandlers={{ click: onClick }}
    >
      <Tooltip direction="top" offset={tooltipOffset}>
        <Box sx={{ display: "flex", gap: 1 }}>
          <CorporateFareIcon fontSize="small" />
          <span>
            <strong>{buildingDisplayName(building)}</strong>
            {building.streetAddress &&
              building.streetAddress !== buildingDisplayName(building) && (
              <>
                <br />
                {building.streetAddress}
              </>
            )}
            <br />
            {`${building.postalCode ?? ""} ${building.locality ?? ""}${
              building.region ? `, ${building.region}` : ""
            }`}
            {org?.name && (
              <>
                <br />
                <em>{org.name}</em>
              </>
            )}
            {logoSrc && (
              <img
                src={logoSrc}
                alt={msg("markerProducerLogoAlt")}
                // A Wikidata→Commons logo carries an attribution obligation; a
                // native title surfaces it (this is a Leaflet tooltip, not MUI).
                title={org?.logoSource === "commons"
                  ? msg("logoViaCommons")
                  : undefined}
                style={{
                  display: "block",
                  height: 20,
                  maxWidth: 140,
                  objectFit: "contain",
                  marginTop: 4,
                }}
                // A foreign producer's logo may not be publicly readable —
                // hide the broken image, the org name line still identifies.
                onError={(e) => {
                  e.currentTarget.style.display = "none";
                }}
              />
            )}
            {operatorName && (
              <>
                <br />
                Operated by <em>{operatorName}</em>
              </>
            )}
            {operatorLogoSrc && (
              <img
                src={operatorLogoSrc}
                alt={msg("markerOperatorLogoAlt")}
                style={{
                  display: "block",
                  height: 20,
                  maxWidth: 140,
                  objectFit: "contain",
                  marginTop: 4,
                }}
                // The operator's logo may not be publicly readable — hide the
                // broken image, the operator name line still identifies.
                onError={(e) => {
                  e.currentTarget.style.display = "none";
                }}
              />
            )}
          </span>
        </Box>
      </Tooltip>
    </Marker>
  );
}

/**
 * Leaflet miscalculates its size when its container was hidden (display:none).
 * When this map's tab becomes active again, recompute the size once it's visible.
 */
function InvalidateOnActive({ active }: { active: boolean }) {
  const map = useMap();
  useEffect(() => {
    if (active) {
      setTimeout(() => map.invalidateSize(), 0);
    }
  }, [active, map]);
  return null;
}

/**
 * Frame the map on the located buildings — once. Runs the first time the tab is
 * active and at least one building has coordinates; afterwards the user's
 * panning/zooming sticks (we never re-fit). Does nothing when no building has
 * coordinates, leaving the current view untouched.
 */
function FitToBuildings(
  { active, buildings }: { active: boolean; buildings: BuildingType[] },
) {
  const map = useMap();
  const done = useRef(false);
  const [searchParams] = useSearchParams();
  useEffect(() => {
    if (done.current || !active) return;
    // A remembered viewport (the in-session store, surviving a detail drill) or one
    // seeded in the URL (?c=&z=, a shared/deep link) wins over the auto-fit — the map
    // shouldn't be reframed to the markers. ViewportUrlSync applies it; we stand down.
    if (getStoredViewport() || (searchParams.get("c") && searchParams.get("z"))) {
      done.current = true;
      return;
    }
    const pts = buildings
      .filter((b) => b.lat != null && b.long != null)
      .map((b) => [b.lat as number, b.long as number] as [number, number]);
    if (pts.length === 0) return;
    done.current = true;
    // Defer so it runs after invalidateSize() has corrected the container size.
    setTimeout(() => map.fitBounds(L.latLngBounds(pts), { padding: [40, 40] }), 0);
  }, [active, buildings, map, searchParams]);
  return null;
}

/** Write the map's centre+zoom to the URL (`?c=<lat>,<lng>&z=<zoom>`), REPLACE so
 * panning doesn't spam history (a later navigation still captures the latest view). */
function writeViewport(
  map: L.Map,
  setSearchParams: ReturnType<typeof useSearchParams>[1],
) {
  const c = map.getCenter();
  // Preserved component state: remember the viewport so a re-mount (after a detail
  // drill) restores it, independent of the URL. The `?c`/`?z` write below stays for the
  // open-data fetch + deep-link seed.
  setStoredViewport({ lat: c.lat, long: c.lng }, map.getZoom());
  setSearchParams((prev) => {
    const sp = new URLSearchParams(prev);
    sp.set("c", `${c.lat.toFixed(5)},${c.lng.toFixed(5)}`);
    sp.set("z", String(Math.round(map.getZoom() * 100) / 100));
    return sp;
  }, { replace: true });
}

/**
 * Two-way sync of the map viewport with the URL. On mount, a viewport present in
 * the URL (`?c=&z=`) is applied once (so a shared link / Back restores the exact
 * view, ahead of FitToBuildings). On every pan/zoom settle the current view is
 * written back. Makes the map a real, bookmarkable URI.
 */
function ViewportUrlSync() {
  const [searchParams, setSearchParams] = useSearchParams();
  const map = useMapEvents({
    moveend: () => writeViewport(map, setSearchParams),
    zoomend: () => writeViewport(map, setSearchParams),
  });
  const applied = useRef(false);
  useEffect(() => {
    if (applied.current) return;
    applied.current = true; // apply at most once (and never re-fire on our own write)
    // Preferred: the in-session stored viewport — it survives the finder's unmount on a
    // detail drill, so coming back restores the exact view (no snap-to-fit). Falls back
    // to `?c`/`?z` for a fresh deep link / shared map URL.
    const stored = getStoredViewport();
    if (stored) {
      setTimeout(
        () => map.setView([stored.centre.lat, stored.centre.long], stored.zoom),
        0,
      );
      return;
    }
    const c = searchParams.get("c");
    const z = searchParams.get("z");
    if (!c || !z) return;
    const [lat, lng] = c.split(",").map(Number);
    const zoom = Number(z);
    if ([lat, lng, zoom].every(Number.isFinite)) {
      setTimeout(() => map.setView([lat, lng], zoom), 0);
    }
  }, [map, searchParams]);
  return null;
}

/**
 * Reports the map's current bounding box to the parent whenever the user pans
 * or zooms (and once the map becomes visible, since invalidateSize changes the
 * visible bounds without firing a move event).
 */
function BoundsWatcher(
  { active, onChange }: {
    active: boolean;
    onChange: (bounds: L.LatLngBounds) => void;
  },
) {
  const map = useMapEvents({
    moveend: () => onChange(map.getBounds()),
    zoomend: () => onChange(map.getBounds()),
  });
  useEffect(() => {
    if (active) {
      const t = setTimeout(() => onChange(map.getBounds()), 50);
      return () => clearTimeout(t);
    }
  }, [active, map, onChange]);
  return null;
}

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
  // Open layers are anchored to the user's OWN buildings (the concentric ring), not the
  // free map viewport — so panning to a city you own nothing in shows no open rows.
  const { centre: openCentre, radiusM: openRadius } = useMemo(
    () => ownDataAnchor(buildings),
    [buildings],
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
  // One activity token per tile-loading burst (the layer fires `loading` when it
  // starts fetching tiles and `load` once the visible set is in), so panning/
  // zooming registers in the global indicator without a token per image.
  const tileToken = useRef<number | null>(null);
  // Close a still-open tile burst on unmount (e.g. logout mid-pan) — otherwise
  // the header indicator counts a phantom in-flight request forever.
  useEffect(() => {
    return () => {
      if (tileToken.current !== null) {
        endActivity(tileToken.current);
        tileToken.current = null;
      }
    };
  }, []);
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
          eventHandlers={{
            loading: () => {
              if (tileToken.current === null) {
                tileToken.current = beginActivity("map tiles");
              }
            },
            load: () => {
              if (tileToken.current !== null) {
                endActivity(tileToken.current);
                tileToken.current = null;
              }
            },
          }}
        />
        <InvalidateOnActive active={active} />
        <FitToBuildings active={active} buildings={shownBuildings} />
        <ViewportUrlSync />
        <BoundsWatcher active={active} onChange={setBbox} />
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
        {/* Open-data (LoD2) buildings — a read-only green-marker layer, shown only when
            the `open` tier is ticked. Off-Pod, viewport-fetched; a click drills to the
            in-app read-only detail (`/building?uri=`), not the upstream document. */}
        {openOn && openBuildings.map((b) => (
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
        {/* Open observations — nearby installations' settled generation
            (netztransparenz), the Observations map's open layer. Read-only green
            markers; a click opens the source unit. */}
        {openOn && openObservations.map((o) => {
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
      </MapContainer>
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
