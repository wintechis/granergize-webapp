import { useState } from "react";
import {
  Box,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import SolarPowerIcon from "@mui/icons-material/SolarPower";
import type { BuildingType } from "../../types.ts";
import NearbyInstallationsMap from "./NearbyInstallationsMap.tsx";
import { useNearbyInstallations } from "../../hooks/mastrNearby.ts";
import {
  DEFAULT_RADIUS_KM,
  type InstallationKind,
  nearbyInstallationsUrl,
} from "../../services/mastrNearby.ts";
import { RdfSourceLink } from "../detail/DetailView.tsx";
import Pager from "../Pager.tsx";
import { usePaging } from "../../hooks/usePaging.ts";
import { ellipsis, listStyle, rowStyle } from "../../constants/listStyles.ts";
import { useT } from "../../context/I18nProvider.tsx";
import type { MessageId } from "../../lib/messages.ts";

const KIND_LABEL: Record<InstallationKind, MessageId> = {
  solar: "niKindSolar",
  wind: "niKindWind",
  hydro: "niKindHydro",
  biomass: "niKindBiomass",
};
/** Display order for the per-kind breakdown summary. */
const KIND_ORDER: InstallationKind[] = ["solar", "wind", "hydro", "biomass"];

/**
 * NEARBY RENEWABLE INSTALLATIONS: the individual generation units around the
 * building's coordinates, from `linked-mastr` — the FINEST-grain place layer (the
 * per-building analogue of the nearest weather station), shown with the same
 * visual weight as the regional-context and weather sections (icon header →
 * summary + list → data-source attribution). Best-effort: renders nothing when
 * the building has no coordinates, the wrapper is unreachable, or no renewable
 * units are nearby (mirrors the weather/regional sections). The bbox query IRI is
 * a Developer-mode source link (`RdfSourceLink` self-hides).
 */
export default function NearbyInstallationsSection(
  { building }: { building: BuildingType },
) {
  const t = useT();
  const { data } = useNearbyInstallations(building);
  const paging = usePaging(data?.installations ?? [], { key: "ni" });
  // List ⇄ Map guise of the same nearby set (local, non-URL state; List default).
  const [view, setView] = useState<"list" | "map">("list");

  if (!data || data.installations.length === 0) return null;

  const byKind = KIND_ORDER
    .map((k) => ({
      k,
      n: data.installations.filter((u) => u.kind === k).length,
    }))
    .filter((x) => x.n > 0);

  return (
    <Stack spacing={2}>
      <Stack
        direction="row"
        spacing={1}
        sx={{ alignItems: "center", flexWrap: "wrap" }}
      >
        <SolarPowerIcon color="action" />
        <Typography variant="h6">{t("niTitle")}</Typography>
        <Box sx={{ flexGrow: 1 }} />
        <ToggleButtonGroup
          size="small"
          exclusive
          value={view}
          onChange={(_e, next) => {
            if (next) setView(next); // ignore deselect of the active button
          }}
          aria-label={t("niViewAria")}
        >
          <ToggleButton value="list">{t("btnList")}</ToggleButton>
          <ToggleButton value="map">{t("btnMap")}</ToggleButton>
        </ToggleButtonGroup>
      </Stack>

      <Typography variant="body2" color="text.secondary">
        {t("niSummary", {
          count: data.installations.length,
          radius: DEFAULT_RADIUS_KM,
        })}
        {byKind.length > 0 && (
          <> — {byKind.map((x) => `${t(KIND_LABEL[x.k])} ${x.n}`).join(" · ")}</>
        )}
      </Typography>

      {view === "map"
        ? (
          <NearbyInstallationsMap
            building={building}
            installations={data.installations}
          />
        )
        : (
          <>
            <Box component="ul" sx={listStyle}>
              {paging.pageItems.map((u) => (
                <Box
                  component="li"
                  key={u.iri}
                  sx={{ display: "flex", flexDirection: "column", py: 0.5 }}
                >
                  <Box sx={rowStyle}>
                    <Typography
                      variant="body2"
                      sx={{ ...ellipsis, minWidth: 0 }}
                    >
                      {t(KIND_LABEL[u.kind])} — {u.label || t("niUnnamed")}
                    </Typography>
                    <Typography
                      variant="body2"
                      color="text.secondary"
                      sx={{ flexShrink: 0 }}
                    >
                      {t("niDistance", { km: (u.distanceKm ?? 0).toFixed(1) })}
                    </Typography>
                  </Box>
                  {/* Per-unit RDF resource on linked-mastr — the only "detail" a
                      unit has (there is no in-app unit page); Developer-mode link. */}
                  <RdfSourceLink href={u.iri} inline />
                </Box>
              ))}
            </Box>
            <Pager paging={paging} />
          </>
        )}

      <RdfSourceLink
        href={nearbyInstallationsUrl(building.lat!, building.long!)}
      />
      <Typography variant="body2" color="text.secondary">
        {t("niDataSource")}
      </Typography>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ display: "block" }}
      >
        {t("niCaption")}
      </Typography>
    </Stack>
  );
}
