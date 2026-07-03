import { useState } from "react";
import {
  Box,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import TravelExploreIcon from "@mui/icons-material/TravelExplore";
import type { Building } from "../../types.ts";
import SurroundingsMap from "./SurroundingsMap.tsx";
import MagnitudeLegend from "../region/MagnitudeLegend.tsx";
import { useNearbyInstallations } from "../../hooks/mastrNearby.ts";
import {
  useNearbyRooftopGeometry,
  useNearbyRooftops,
} from "../../hooks/lod2Rooftop.ts";
import {
  DEFAULT_RADIUS_KM,
  type InstallationKind,
  nearbyInstallationsUrl,
} from "../../services/sources/mastrNearby.ts";
import {
  NEARBY_ROOFTOP_RADIUS_M,
  rooftopPointUrl,
} from "../../services/sources/lod2Rooftop.ts";
import { RdfSourceLink } from "../detail/DetailView.tsx";
import { ProvenanceMarker } from "../ProvenanceMarker.tsx";
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
 * SURROUNDINGS — the building's location context in ONE section: what generates
 * around it (the MaStR units, km grain) and what its neighbours' roofs could
 * generate (the LoD2 rooftop-PV potential, ~hundreds-of-metres grain). One
 * header, one List ⇄ Map toggle; the map overlays both layers on one map of
 * the neighbourhood ({@link SurroundingsMap}), the list stacks them as
 * subgroups. Merges the former NearbyInstallationsSection +
 * NearbyRooftopsSection (two structural twins showing the same neighbourhood
 * on two maps); future place layers join here rather than as new siblings.
 * Best-effort per layer: a layer with nothing nearby (or its wrapper
 * unreachable / off-coverage) simply doesn't appear; the section renders
 * nothing when both are empty. Query IRIs are Developer-mode source links.
 */
export default function SurroundingsSection(
  { building }: { building: Building },
) {
  const t = useT();
  const installations = useNearbyInstallations(building).data?.installations ??
    [];
  const rooftops = useNearbyRooftops(building).data ?? [];
  const instPaging = usePaging(installations, { key: "ni" });
  const roofPaging = usePaging(rooftops, { key: "nr" });
  // List ⇄ Map guise of the same surroundings (local, non-URL state; List default).
  const [view, setView] = useState<"list" | "map">("list");
  // Footprint geometry is deref-heavy (one request per building), so fetch it only
  // once the map view is opened; until it lands the point summary shows as dots.
  const geometry = useNearbyRooftopGeometry(building, view === "map").data;
  const mapRooftops = geometry ?? rooftops.map((r) => ({ ...r, roofs: [] }));

  if (installations.length === 0 && rooftops.length === 0) return null;

  const byKind = KIND_ORDER
    .map((k) => ({
      k,
      n: installations.filter((u) => u.kind === k).length,
    }))
    .filter((x) => x.n > 0);
  const totalKwp = rooftops.reduce((s, r) => s + r.installableKwp, 0);

  return (
    <Stack spacing={2}>
      <Stack
        direction="row"
        spacing={1}
        sx={{ alignItems: "center", flexWrap: "wrap" }}
      >
        <TravelExploreIcon color="action" />
        <Typography variant="h6">{t("surTitle")}</Typography>
        <Box sx={{ flexGrow: 1 }} />
        <ToggleButtonGroup
          size="small"
          exclusive
          value={view}
          onChange={(_e, next) => {
            if (next) setView(next); // ignore deselect of the active button
          }}
          aria-label={t("surViewAria")}
        >
          <ToggleButton value="list">{t("btnList")}</ToggleButton>
          <ToggleButton value="map">{t("btnMap")}</ToggleButton>
        </ToggleButtonGroup>
      </Stack>

      {view === "map"
        ? (
          <>
            <SurroundingsMap
              building={building}
              installations={installations}
              rooftops={mapRooftops}
            />
            {rooftops.length > 0 && <MagnitudeLegend framing="magnitude" />}
          </>
        )
        : (
          <>
            {installations.length > 0 && (
              <Box>
                <Stack
                  direction="row"
                  spacing={1}
                  sx={{ alignItems: "center", mb: 0.5 }}
                >
                  <Typography variant="subtitle2">{t("niTitle")}</Typography>
                  {/* Group record over the listed units; their bbox document (in
                      the RDF dataset) resolves as the open-tier source. */}
                  <ProvenanceMarker
                    subject={installations.map((u) => u.iri)}
                  />
                </Stack>
                <Typography variant="body2" color="text.secondary">
                  {t("niSummary", {
                    count: installations.length,
                    radius: DEFAULT_RADIUS_KM,
                  })}
                  {byKind.length > 0 && (
                    <>
                      {" "}— {byKind.map((x) => `${t(KIND_LABEL[x.k])} ${x.n}`)
                        .join(" · ")}
                    </>
                  )}
                </Typography>
                <Box component="ul" sx={listStyle}>
                  {instPaging.pageItems.map((u) => (
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
                          {t("niDistance", {
                            km: (u.distanceKm ?? 0).toFixed(1),
                          })}
                        </Typography>
                      </Box>
                      {/* Per-unit RDF resource on linked-mastr — the only "detail" a
                          unit has (there is no in-app unit page); Developer-mode link. */}
                      <RdfSourceLink href={u.iri} inline />
                    </Box>
                  ))}
                </Box>
                <Pager paging={instPaging} />
              </Box>
            )}

            {rooftops.length > 0 && (
              <Box>
                <Stack
                  direction="row"
                  spacing={1}
                  sx={{ alignItems: "center", mb: 0.5 }}
                >
                  <Typography variant="subtitle2">{t("nrTitle")}</Typography>
                  {/* Group record over the nearby buildings; the point-summary
                      document resolves as the open-tier source. */}
                  <ProvenanceMarker subject={rooftops.map((r) => r.iri)} />
                </Stack>
                <Typography variant="body2" color="text.secondary">
                  {t("nrSummary", {
                    count: rooftops.length,
                    radius: NEARBY_ROOFTOP_RADIUS_M,
                    kwp: Math.round(totalKwp),
                  })}
                </Typography>
                <Box component="ul" sx={listStyle}>
                  {roofPaging.pageItems.map((r) => (
                    <Box
                      component="li"
                      key={r.iri}
                      sx={{ display: "flex", flexDirection: "column", py: 0.5 }}
                    >
                      <Box sx={rowStyle}>
                        <Typography
                          variant="body2"
                          sx={{ ...ellipsis, minWidth: 0 }}
                        >
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
                <Pager paging={roofPaging} />
              </Box>
            )}
          </>
        )}

      {/* Per-layer attribution + the dereferenced query IRIs (both views): the
          layers come from different wrappers with different licences. */}
      {installations.length > 0 && (
        <Box>
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
        </Box>
      )}
      {rooftops.length > 0 && (
        <Box>
          <RdfSourceLink
            href={rooftopPointUrl(
              building.lat!,
              building.long!,
              NEARBY_ROOFTOP_RADIUS_M,
            )}
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
        </Box>
      )}
    </Stack>
  );
}
