import Divider from "@mui/material/Divider";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import SolarPowerIcon from "@mui/icons-material/SolarPower";
import { useT } from "../../context/I18nProvider.tsx";
import { useOpenBuildingDetail } from "../../hooks/lod2Rooftop.ts";
import { RooftopBuildingCardView } from "./StandortEnergieprofil.tsx";
import SourceNote from "../SourceNote.tsx";
import { SOURCES } from "../../constants/dataSources.ts";
import { BackLink, DetailCard, RdfSourceLink } from "../detail/DetailView.tsx";
import { FINDERS } from "../../routes.ts";

/**
 * The in-app, READ-ONLY detail for an open (LoD2) building — drilled to from the
 * Buildings `open` tier (`/building?uri=<lod2-iri>`) instead of bouncing to the upstream
 * document. Built from the SAME detail idiom as the standard building page (the
 * `Stack`-divider layout, `BackLink`, a `DetailCard`) so it reads consistently — but
 * off-Pod, so no Pod sections (master-data editor, energy, sharing, attachments): the
 * open building IS its rooftop-PV potential, rendered through the same
 * {@link RooftopBuildingCardView} an owned building's Standort card uses, with the
 * LDBV/PVGIS attribution (and the raw wrapper IRI as the dev-mode source link).
 */
export default function OpenBuildingDetail({ iri }: { iri: string }) {
  const t = useT();
  const { data, isLoading } = useOpenBuildingDetail(iri);
  return (
    <Stack spacing={3} divider={<Divider />} sx={{ width: "100%" }}>
      <BackLink fallback={FINDERS.buildings} />
      {isLoading && (
        <Typography variant="body2">{t("loadingEllipsis")}</Typography>
      )}
      {!isLoading && !data && (
        <Typography variant="body2">{t("openBuildingUnavailable")}</Typography>
      )}
      {!isLoading && data && (
        <DetailCard
          icon={<SolarPowerIcon color="action" />}
          title={t("openBuildingDetailTitle")}
        >
          <RooftopBuildingCardView data={data} />
          <SourceNote variant="caption" sources={[SOURCES["lod2-by"], SOURCES.pvgis]} />
          <RdfSourceLink href={iri} />
        </DetailCard>
      )}
    </Stack>
  );
}
