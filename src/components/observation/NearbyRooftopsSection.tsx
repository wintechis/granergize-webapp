import { useState } from "react";
import {
  Box,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import RoofingIcon from "@mui/icons-material/Roofing";
import type { BuildingType } from "../../types.ts";
import NearbyRooftopsMap from "./NearbyRooftopsMap.tsx";
import MagnitudeLegend from "../region/MagnitudeLegend.tsx";
import { useNearbyRooftopGeometry, useNearbyRooftops } from "../../hooks/lod2Rooftop.ts";
import {
  NEARBY_ROOFTOP_RADIUS_M,
  rooftopPointUrl,
} from "../../services/lod2Rooftop.ts";
import { RdfSourceLink } from "../detail/DetailView.tsx";
import Pager from "../Pager.tsx";
import { usePaging } from "../../hooks/usePaging.ts";
import { ellipsis, listStyle, rowStyle } from "../../constants/listStyles.ts";
import { useT } from "../../context/I18nProvider.tsx";

/**
 * NEARBY ROOFTOP-PV POTENTIAL: the installable rooftop solar of the buildings around this
 * one, from `linked-lod2-by` — the rooftop sibling of {@link NearbyInstallationsSection}
 * (which shows the actual MaStR generation units). Each nearby building's installable kWp
 * comes straight from the wrapper's `point` summary (no per-building deref). Best-effort:
 * renders nothing when the building has no coordinates or the area is outside the LoD2-BY
 * dump's coverage (currently the Nuremberg pilot). The point query IRI is a Developer-mode
 * source link (`RdfSourceLink` self-hides).
 */
export default function NearbyRooftopsSection(
  { building }: { building: BuildingType },
) {
  const t = useT();
  const rooftops = useNearbyRooftops(building).data ?? [];
  const paging = usePaging(rooftops, { key: "nr" });
  // List ⇄ Map guise of the same nearby set (local, non-URL state; List default).
  const [view, setView] = useState<"list" | "map">("list");
  // Footprint geometry is deref-heavy (one request per building), so fetch it only once the
  // map view is opened. While it loads, show the cheap point summary as dots (roofs: []).
  const geometry = useNearbyRooftopGeometry(building, view === "map").data;
  const mapItems = geometry ?? rooftops.map((r) => ({ ...r, roofs: [] }));

  if (rooftops.length === 0) return null;

  const totalKwp = rooftops.reduce((s, r) => s + r.installableKwp, 0);

  return (
    <Stack spacing={2}>
      <Stack
        direction="row"
        spacing={1}
        sx={{ alignItems: "center", flexWrap: "wrap" }}
      >
        <RoofingIcon color="action" />
        <Typography variant="h6">{t("nrTitle")}</Typography>
        <Box sx={{ flexGrow: 1 }} />
        <ToggleButtonGroup
          size="small"
          exclusive
          value={view}
          onChange={(_e, next) => {
            if (next) setView(next); // ignore deselect of the active button
          }}
          aria-label={t("nrViewAria")}
        >
          <ToggleButton value="list">{t("btnList")}</ToggleButton>
          <ToggleButton value="map">{t("btnMap")}</ToggleButton>
        </ToggleButtonGroup>
      </Stack>

      <Typography variant="body2" color="text.secondary">
        {t("nrSummary", {
          count: rooftops.length,
          radius: NEARBY_ROOFTOP_RADIUS_M,
          kwp: Math.round(totalKwp),
        })}
      </Typography>

      {view === "map"
        ? (
          <>
            <NearbyRooftopsMap building={building} rooftops={mapItems} />
            <MagnitudeLegend framing="magnitude" />
          </>
        )
        : (
          <>
            <Box component="ul" sx={listStyle}>
              {paging.pageItems.map((r) => (
                <Box
                  component="li"
                  key={r.iri}
                  sx={{ display: "flex", flexDirection: "column", py: 0.5 }}
                >
                  <Box sx={rowStyle}>
                    <Typography variant="body2" sx={{ ...ellipsis, minWidth: 0 }}>
                      {t("nrKwp", { kwp: r.installableKwp.toFixed(1) })}
                    </Typography>
                    <Typography
                      variant="body2"
                      color="text.secondary"
                      sx={{ flexShrink: 0 }}
                    >
                      {t("niDistance", { km: r.distanceKm.toFixed(1) })}
                    </Typography>
                  </Box>
                  {/* The lod2-by building resource — the only "detail" a nearby
                      rooftop has (no in-app page); Developer-mode link. */}
                  <RdfSourceLink href={r.iri} inline />
                </Box>
              ))}
            </Box>
            <Pager paging={paging} />
          </>
        )}

      <RdfSourceLink
        href={rooftopPointUrl(building.lat!, building.long!, NEARBY_ROOFTOP_RADIUS_M)}
      />
      <Typography variant="body2" color="text.secondary">
        {t("nrDataSource")}
      </Typography>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ display: "block" }}
      >
        {t("nrCaption")}
      </Typography>
    </Stack>
  );
}
