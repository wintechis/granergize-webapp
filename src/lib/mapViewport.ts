/**
 * The last map viewport (centre + zoom) as **preserved component state**
 * (notes/ui-state.md §Preserved component state): it survives the finder's unmount on a
 * detail drill so the map restores to exactly where it was instead of re-fitting to all
 * buildings — WITHOUT being serialized to the URL (the exact view is worthless to a
 * reload or a shared link). A module singleton, mirroring `networkActivity`/`devMode`.
 *
 * Read once on the map's (re-)mount to restore; written on every pan/zoom settle. The
 * `?c`/`?z` URL params stay, but only as an optional deep-link SEED — not as the
 * in-session restore mechanism, which was fragile (a fresh map's default-centre move
 * could clobber/race the saved params, snapping back to the all-buildings fit). The
 * open-data fetch no longer keys on them — it anchors to the user's own buildings
 * (`ownDataAnchor`, the concentric ring; see notes/data-architecture.md).
 */
import type { MapCentre } from "../services/openBuildings.ts";

let stored: { centre: MapCentre; zoom: number } | null = null;

/** Remember the current viewport (called on the map's pan/zoom settle). */
export function setStoredViewport(centre: MapCentre, zoom: number): void {
  stored = { centre, zoom };
}

/** The last remembered viewport, or null if the map hasn't moved yet this session. */
export function getStoredViewport(): { centre: MapCentre; zoom: number } | null {
  return stored;
}
