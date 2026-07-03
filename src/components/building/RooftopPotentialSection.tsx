import { Stack } from "@mui/material";
import type { Building } from "../../types.ts";
import { useLod2Rooftop } from "../../hooks/lod2Rooftop.ts";
import { RooftopBuildingCardView } from "./StandortEnergieprofil.tsx";
import { RdfSourceLink } from "../detail/DetailView.tsx";
import SourceNote from "../SourceNote.tsx";
import { SOURCES } from "../../constants/dataSources.ts";
import { ProvenanceMarker } from "../ProvenanceMarker.tsx";

/**
 * The building's OWN rooftop-PV potential — its roof's installable kWp + annual yield,
 * computed over this building's LoD2 geometry. Building info (a property of the building's
 * roof); the surroundings (`SurroundingsSection` — nearby installations + nearby
 * rooftop potential) follow it on the building page, while the region-grain context
 * ({@link StandortEnergieprofil}) stays on the observation page. Renders nothing
 * off-pilot (no LoD2).
 */
export default function RooftopPotentialSection(
  { building }: { building: Building },
) {
  const rooftop = useLod2Rooftop(building).data ?? null;
  if (!rooftop) return null;
  return (
    <Stack spacing={2}>
      <RooftopBuildingCardView data={rooftop} />
      <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
        <SourceNote variant="caption" sources={[SOURCES["lod2-by"], SOURCES.pvgis]} />
        {
          /* The record resolves the LoD2 document via the dataset (the roof-geometry
            parse feeds it); the PVGIS side is JSON (no RDF), so the SourceNote keeps
            naming it until the phase-3 composite carrier. */
        }
        <ProvenanceMarker subject={rooftop.iri} />
      </Stack>
      <RdfSourceLink href={rooftop.iri} />
    </Stack>
  );
}
