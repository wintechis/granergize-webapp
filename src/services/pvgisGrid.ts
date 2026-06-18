/**
 * PVGIS specific-yield lookup (kWh per kWp per year) by roof tilt + aspect — the TS port
 * of `PvgisGrid` from the linked-lod2-by wrapper, moved into the app as part of untangling
 * the rooftop-PV calculation out of the wrapper (see plans/plan-lod2-pv-calc-to-app.md).
 *
 * Single default cell (the bundled {@link PVGIS_GRID}); over a city the irradiation field
 * is flat enough that one sampled table serves the region. The per-km-cell refinement
 * (`pvgis_grid_cells.json`) is out of scope here.
 *
 * PVGIS aspect convention: 0=S · −90=E · +90=W · ±180=N. LoD2 `Dachorientierung` is
 * 0=N · 90=E · 180=S · 270=W, converted by {@link lod2ToPvgisAspect}.
 */
import { PVGIS_GRID } from "./pvgisGridData.ts";

const TILTS: readonly number[] = PVGIS_GRID.tilts;
const ASPECTS: readonly number[] = PVGIS_GRID.aspects;
const GRID = PVGIS_GRID.grid as Record<string, number>;

/** Floored modulo (Python `%` semantics) for doubles. */
function floorMod(a: number, m: number): number {
  return a - m * Math.floor(a / m);
}

/** LoD2 `Dachorientierung` (0=N,90=E,180=S,270=W) → PVGIS aspect (0=S,±180=N). */
export function lod2ToPvgisAspect(dachorientierung: number): number {
  return floorMod(dachorientierung - 180 + 180, 360) - 180;
}

/** `[lo, hi, frac]` for `x` over the ascending axis `vals`. */
function interpAxis(vals: readonly number[], x: number): [number, number, number] {
  if (x <= vals[0]) return [vals[0], vals[0], 0];
  if (x >= vals[vals.length - 1]) {
    return [vals[vals.length - 1], vals[vals.length - 1], 0];
  }
  let i = 0;
  while (i + 1 < vals.length && vals[i + 1] <= x) i++;
  const lo = vals[i];
  const hi = vals[i + 1];
  return [lo, hi, hi !== lo ? (x - lo) / (hi - lo) : 0];
}

function cell(t: number, a: number): number {
  const v = GRID[`${t},${a}`];
  if (v === undefined) throw new Error(`missing grid cell ${t},${a}`);
  return v;
}

/** Specific yield [kWh/kWp/yr] for a (tilt, PVGIS-aspect), bilinear over the bundled grid. */
export function specificYield(tilt: number, aspect: number): number {
  const a = floorMod(aspect + 180, 360) - 180; // normalise to [-180,180)
  const [t0, t1, ft] = interpAxis(TILTS, tilt);
  const [a0, a1, fa] = interpAxis(ASPECTS, a);
  const top = cell(t0, a0) * (1 - fa) + cell(t0, a1) * fa;
  const bot = cell(t1, a0) * (1 - fa) + cell(t1, a1) * fa;
  return top * (1 - ft) + bot * ft;
}
