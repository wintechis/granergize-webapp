import Box from "@mui/material/Box";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import type { ListFacet } from "../hooks/useListFacet.ts";
import { useT } from "../context/I18nProvider.tsx";
import {
  type Tier,
  TIER_COLOR,
  TIER_LABEL,
  TIER_VALUES,
} from "../constants/tiers.ts";

/**
 * The multi-select source-tier selector (plan-finder-collection-model Slice 2): tick
 * which provenance tiers (Mine / Shared with me) to **union** into the finder. A
 * `ToggleButtonGroup` in multi-select mode — compact like the Map/List view toggle,
 * but additive (checkbox semantics). State is the URL-backed {@link ListFacet}; the
 * last tier can't be unticked (the hook guards an empty union).
 *
 * Each option carries its tier's marker colour as a dot, so this control doubles
 * as the colour key — it replaces the separate map legend that used to repeat the
 * same "My buildings / Shared with me" swatches.
 */
export default function TierFilter(
  { facet, options = TIER_VALUES }: { facet: ListFacet; options?: readonly Tier[] },
) {
  const t = useT();
  return (
    <ToggleButtonGroup
      size="small"
      value={facet.selected}
      onChange={(_, values: string[]) => facet.replace(values)}
      aria-label={t("tierFilterAria")}
    >
      {options.map((tier) => (
        <ToggleButton key={tier} value={tier} sx={{ gap: 0.75 }}>
          <Box
            component="span"
            sx={{
              width: 10,
              height: 10,
              borderRadius: "50%",
              backgroundColor: TIER_COLOR[tier],
              flexShrink: 0,
            }}
          />
          {t(TIER_LABEL[tier])}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  );
}
