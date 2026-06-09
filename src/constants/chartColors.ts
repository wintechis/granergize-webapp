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
