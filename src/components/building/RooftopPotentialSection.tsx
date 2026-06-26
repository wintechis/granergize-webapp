import { Stack } from "@mui/material";
import type { BuildingType } from "../../types.ts";
import { useLod2Rooftop } from "../../hooks/lod2Rooftop.ts";
import { RooftopBuildingCardView } from "./StandortEnergieprofil.tsx";
import { RdfSourceLink } from "../detail/DetailView.tsx";
import SourceNote from "../SourceNote.tsx";
import { SOURCES } from "../../constants/dataSources.ts";

/**
 * The building's OWN rooftop-PV potential — its roof's installable kWp + annual yield,
 * computed over this building's LoD2 geometry. Building info (a property of the building's
 * roof), so it stays on the building page; the nearby/regional renewable context lives on
 * the observation page ({@link StandortEnergieprofil}). Renders nothing off-pilot (no LoD2).
 */
export default function RooftopPotentialSection(
  { building }: { building: BuildingType },
) {
  const rooftop = useLod2Rooftop(building).data ?? null;
  if (!rooftop) return null;
  return (
    <Stack spacing={2}>
      <RooftopBuildingCardView data={rooftop} />
      <SourceNote variant="caption" sources={[SOURCES["lod2-by"], SOURCES.pvgis]} />
      <RdfSourceLink href={rooftop.iri} />
    </Stack>
  );
}
