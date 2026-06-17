import { Box, Stack, Typography } from "@mui/material";
import SolarPowerIcon from "@mui/icons-material/SolarPower";
import type { BuildingType } from "../../types.ts";
import { useNearbyInstallations } from "../../hooks/mastrNearby.ts";
import {
  DEFAULT_RADIUS_KM,
  type InstallationKind,
  nearbyInstallationsUrl,
} from "../../services/rdf/mastrNearby.ts";
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

  if (!data || data.installations.length === 0) return null;

  const byKind = KIND_ORDER
    .map((k) => ({
      k,
      n: data.installations.filter((u) => u.kind === k).length,
    }))
    .filter((x) => x.n > 0);

  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
        <SolarPowerIcon color="action" />
        <Typography variant="h6">{t("niTitle")}</Typography>
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

      <Box component="ul" sx={listStyle}>
        {paging.pageItems.map((u) => (
          <Box component="li" key={u.iri} sx={{ ...rowStyle, py: 0.5 }}>
            <Typography variant="body2" sx={{ ...ellipsis, minWidth: 0 }}>
              {t(KIND_LABEL[u.kind])} — {u.label || t("niUnnamed")}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ flexShrink: 0 }}>
              {t("niDistance", { km: u.distanceKm.toFixed(1) })}
            </Typography>
          </Box>
        ))}
      </Box>
      <Pager paging={paging} />

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
