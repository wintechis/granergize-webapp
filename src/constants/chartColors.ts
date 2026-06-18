/**
 * Shared ColorBrewer-derived palette used across bar charts throughout the app.
 * Centralised here so all charts stay visually consistent.
 */
export const CHART_COLOR_PALETTE: string[] = [
  "rgba(166, 206, 227, 1)",
  "rgba(31, 120, 180, 1)",
  "rgba(178, 223, 138, 1)",
  "rgba(51, 160, 44, 1)",
  "rgba(251, 154, 153, 1)",
  "rgba(227, 26, 28, 1)",
  "rgba(253, 191, 111, 1)",
  "rgba(255, 127, 0, 1)",
  "rgba(202, 178, 214, 1)",
  "rgba(106, 61, 154, 1)",
  "rgba(255, 255, 153, 1)",
  "rgba(177, 89, 40, 1)",
];

/** The brand primary — consumed by theme.palette.primary.main AND non-MUI
 * surfaces that can't import the theme (the XLSX export's title band runs
 * under `deno test`, where MUI doesn't load). One hex, derived everywhere. */
export const BRAND_PRIMARY = "#0277bd";

/** Owned building markers — the brand primary: your buildings wear the app's colour. */
export const MARKER_OWNED_COLOR = BRAND_PRIMARY;

/** Buildings shared with the user — a warm orange. With the owned blue this is
 * the classic colourblind-safe complementary pair (the old red/green was the
 * worst pair for deuteranopia), and deliberately NOT the energy lens's pale
 * green/amber/red, so the two lenses can't be read into each other. */
export const MARKER_SHARED_COLOR = "#ef6c00";

/** Public open-data items (the Aggregations finder's third source tier) — a
 * green, distinct from the owned blue / shared orange and from the energy
 * lens's pale tints, so the source selector's colour key reads cleanly. */
export const MARKER_OPEN_COLOR = "#2e7d32";

/**
 * Heat-map tints for the energy comparison grid (below / above the average),
 * saturated by the deviation via `alpha()`. A deliberately PALE pair (not the
 * theme's dark success/error mains, which would tint the cells too heavily);
 * centralised here so the two cells stay in step rather than drifting as inline
 * literals.
 */
export const ENERGY_BELOW_AVG_COLOR = "#a5d6a7"; // pale green
export const ENERGY_ABOVE_AVG_COLOR = "#ef9a9a"; // pale red

/**
 * Map energy-lens marker palette. The three categories reuse the heat-map pair
 * above (efficient = below-average green, inefficient = above-average red) plus
 * a pale amber for the typical middle band; buildings with no usable energy /
 * area figure fall back to a neutral grey. Kept beside the grid tints so the
 * map and the energy comparison stay visually in step.
 */
export const ENERGY_TYPICAL_COLOR = "#ffcc80"; // pale amber
export const MARKER_NO_DATA_COLOR = "#bdbdbd"; // neutral grey

/**
 * Map **trend-lens** palette (year-over-year change, Step 3 of plan-cube-ui).
 * A colourblind-safe DIVERGING pair — blue (improving) ↔ orange/brown
 * (worsening) — deliberately the blue/orange family rather than the energy
 * lens's green/amber/red tier palette, so a "got better" marker can't be misread
 * as the "efficient" tier. Flat sits at a neutral grey midpoint; a building
 * without two comparable years (no trend) falls back to `MARKER_NO_DATA_COLOR`.
 * (ColorBrewer-derived divergent blue↔orange, the standard deuteranopia-safe
 * sequential-diverging hues.)
 */
export const TREND_IMPROVING_COLOR = "#2c7fb8"; // blue — intensity fell
export const TREND_FLAT_COLOR = "#cccccc"; // neutral grey — little change
export const TREND_WORSENING_COLOR = "#d95f02"; // orange/brown — intensity rose

/**
 * Map/heatmap **magnitude** ramp (Step "metric selector" of plan-cube-ui): a NEUTRAL
 * sequential ramp for non-consumption metrics (electricity generation). Unlike the
 * energy tier palette (green = good, red = bad), a generation magnitude carries NO
 * value judgement — more PV output is not "inefficient" — so this is a single-hue
 * light→dark blue ramp (ColorBrewer "Blues"), read as "low → high", not good/bad.
 * Buildings with no figure reuse the neutral `MARKER_NO_DATA_COLOR`.
 */
export const MAGNITUDE_LOW_COLOR = "#bdd7e7"; // light blue — lower output
export const MAGNITUDE_MID_COLOR = "#6baed6"; // mid blue
export const MAGNITUDE_HIGH_COLOR = "#2171b5"; // dark blue — higher output

/**
 * Per-metric bar colours for the annual energy charts (AnnualEnergy), drawn from the ColorBrewer palette above at reduced alpha;
 * centralised so the same metric keeps the same colour on every page.
 */
export const ELECTRICITY_COLOR = "rgba(31, 120, 180, 0.8)";
export const HEAT_COLOR = "rgba(227, 26, 28, 0.8)";
export const WATER_COLOR = "rgba(51, 160, 44, 0.8)";
export const WASTEWATER_COLOR = "rgba(0, 150, 136, 0.8)";
export const RENEWABLE_COLOR = "rgba(178, 223, 138, 0.9)";
export const GENERATION_COLOR = "rgba(255, 127, 0, 0.8)";
// Planned (Soll) figures — one neutral colour across metrics, shown beside actual.
export const PLANNED_COLOR = "rgba(120, 120, 120, 0.55)";
