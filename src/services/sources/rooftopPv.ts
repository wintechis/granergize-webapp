/**
 * Per-building rooftop-PV potential from roof geometry — the TS port of the linked-lod2-by
 * wrapper's `RoofPotential` calc, moved into the app so the wrapper can shrink to serving
 * measured geometry only (the untangle; see plans/plan-lod2-pv-calc-to-app.md). The app is
 * the data-combination layer, so the PV screening belongs here.
 *
 * Recipe (a standard rooftop-screening shape): each roof surface is filtered for
 * suitability (drop walls and strongly north-facing pitched roofs; re-tilt flat roofs to a
 * racked south array), its usable area → installable kWp at a module power density → annual
 * kWh via the {@link specificYield} PVGIS table. The building total sums its suitable roofs;
 * a building with no suitable roof yields `null`. Pure (no I/O) so it stays offline-testable.
 */
import { lod2ToPvgisAspect, specificYield } from "./pvgisGrid.ts";

// Tunables (mirror the wrapper's RoofPotential / pv_potential.py).
const USABLE_FRAC = 0.70;
const MODULE_KWP_PER_M2 = 0.20;
const MAX_TILT = 80.0;
const FLAT_TILT = 10.0;
const FLAT_PV_TILT = 30.0;
const FLAT_PV_ASPECT = 0.0;
const NORTH_EXCL_HALF = 45.0;
const FLAT_ROW_SPACING = 0.6; // row-spacing penalty on flat roofs

/** One roof surface's measured geometry (from lod2-by `lod2:RoofSurface`). */
export interface RoofSurface {
  areaM2: number;
  tiltDeg: number;
  /** LoD2 `Dachorientierung` (0=N, 90=E, 180=S, 270=W). */
  azimuthDeg: number;
  /** The surface's 2-D ground-projected footprint as a WGS84 `[lon, lat]` ring, when the
   *  wrapper serves it. `linked-lod2-by` serves native ETRS89/UTM32N `POLYGON Z`; the WKT
   *  parser (`parseWktPolygon`) reprojects it to lon/lat here. Drawn by the roof-plan; the
   *  PV calc ignores it. */
  polygon?: [number, number][];
}

/** One roof surface's PV screening outcome — for the roof-plan (shade by `annualKwh`,
 *  grey the unsuitable). The total in {@link computePotential} sums the suitable ones. */
export interface RoofEval {
  surface: RoofSurface;
  /** Passed the suitability screen (not a wall, not strongly north-facing). */
  suitable: boolean;
  usableAreaM2: number;
  kwp: number;
  annualKwh: number;
  /** Nearest compass point of the surface azimuth (N/NE/…/NW). */
  orientation: string;
}

/** A building's rooftop-PV potential (the modelled estimate over its roof geometry). */
export interface RoofPotential {
  suitableAreaM2: number;
  installableKwp: number;
  annualKwh: number;
  /** Dominant suitable-roof orientation (N/NE/…/NW), or "". */
  dominantOrientation: string;
}

function floorMod(a: number, m: number): number {
  return a - m * Math.floor(a / m);
}

function round(v: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(v * f) / f;
}

interface Eval {
  usableArea: number;
  kwp: number;
  kwh: number;
}

/** A single suitable roof's contribution, or `null` if excluded. */
function evaluateRoof(r: RoofSurface): Eval | null {
  const tilt = r.tiltDeg;
  if (tilt > MAX_TILT) return null;
  let effTilt: number;
  let effAspect: number;
  let flat: boolean;
  if (tilt <= FLAT_TILT) {
    effTilt = FLAT_PV_TILT;
    effAspect = FLAT_PV_ASPECT;
    flat = true;
  } else {
    const a = lod2ToPvgisAspect(r.azimuthDeg);
    // north exclusion for pitched roofs: |distance of the pvgis aspect from N|
    const northDist = Math.abs(floorMod(a - 180 + 180, 360) - 180);
    if (northDist <= NORTH_EXCL_HALF) return null;
    effTilt = tilt;
    effAspect = a;
    flat = false;
  }
  const usable = r.areaM2 * USABLE_FRAC * (flat ? FLAT_ROW_SPACING : 1.0);
  const kwp = usable * MODULE_KWP_PER_M2;
  const kwh = kwp * specificYield(effTilt, effAspect);
  return { usableArea: usable, kwp, kwh };
}

/** Nearest of the 8 compass points to a LoD2 azimuth (0=N · 90=E · 180=S · 270=W). */
export function dominantOrientation(azimuth: number): string {
  const deg = [0, 45, 90, 135, 180, 225, 270, 315, 360];
  const lab = ["N", "NE", "E", "SE", "S", "SW", "W", "NW", "N"];
  let best = 0;
  let bestDelta = Number.MAX_VALUE;
  for (let i = 0; i < deg.length; i++) {
    const d = Math.abs(deg[i] - azimuth);
    if (d < bestDelta) {
      bestDelta = d;
      best = i;
    }
  }
  return lab[best];
}

/**
 * Aggregate a building's suitable roofs into its rooftop-PV potential, rounded as the
 * wrapper does (area→1dp, kWp→2dp, kWh→0dp). `null` when no roof is suitable.
 *
 * Location-independent: the bundled PVGIS table is the pilot's single cell, so (lat, lon)
 * do not enter here (the wrapper's per-cell refinement is out of scope — see pvgisGrid.ts).
 */
export function computePotential(roofs: readonly RoofSurface[]): RoofPotential | null {
  let sArea = 0;
  let sKwp = 0;
  let sKwh = 0;
  let bestArea = -1;
  let bestAzimuth = 0;
  let haveBest = false;
  for (const r of roofs) {
    const ev = evaluateRoof(r);
    if (!ev) continue;
    sArea += ev.usableArea;
    sKwp += ev.kwp;
    sKwh += ev.kwh;
    if (!haveBest || r.areaM2 > bestArea) {
      bestArea = r.areaM2;
      bestAzimuth = r.azimuthDeg;
      haveBest = true;
    }
  }
  if (sKwp <= 0) return null;
  return {
    suitableAreaM2: round(sArea, 1),
    installableKwp: round(sKwp, 2),
    annualKwh: round(sKwh, 0),
    dominantOrientation: haveBest ? dominantOrientation(bestAzimuth) : "",
  };
}

/**
 * Per-surface screening for the roof-plan — one {@link RoofEval} per surface, in input
 * order, so the plan can draw each footprint and shade it by `annualKwh` (unsuitable → grey).
 * Same screen as {@link computePotential}; pure.
 */
export function evaluateRoofs(roofs: readonly RoofSurface[]): RoofEval[] {
  return roofs.map((surface) => {
    const ev = evaluateRoof(surface);
    return {
      surface,
      suitable: ev != null,
      usableAreaM2: ev ? round(ev.usableArea, 1) : 0,
      kwp: ev ? round(ev.kwp, 2) : 0,
      annualKwh: ev ? round(ev.kwh, 0) : 0,
      orientation: dominantOrientation(surface.azimuthDeg),
    };
  });
}
