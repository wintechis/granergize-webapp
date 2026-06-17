import type { MessageId } from "../lib/messages.ts";

/**
 * Provenance **source tiers** a finder collection can union (the
 * `owned`/`granted`/`open` ladder, in-hand half for now — `open`/Public lands with
 * plan-finder-collection-model Slice 6/7). The collection = ⋃ of the ticked tiers;
 * a building's tier is own (`mine`) vs shared-with-me (`shared`).
 */
export const TIER_VALUES = ["mine", "shared"] as const;
export type Tier = typeof TIER_VALUES[number];

/** i18n label per tier (the multi-select source selector). */
export const TIER_LABEL: Record<Tier, MessageId> = {
  mine: "tierMine",
  shared: "tierShared",
};
