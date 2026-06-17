import { msg } from "../lib/messages.ts";
import { buildingDisplayName, buildingSearchText } from "../lib/buildingDisplay.ts";
import { filterByText } from "../lib/textSearch.ts";
import { useListSearch } from "../hooks/useListSearch.ts";
import { useListFacet } from "../hooks/useListFacet.ts";
import { TIER_VALUES } from "../constants/tiers.ts";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { buildingRoute } from "../routes.ts";
import { BuildingType } from "../types.ts";
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
import Paper from "@mui/material/Paper";
import Slider from "@mui/material/Slider";
import IconButton from "@mui/material/IconButton";
import MuiTooltip from "@mui/material/Tooltip";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import {
  useAnnualEnergyByYear,
  useResolveAgent,
  useResolveOrg,
  useSolidData,
} from "../hooks/queries.ts";
import CorporateFareIcon from "@mui/icons-material/CorporateFare";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import PauseIcon from "@mui/icons-material/Pause";
import {
  MARKER_NO_DATA_COLOR,
  MARKER_OWNED_COLOR,
  MARKER_SHARED_COLOR,
  TREND_FLAT_COLOR,
  TREND_IMPROVING_COLOR,
  TREND_WORSENING_COLOR,
} from "../constants/chartColors.ts";
import {
  beginActivity,
  endActivity,
} from "../lib/networkActivity.ts";
import { safeImageSrc } from "../lib/safeHref.ts";
import {
  clampYear,
  type LensBand,
  selectableYears,
  yearLens,
} from "../services/energy/energyTimeCut.ts";
import {
  clampMetric,
  type MetricFraming,
  metricFraming,
  metricLabelKey,
  SELECTABLE_METRICS,
} from "../services/energy/energyMetric.ts";
import { bandColor, bandLabelKey, legendBands } from "../constants/lensBand.ts";
import {
  type EnergyTrend,
  trendForBuildings,
} from "../services/energy/energyTrend.ts";
import SpaceCutPanel from "../components/SpaceCutPanel.tsx";
import SmallMultiplesPanel from "../components/SmallMultiplesPanel.tsx";
import { useT } from "../context/I18nProvider.tsx";

/** Which colour lens the map markers use: ownership (default), absolute energy
 * tier at a chosen year, or year-over-year trend. Mutually exclusive so no
 * marker colour means two things at once. */
type MapLens = "ownership" | "energy" | "trend";

/** Which collection guise the Explore surface shows over the building set: the
 * geographic map, the cross-building over-time matrix, or the year-juxtaposing
 * small multiples ("compare years"). */
type ExploreView = "map" | "matrix" | "compare";

/** Trend → marker colour (the colourblind-safe diverging blue↔orange palette,
 * distinct from the energy tier palette so the two lenses can't be confused). */
const TREND_COLOR: Record<EnergyTrend, string> = {
  improving: TREND_IMPROVING_COLOR,
  flat: TREND_FLAT_COLOR,
  worsening: TREND_WORSENING_COLOR,
  unknown: MARKER_NO_DATA_COLOR,
};

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

// Ownership-lens marker: a plain SVG pin tinted by the theme's owned/shared
// colour (the marker encodes ownership and nothing else; the producer's logo
// lives in the marker's hover card). A click navigates to the building page —
// the map is a pure finder, so there is no persistent "selected" marker state.
//
// Leaflet icons are CACHED at module level: react-leaflet calls
// `marker.setIcon()` (replacing the marker's DOM node) whenever the `icon`
// prop's IDENTITY changes, and every pan/zoom re-renders all markers — a fresh
// icon object per render meant the whole fleet's DOM was rebuilt on every map
// move. Stable cached instances make those re-renders no-ops.
const pinIconCache = new Map<string, L.DivIcon>();
function createPinIcon(shared: boolean): L.DivIcon {
  const key = shared ? "s" : "o";
  const hit = pinIconCache.get(key);
  if (hit) return hit;
  const color = shared ? MARKER_SHARED_COLOR : MARKER_OWNED_COLOR;
  const glow = "filter:drop-shadow(0 1px 2px rgba(0,0,0,0.4));";
  // The ownership is baked into the className (`pin-owned`/`pin-shared`) so
  // the e2e specs can target a marker by it (the energy-marker precedent).
  const icon = L.divIcon({
    className: `pin-marker pin-${shared ? "shared" : "owned"}`,
    html:
      `<svg width="25" height="41" viewBox="0 0 25 41" style="${glow}" aria-hidden="true">` +
      `<path d="M12.5 0.5C5.9 0.5 0.5 5.9 0.5 12.5c0 9 12 27.5 12 27.5s12-18.5 12-27.5C24.5 5.9 19.1 0.5 12.5 0.5z" fill="${color}" stroke="#fff" stroke-width="1"/>` +
      `<circle cx="12.5" cy="12.5" r="4.5" fill="#fff"/></svg>`,
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
  });
  pinIconCache.set(key, icon);
  return icon;
}

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
 * Trend-lens marker: a filled circle tinted by the building's year-over-year
 * trend (improving / flat / worsening / unknown), shown for every building so
 * the recolour is always legible. The trend is baked into the `className`
 * (`trend-marker trend-<trend>`) so the e2e spec can assert it. Same shape as the
 * energy marker — only the palette differs.
 */
