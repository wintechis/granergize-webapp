import type { MessageId } from "../lib/messages.ts";

/**
 * Provenance **source tiers** a finder collection can union (the
 * `owned`/`granted`/`open` ladder). The collection = ⋃ of the ticked tiers; an
 * item's tier is own (`mine`), shared-with-me (`shared`), or public open-data
 * (`open`). Not every finder offers every tier — each passes its own subset
 * (below): the Buildings finder is `mine`/`shared`; the Aggregations finder adds
 * `open` (public regionalstatistik datasets, keyed to the user's regions).
 */
export const TIER_VALUES = ["mine", "shared", "open"] as const;
export type Tier = typeof TIER_VALUES[number];

/** The Buildings finder's tiers — own + shared-with-me (no open source yet). */
export const BUILDING_TIERS: readonly Tier[] = ["mine", "shared"];

/** The Aggregations finder's tiers — own + shared-with-me + public open data. */
export const AGGREGATION_TIERS: readonly Tier[] = ["mine", "shared", "open"];

/** i18n label per tier (the multi-select source selector). */
export const TIER_LABEL: Record<Tier, MessageId> = {
  mine: "tierMine",
  shared: "tierShared",
  open: "tierOpen",
};
