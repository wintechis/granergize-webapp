// Generate authoritative MUI CSS custom properties from the app theme, for the
// design-sync tokens stylesheet (cfg.cssEntry). Deterministic from src/theme.ts —
// re-run on re-sync (it's listed as cfg.buildCmd). MUI v9 cssVariables mode.
import theme from "../src/theme.ts";
import {
  ELECTRICITY_COLOR,
  ENERGY_ABOVE_AVG_COLOR,
  ENERGY_BELOW_AVG_COLOR,
  ENERGY_TYPICAL_COLOR,
  GENERATION_COLOR,
  HEAT_COLOR,
  MAGNITUDE_HIGH_COLOR,
  MAGNITUDE_LOW_COLOR,
  MAGNITUDE_MID_COLOR,
  MARKER_NO_DATA_COLOR,
  MARKER_OPEN_COLOR,
  MARKER_OWNED_COLOR,
  MARKER_SHARED_COLOR,
  PLANNED_COLOR,
  RENEWABLE_COLOR,
  TREND_FLAT_COLOR,
  TREND_IMPROVING_COLOR,
  TREND_WORSENING_COLOR,
  WASTEWATER_COLOR,
  WATER_COLOR,
} from "../src/constants/chartColors.ts";
const t = theme as unknown as {
  generateStyleSheets: () => Array<Record<string, Record<string, unknown>>>;
};
let css = "/* Granergize theme tokens — generated from src/theme.ts (MUI cssVariables).\n" +
  "   Do not edit by hand; re-run `deno task ds:tokens`. */\n\n";
for (const sheet of t.generateStyleSheets()) {
  for (const [selector, decls] of Object.entries(sheet)) {
    if (!decls || typeof decls !== "object") continue;
    const body = Object.entries(decls)
      .filter(([, v]) => typeof v === "string" || typeof v === "number")
      .map(([k, v]) => `  ${k}: ${v};`)
      .join("\n");
    if (body) css += `${selector} {\n${body}\n}\n\n`;
  }
}
// Feature design tokens beyond the MUI palette: the visual language of the map,
// energy-lens, year-over-year trend, regional-statistics choropleth (magnitude
// ramp) and per-metric charts (src/constants/chartColors.ts) — exposed as CSS
// custom properties so designs reuse the EXACT ramps rather than re-guessing them.
const featureTokens: Record<string, string> = {
  "--gr-marker-owned": MARKER_OWNED_COLOR,
  "--gr-marker-shared": MARKER_SHARED_COLOR,
  "--gr-marker-open": MARKER_OPEN_COLOR,
  "--gr-marker-no-data": MARKER_NO_DATA_COLOR,
  "--gr-energy-below": ENERGY_BELOW_AVG_COLOR,
  "--gr-energy-typical": ENERGY_TYPICAL_COLOR,
  "--gr-energy-above": ENERGY_ABOVE_AVG_COLOR,
  "--gr-trend-improving": TREND_IMPROVING_COLOR,
  "--gr-trend-flat": TREND_FLAT_COLOR,
  "--gr-trend-worsening": TREND_WORSENING_COLOR,
  "--gr-magnitude-low": MAGNITUDE_LOW_COLOR,
  "--gr-magnitude-mid": MAGNITUDE_MID_COLOR,
  "--gr-magnitude-high": MAGNITUDE_HIGH_COLOR,
  "--gr-metric-electricity": ELECTRICITY_COLOR,
  "--gr-metric-heat": HEAT_COLOR,
  "--gr-metric-water": WATER_COLOR,
  "--gr-metric-wastewater": WASTEWATER_COLOR,
  "--gr-metric-renewable": RENEWABLE_COLOR,
  "--gr-metric-generation": GENERATION_COLOR,
  "--gr-metric-planned": PLANNED_COLOR,
};
css += "/* Granergize feature tokens — map markers, energy lens, trend lens,\n" +
  "   regional-statistics choropleth magnitude ramp, and per-metric chart\n" +
  "   colours (src/constants/chartColors.ts). */\n";
css += ":root {\n" +
  Object.entries(featureTokens).map(([k, v]) => `  ${k}: ${v};`).join("\n") +
  "\n}\n\n";

await Deno.writeTextFile(new URL("./theme-tokens.css", import.meta.url), css);
console.log(`wrote theme-tokens.css (${css.length} bytes)`);
