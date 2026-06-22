import type { MessageId } from "../lib/messages.ts";
import {
  MARKER_OPEN_COLOR,
  MARKER_OWNED_COLOR,
  MARKER_SHARED_COLOR,
} from "./chartColors.ts";

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

/** The Observations finder's tiers — own + shared-with-me + open, for parity with the
 *  other finders. `open` is currently **empty**: the collection is the user's owned +
 *  shared buildings, and open/MaStR buildings carry no Pod energy observations yet
 *  (open energy is otherwise region-level → the Aggregations finder). The tier stays
 *  offered so the affordance is consistent and ready if per-building open energy lands. */
export const OBSERVATION_TIERS: readonly Tier[] = ["mine", "shared", "open"];

/** The Aggregations finder's tiers — own + shared-with-me + public open data. */
export const AGGREGATION_TIERS: readonly Tier[] = ["mine", "shared", "open"];

/** i18n label per tier (the multi-select source selector). */
export const TIER_LABEL: Record<Tier, MessageId> = {
  mine: "tierMine",
  shared: "tierShared",
  open: "tierOpen",
};

/**
 * Swatch colour per tier — the SAME colours the map markers wear (mine = owned
 * blue, shared = orange, open = green). The source selector shows these dots so
 * it doubles as the colour key, replacing the separate map legend that used to
 * repeat "My buildings / Shared with me".
 */
export const TIER_COLOR: Record<Tier, string> = {
  mine: MARKER_OWNED_COLOR,
  shared: MARKER_SHARED_COLOR,
  open: MARKER_OPEN_COLOR,
};
