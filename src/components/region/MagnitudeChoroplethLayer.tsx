/**
 * A react-leaflet GeoJSON layer that shades AGS-keyed regions by a magnitude band —
 * the shared core of every region choropleth (the building's neighbourhood map and
 * the standalone/embedded regional-metrics map). The consumer supplies the features,
 * a per-feature band, and a lazily-built tooltip; this owns the Leaflet plumbing that
 * was previously copied in each map: the band→colour `style`, the on-open tooltip
 * (read through a ref so values that arrive after mount still show), the restyle when
 * values finish loading, and the remount key (react-leaflet `GeoJSON` ignores
 * data-prop changes, so geometry/level changes must remount).
 */
import { useEffect, useRef } from "react";
import { GeoJSON } from "react-leaflet";
import type L from "leaflet";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import type { Layer, PathOptions } from "leaflet";
import type { LensBand } from "../../services/energy/energyTimeCut.ts";
import type { MetricFraming } from "../../services/energy/energyMetric.ts";
import { bandColor } from "../../constants/lensBand.ts";
import type {
  RegionFeatureCollection,
  RegionFeatureProps,
} from "../../services/regionGeometry.ts";

interface Props {
  /** The regions to draw (already normalised to carry `ags`). */
  data: RegionFeatureCollection;
  /** The band a feature shades to ("none" → the no-data grey). */
  bandOf: (props: RegionFeatureProps) => LensBand;
  /** The HTML tooltip for a feature, resolved on hover (so late-arriving values show). */
  tooltip: (props: RegionFeatureProps) => string;
  /** Tier vs neutral-magnitude colour ramp. */
  framing: MetricFraming;
  /** Remount the layer when this changes (grain / scoped area). */
  remountKey: string;
  /** Restyle the mounted layer when this changes (e.g. values finished loading). */
  styleVersion: number | string;
}

export default function MagnitudeChoroplethLayer(
  { data, bandOf, tooltip, framing, remountKey, styleVersion }: Props,
) {
  const style = (
    feature?: Feature<Geometry, RegionFeatureProps>,
  ): PathOptions => ({
    fillColor: bandColor(feature ? bandOf(feature.properties) : "none", framing),
    fillOpacity: 0.7,
    color: "#555",
    weight: 1,
  });

  // Tooltip + restyle read the LATEST props through refs, so a value (or band)
  // that resolves after the layer mounts is reflected without rebinding/remounting.
  const tipRef = useRef(tooltip);
  useEffect(() => {
    tipRef.current = tooltip;
  });

  const layerRef = useRef<L.GeoJSON | null>(null);
  useEffect(() => {
    layerRef.current?.setStyle(style as (f?: Feature) => PathOptions);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [styleVersion]);

  return (
    <GeoJSON
      key={remountKey}
      ref={layerRef}
      data={data as unknown as FeatureCollection}
      style={style as (f?: Feature) => PathOptions}
      onEachFeature={((feature: Feature<Geometry, RegionFeatureProps>, layer: Layer) =>
        layer.bindTooltip(() => tipRef.current(feature.properties), {
          sticky: true,
        })) as (f: Feature, l: Layer) => void}
    />
  );
}
