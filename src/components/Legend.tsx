import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import type { MetricFraming } from "../services/energy/energyMetric.ts";
import { bandColor, bandLabelKey, legendBands } from "../constants/lensBand.ts";
import { useT } from "../context/I18nProvider.tsx";

/**
 * The colour **key** shared by every view that colours by a band — the map's energy
 * lens, the choropleths, the roof plan and the over-time heatmap. One ordered list of
 * (colour, label) pairs; nothing else. The same key was written twice before (the
 * floating map legend and the choropleth legend), which is how they drifted apart.
 *
 * It deliberately knows nothing about *placement*: a legend that floats in a map
 * corner is `MagnitudeLegend` (which wraps this in its positioned paper), while an
 * inline key under a grid renders this directly. Pushing a
 * `variant="floating" | "inline"` in here would give a colour key opinions about maps.
 *
 * The two style props are semantic, not cosmetic: `shape` mirrors the **mark being
 * explained** — a filled area (heatmap cell, choropleth polygon, roof facet) is a
 * square, a point mark (map marker, trend dot) is a dot — and `row` says the key sits
 * beside its chart rather than stacked in a corner.
 */

export interface LegendKeyItem {
  color: string;
  /** Already-resolved label text (callers hold the `useT()` they need). */
  label: string;
}

export interface LegendKeysProps {
  items: readonly LegendKeyItem[];
  /** Swatch shape — mirror the mark being explained (area → square, point → dot). */
  shape?: "square" | "dot";
  /** Lay the keys out horizontally (an inline key under a chart) instead of stacked. */
  row?: boolean;
  /** Leading group label, for a legend that carries more than one key set. */
  title?: string;
}

export function LegendKeys(
  { items, shape = "square", row = false, title }: LegendKeysProps,
) {
  const square = shape === "square";
  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: row ? "row" : "column",
        flexWrap: row ? "wrap" : undefined,
        alignItems: row ? "center" : undefined,
        gap: row ? 1.5 : 0.5,
      }}
    >
      {title && (
        <Typography variant="caption" color="text.secondary">{title}</Typography>
      )}
      {items.map((item) => (
        <Box
          key={item.label}
          sx={{ display: "flex", alignItems: "center", gap: 0.75 }}
        >
          <Box
            sx={{
              width: square ? 14 : 10,
              height: square ? 14 : 10,
              backgroundColor: item.color,
              borderRadius: square ? 0.5 : "50%",
              border: square ? "1px solid" : undefined,
              borderColor: square ? "divider" : undefined,
              flexShrink: 0,
            }}
          />
          <Typography variant="caption">{item.label}</Typography>
        </Box>
      ))}
    </Box>
  );
}

/**
 * The band keys for a framing — `legendBands` order (best/lowest first, "no data"
 * last), labels resolved through the catalog. Every band legend in the app goes
 * through here, so the map and the heatmap can't list different bands.
 */
export function BandKeys(
  { framing, ...rest }: { framing: MetricFraming } & Omit<LegendKeysProps, "items">,
) {
  const t = useT();
  const items = legendBands(framing).map((band) => ({
    color: bandColor(band, framing),
    label: t(bandLabelKey(band, framing)),
  }));
  return <LegendKeys items={items} {...rest} />;
}
