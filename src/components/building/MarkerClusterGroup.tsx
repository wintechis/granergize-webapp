import { type ReactNode } from "react";
import L from "leaflet";
import "leaflet.markercluster";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";
import {
  createElementObject,
  createPathComponent,
  extendContext,
} from "@react-leaflet/core";
import { clusterStyle } from "./markerClusterTint.ts";

/**
 * Build the bubble for a cluster, tinted by its children (`markerClusterTint`): an
 * energy cluster shows its dominant band's colour, an ownership cluster a neutral bubble.
 * The inner `<div><span>` matches `MarkerCluster.Default.css`'s layout; the colour is
 * inline (Default.css only colours via its default size-classes, which our custom
 * `iconCreateFunction` doesn't add — so only this inline fill applies).
 */
function clusterIcon(cluster: L.MarkerCluster): L.DivIcon {
  const count = cluster.getChildCount();
  const classNames = cluster
    .getAllChildMarkers()
    .map((m) => m.options.icon?.options.className ?? "");
  const { color, className } = clusterStyle(classNames);
  return L.divIcon({
    html: `<div style="background:${color};color:#fff"><span>${count}</span></div>`,
    className: `marker-cluster ${className}`,
    iconSize: L.point(40, 40),
  });
}

interface MarkerClusterGroupProps {
  children?: ReactNode;
  eventHandlers?: L.LeafletEventHandlerFnMap;
}

/**
 * A react-leaflet v5 layer that collapses dense markers into count bubbles
 * (`leaflet.markercluster`), built with `@react-leaflet/core` (no first-class v5 wrapper
 * exists) — the same custom-layer pattern as `region/MagnitudeChoroplethLayer`. It swaps
 * the child `layerContainer` to the cluster group, so the existing `<Marker>`/
 * `<BuildingMarker>` children mount **into** the cluster with no change to their icon,
 * tooltip, click handler, or per-marker hooks. Re-tint by remounting with a `key`.
 */
const MarkerClusterGroup = createPathComponent<
  L.MarkerClusterGroup,
  MarkerClusterGroupProps
>(function createMarkerClusterGroup(_props, context) {
  // `children`/`eventHandlers`/`ref` are handled by the HOC; the group's options are fixed.
  const clusterGroup = L.markerClusterGroup({
    showCoverageOnHover: false,
    spiderfyOnMaxZoom: true,
    // Instant merge/split (no zoom/spiderfy animation). The animated path can orphan the
    // individual marker icons when crossing the `disableClusteringAtZoom` boundary under
    // rapid zoom (they linger beside the new cluster bubble); disabling it keeps the
    // cluster⇄markers transition deterministic.
    animate: false,
    maxClusterRadius: 60,
    disableClusteringAtZoom: 16,
    iconCreateFunction: clusterIcon,
  });
  return createElementObject(
    clusterGroup,
    extendContext(context, { layerContainer: clusterGroup }),
  );
});

export default MarkerClusterGroup;
