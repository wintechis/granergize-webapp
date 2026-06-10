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

/** Aligned with theme.palette.primary.main — owned building markers / primary actions */
export const MARKER_OWNED_COLOR = "#ca2f44";

/** Aligned with theme.palette.secondary.main — buildings shared with the user */
export const MARKER_SHARED_COLOR = "#388e3c";

/** Gold glow border applied to the selected building marker */
export const MARKER_SELECTED_COLOR = "#FFD700";

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
 * Per-metric bar colours for the annual energy charts (AnnualEnergy), drawn from the ColorBrewer palette above at reduced alpha;
 * centralised so the same metric keeps the same colour on every page.
 */
export const ELECTRICITY_COLOR = "rgba(31, 120, 180, 0.8)";
export const HEAT_COLOR = "rgba(227, 26, 28, 0.8)";
export const WATER_COLOR = "rgba(51, 160, 44, 0.8)";
export const WASTEWATER_COLOR = "rgba(0, 150, 136, 0.8)";
export const RENEWABLE_COLOR = "rgba(178, 223, 138, 0.9)";
// Planned (Soll) figures — one neutral colour across metrics, shown beside actual.
export const PLANNED_COLOR = "rgba(120, 120, 120, 0.55)";
