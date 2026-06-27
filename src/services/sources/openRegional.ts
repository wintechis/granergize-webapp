/**
 * The **`open` source tier** of the Aggregations finder: public
 * `linked-regionalstatistik` datasets, surfaced as browseable aggregation-like
 * items keyed to the regions of the user's own buildings. Pure + offline — the
 * derivation is in-memory over already-loaded buildings (no network in the
 * finder list; the figures themselves load on the detail page).
 *
 * Scope: **Bundesland (`land`) grain only** — derivable cheaply from a building's
 * `region` field via {@link bundeslandToAgs}. Kreis-grain tables need a
 * reverse-geocode (the nearby-MaStR Kreis), so they stay on the per-building
 * Regional-context section and are intentionally not listed here.
 */
import type { Building } from "../../types.ts";
import type { MessageId } from "../../lib/messages.ts";
import { BUNDESLAND_AGS_ALL, bundeslandName, bundeslandToAgs } from "./region.ts";
import { REGIONAL_TABLES } from "./regionalCube.ts";

/** One public regional-statistics dataset = a (table × Bundesland) pair. */
export interface OpenRegionalItem {
  /** Stable id `{tableId}__{ags}` — the detail route's key. */
  id: string;
  /** GENESIS table id (resolves back to a {@link RegionalTable}). */
  tableId: string;
  /** Catalog id for the human metric label. */
  labelId: MessageId;
  /** The region's 2-digit Bundesland AGS. */
  ags: string;
  /** Canonical Bundesland name (display). */
  region: string;
}

/** The `{tableId}__{ags}` id encoding a (table, region) pair. */
export function openRegionalId(tableId: string, ags: string): string {
  return `${tableId}__${ags}`;
}

/**
 * The `open`-tier datasets for a user: every `land`-grain regional table crossed
 * with the distinct Bundesländer of their buildings (sorted by AGS, then table
 * order). When no building yields a recognised German region — a fresh / buildingless
 * account — it falls back to **all 16 Bundesländer**, so the public datasets are
 * always browseable without first adding a building.
 */
export function openRegionalItemsFromBuildings(
  buildings: Building[],
): OpenRegionalItem[] {
  const landTables = REGIONAL_TABLES.filter((t) => t.grain === "land");

  const agsSet = new Set<string>();
  for (const b of buildings) {
    const ags = bundeslandToAgs(b.region);
    if (ags) agsSet.add(ags);
  }
  // Building regions when there are any; otherwise the whole country as a catalog.
  const agsList = agsSet.size > 0 ? [...agsSet].sort() : [...BUNDESLAND_AGS_ALL];

  const items: OpenRegionalItem[] = [];
  for (const ags of agsList) {
    const region = bundeslandName(ags) ?? ags;
    for (const table of landTables) {
      items.push({
        id: openRegionalId(table.tableId, ags),
        tableId: table.tableId,
        labelId: table.labelId,
        ags,
        region,
      });
    }
  }
  return items;
}