const trendIconCache = new Map<string, L.DivIcon>();
function createTrendIcon(trend: EnergyTrend): L.DivIcon {
  const hit = trendIconCache.get(trend);
  if (hit) return hit;
  const shadow = "box-shadow:0 1px 4px rgba(0,0,0,0.45);";
  const icon = L.divIcon({
    className: `trend-marker trend-${trend}`,
    html:
      `<div style="width:28px;height:28px;border-radius:50%;background:${
        TREND_COLOR[trend]
      };border:3px solid #fff;${shadow}"></div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
    popupAnchor: [0, -17],
  });
  trendIconCache.set(trend, icon);
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
  { building, position, onClick, lens, band, framing, trend }: {
    building: BuildingType;
    position: [number, number];
    onClick: () => void;
    lens: MapLens;
    band: LensBand;
    framing: MetricFraming;
    trend: EnergyTrend;
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
    : lens === "trend"
    ? createTrendIcon(trend)
    : createPinIcon(building.isShared ?? false);
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
                alt="Building producer logo"
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
                alt="Building operator logo"
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
    // A viewport in the URL (?c=&z=) wins over the auto-fit — a shared or
    // back-restored map view shouldn't be reframed to the markers. ViewportUrlSync
    // applies it; we just stand down.
    if (searchParams.get("c") && searchParams.get("z")) {
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

interface ExplorePageProps {
  /** Whether the Home tab is currently visible (the map stays mounted while hidden). */
  active?: boolean;
}

export default function ExplorePage(
  { active = true }: ExplorePageProps,
) {
  const { buildings, error } = useSolidData();
  const navigate = useNavigate();
  const t = useT();
  const [searchParams, setSearchParams] = useSearchParams();
  // Search + tier facet are collection-level: the CONTROLS live once in
  // BuildingsFinder's shared chrome; ExplorePage only *reads* the URL state (same
  // `/buildings` route, no key) to filter what it renders — so a filter set on the
  // List shows on the Map too. They scope the collection feeding EVERY surface
  // (markers, the over-time matrix, the compare-years multiples).
  const { query } = useListSearch();
  const tierFacet = useListFacet("tiers", TIER_VALUES);
  const tierKey = tierFacet.selected.join(",");
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
  // Which colour lens the markers use: owned/shared (default) or energy
  // intensity. The two are mutually exclusive so neither meaning is overloaded.
  const [lens, setLens] = useState<MapLens>("ownership");
  // Which collection guise is shown: the geographic map (default) or the
  // cross-building space-cut matrix (buildings × years). Both read the same
  // building set; the matrix is the temporal finder over it.
  const [view, setView] = useState<ExploreView>("map");

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

  // The per-year energy cube both temporal surfaces re-colour over: every
  // reachable annual figure across the set, keyed by building id and year. Loaded
  // only when a temporal surface is in use — the map's energy or trend lens (the
  // slider lives with the energy lens), the space-cut matrix, OR the compare-years
  // small multiples — so a user on the plain ownership map pays no extra GETs.
  const { data: energyByYear } = useAnnualEnergyByYear(
    buildings,
    lens === "energy" || lens === "trend" || view === "matrix" ||
      view === "compare",
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

  // Write the selected metric to the URI (`?m=`); stop any animation first (a new
  // metric re-frames the whole cut).
  const writeMetric = (m: string) => {
    setPlaying(false);
    setSearchParams((prev) => {
      const sp = new URLSearchParams(prev);
      sp.set("m", m);
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

  // The per-building year-over-year trend (the trend lens) on the selected metric.
  // Unlike the energy lens it judges each building against its OWN prior year (no
  // peer set), so it doesn't re-frame on pan and isn't tied to the selected year.
  const trendByBuilding = useMemo(
    () =>
      energyByYear && lens === "trend"
        ? trendForBuildings(buildings, energyByYear, metric)
        : null,
    [buildings, energyByYear, lens, metric],
  );
  const trendFor = (id: string): EnergyTrend =>
    trendByBuilding?.get(id) ?? "unknown";

  // Navigate to a building's detail page — the map is a pure finder, so a
  // marker click leaves the map for `/building/:id` (the same as a List row).
  const openBuilding = (id: string) => navigate(buildingRoute(id));

  return (
    <Box
      sx={{
        p: 3,
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

      {/* The map stays MOUNTED while the matrix is shown (Leaflet needs its
          container to keep its viewport/tile state), just hidden — the matrix
          renders over the same flex slot. */}
      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          display: view === "map" ? "flex" : "none",
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
              trend={trendFor(building.id)}
              onClick={() => openBuilding(building.id)}
            />
          )
        ))}
      </MapContainer>
      </Box>
      {/* The cross-building space-cut matrix (buildings × years), over the same
          set as the map — the temporal finder. Only the visible (in-bbox) set
          forms each year's peer terciles, matching the map energy lens. */}
      {view === "matrix" && (
        <Box sx={{ flex: 1, minHeight: 0, overflow: "auto" }}>
          <SpaceCutPanel
            buildings={visibleBuildings}
            energyByYear={energyByYear}
            visibleIds={visibleIds}
            metric={metric}
          />
        </Box>
      )}
      {/* The year-juxtaposing small multiples (one mini-panel per year, side by
          side, all on one shared scale), over the same visible set as the map —
          the time-juxtaposing finder. */}
      {view === "compare" && (
        <Box sx={{ flex: 1, minHeight: 0, overflow: "auto" }}>
          <SmallMultiplesPanel
            buildings={visibleBuildings}
            energyByYear={energyByYear}
            visibleIds={visibleIds}
            metric={metric}
          />
        </Box>
      )}
      {/* Map legend — a lens toggle plus the swatches for the active lens. */}
      <Paper
        variant="outlined"
        sx={{
          mt: 2,
          px: 1.5,
          py: 0.75,
          display: "flex",
          flexWrap: "wrap",
          gap: 1.5,
          alignItems: "center",
          flexShrink: 0,
        }}
      >
        <ToggleButtonGroup
          size="small"
          exclusive
          value={view}
          onChange={(_e, v: ExploreView | null) => {
            if (!v) return;
            if (v !== "map") setPlaying(false);
            setView(v);
          }}
          aria-label={t("exploreViewAria")}
        >
          <ToggleButton value="map">{t("exploreViewMap")}</ToggleButton>
          <ToggleButton value="matrix">{t("exploreViewOverTime")}</ToggleButton>
          <ToggleButton value="compare">
            {t("exploreViewCompareYears")}
          </ToggleButton>
        </ToggleButtonGroup>
        {view === "map" && (
          <ToggleButtonGroup
            size="small"
            exclusive
            value={lens}
            onChange={(_e, v: MapLens | null) => {
              if (!v) return;
              if (v !== "energy") setPlaying(false);
              setLens(v);
            }}
            aria-label={msg("lensAria")}
          >
            <ToggleButton value="ownership">{msg("lensOwnership")}</ToggleButton>
            <ToggleButton value="energy">{msg("lensEnergy")}</ToggleButton>
            <ToggleButton value="trend">{msg("lensTrend")}</ToggleButton>
          </ToggleButtonGroup>
        )}
        {/* Metric selector — the cube's measure axis. Shown whenever a
            metric-driven surface is active (the energy/trend lens, the over-time
            matrix or the compare-years multiples); the choice is URI-encoded
            (`?m=`) so every surface honours ONE selection. */}
        {(view === "matrix" || view === "compare" ||
          (view === "map" && (lens === "energy" || lens === "trend"))) && (
          <TextField
            select
            size="small"
            value={metric}
            onChange={(e) => writeMetric(e.target.value)}
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
        {/* Swatches for the active lens/view. The energy lens / matrix / compare
            multiples colour by the selected metric's FRAMING — efficiency tiers for
            consumption, a neutral low/mid/high magnitude ramp for generation; the
            trend lens has its own diverging palette; the ownership swatches are
            map-only. */}
        {(view === "matrix" || view === "compare" ||
            (view === "map" && lens === "energy")
          ? legendBands(framing).map((b) =>
            [bandColor(b, framing), t(bandLabelKey(b, framing))] as const
          )
          : view === "map" && lens === "trend"
          ? ([
            [TREND_COLOR.improving, t("legendImproving")],
            [TREND_COLOR.flat, t("legendLittleChange")],
            [TREND_COLOR.worsening, t("legendWorsening")],
            [TREND_COLOR.unknown, t("legendNoTrend")],
          ] as const)
          : ([
            [MARKER_OWNED_COLOR, t("legendMyBuildings")],
            [MARKER_SHARED_COLOR, t("legendSharedWithMe")],
          ] as const)).map(([color, label]) => (
            <Box key={label} sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
              <Box
                sx={{
                  width: 10,
                  height: 10,
                  backgroundColor: color,
                  borderRadius: "50%",
                  flexShrink: 0,
                }}
              />
              <Typography variant="body2">{label}</Typography>
            </Box>
          ))}
        {/* Time-cut slider: scrub the year the energy lens colours by. Only on
            the map with the energy lens active and ≥1 reachable year; ≥2 enables
            animation. (The matrix shows every year at once, so no slider.) */}
        {view === "map" && lens === "energy" && years.length > 0 && (
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 1.5,
              flexGrow: 1,
              flexBasis: 240,
              minWidth: 200,
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
              aria-label="Energy year"
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
      </Paper>
    </Box>
  );
}
