import { msg } from "../lib/messages.ts";
import { buildingDisplayName } from "../lib/buildingDisplay.ts";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { buildingRoute } from "../routes.ts";
import { BuildingType, EnergyType } from "../types.ts";
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
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import {
  useResolveAgent,
  useResolveOrg,
  useSolidData,
} from "../hooks/queries.ts";
import CorporateFareIcon from "@mui/icons-material/CorporateFare";
import {
  ENERGY_ABOVE_AVG_COLOR,
  ENERGY_BELOW_AVG_COLOR,
  ENERGY_TYPICAL_COLOR,
  MARKER_NO_DATA_COLOR,
  MARKER_OWNED_COLOR,
  MARKER_SHARED_COLOR,
} from "../constants/chartColors.ts";
import {
  beginActivity,
  endActivity,
} from "../lib/networkActivity.ts";
import { safeImageSrc } from "../lib/safeHref.ts";
import {
  categoriserFor,
  type EnergyCategory,
  energyIntensity,
} from "../services/rdf/energyCategory.ts";

/** Which colour lens the map markers use. */
type MapLens = "ownership" | "energy";

/** Energy-category → marker colour (reuses the energy-grid heat-map palette). */
const CATEGORY_COLOR: Record<EnergyCategory, string> = {
  efficient: ENERGY_BELOW_AVG_COLOR,
  typical: ENERGY_TYPICAL_COLOR,
  inefficient: ENERGY_ABOVE_AVG_COLOR,
  none: MARKER_NO_DATA_COLOR,
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
 * Energy-lens marker: a filled circle tinted by the building's energy category,
 * shown for EVERY building (not just those with a producer logo) so the
 * categorisation is always legible. The category is baked into the `className`
 * (`energy-marker energy-<category>`) so the e2e spec can assert it.
 */
const categoryIconCache = new Map<string, L.DivIcon>();
function createCategoryIcon(category: EnergyCategory): L.DivIcon {
  const hit = categoryIconCache.get(category);
  if (hit) return hit;
  const shadow = "box-shadow:0 1px 4px rgba(0,0,0,0.45);";
  const icon = L.divIcon({
    className: `energy-marker energy-${category}`,
    html:
      `<div style="width:28px;height:28px;border-radius:50%;background:${
        CATEGORY_COLOR[category]
      };border:3px solid #fff;${shadow}"></div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
    popupAnchor: [0, -17],
  });
  categoryIconCache.set(category, icon);
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
  { building, position, onClick, lens, category }: {
    building: BuildingType;
    position: [number, number];
    onClick: () => void;
    lens: MapLens;
    category: EnergyCategory;
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
    ? createCategoryIcon(category)
    : createPinIcon(building.isShared ?? false);
  const tooltipOffset: [number, number] = lens === "energy"
    ? [0, -20]
    : [0, -38];
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
  const { buildings, energyNeed, error } = useSolidData();
  const navigate = useNavigate();
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

  // Buildings currently visible in the map's bounding box (before the first
  // bounds report, treat every located building as visible).
  const visibleBuildings = useMemo(
    () =>
      buildings.filter((b) =>
        b.lat != null && b.long != null &&
        (!bbox || bbox.contains([b.lat, b.long]))
      ),
    [buildings, bbox],
  );

  // Energy intensity (kWh / m² / a) per building id, and the intensities of the
  // buildings currently in view — the peer set the energy lens categorises
  // against, so panning/zooming re-frames the comparison. Recomputes when
  // phase-2 energy arrives, re-tinting the markers without a refetch.
  const energyById = useMemo(() => {
    const m = new Map<string, EnergyType>();
    for (const e of energyNeed ?? []) {
      if (!m.has(e.id)) m.set(e.id, e);
    }
    return m;
  }, [energyNeed]);
  const intensityById = useMemo(() => {
    const m = new Map<string, number | null>();
    for (const b of buildings) {
      m.set(b.id, energyIntensity(b, energyById.get(b.id)));
    }
    return m;
  }, [buildings, energyById]);
  const peerIntensities = useMemo(
    () =>
      visibleBuildings
        .map((b) => intensityById.get(b.id))
        .filter((v): v is number => v != null),
    [visibleBuildings, intensityById],
  );
  // The per-value classifier for the current peer set — the tercile thresholds
  // are computed once per peer set here, not per marker per render.
  const categoriseIntensity = useMemo(
    () => categoriserFor(peerIntensities),
    [peerIntensities],
  );

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
        <FitToBuildings active={active} buildings={buildings} />
        <ViewportUrlSync />
        <BoundsWatcher active={active} onChange={setBbox} />
        {buildings.map((building) => (
          building.lat != null && building.long != null && (
            <BuildingMarker
              key={building.id}
              building={building}
              position={[building.lat, building.long]}
              lens={lens}
              category={categoriseIntensity(
                intensityById.get(building.id) ?? null,
              )}
              onClick={() => openBuilding(building.id)}
            />
          )
        ))}
      </MapContainer>
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
          value={lens}
          onChange={(_e, v: MapLens | null) => v && setLens(v)}
          aria-label={msg("lensAria")}
        >
          <ToggleButton value="ownership">{msg("lensOwnership")}</ToggleButton>
          <ToggleButton value="energy">{msg("lensEnergy")}</ToggleButton>
        </ToggleButtonGroup>
        {(lens === "energy"
          ? ([
            [CATEGORY_COLOR.efficient, "More efficient"],
            [CATEGORY_COLOR.typical, "Typical"],
            [CATEGORY_COLOR.inefficient, "Less efficient"],
            [CATEGORY_COLOR.none, "No energy data"],
          ] as const)
          : ([
            [MARKER_OWNED_COLOR, "My buildings"],
            [MARKER_SHARED_COLOR, "Shared with me"],
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
      </Paper>
    </Box>
  );
}
