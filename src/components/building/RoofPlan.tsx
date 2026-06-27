/**
 * The building's **roof surfaces drawn as a top-down plan** — each LoD2 `RoofSurface`'s
 * footprint (`geo:asWKT`, served by `linked-lod2-by`) as an SVG polygon, shaded by its
 * expected PV yield via the shared magnitude lens (north-facing / too-steep faces → the
 * no-data grey). The geometry sibling of the numeric rooftop card in
 * {@link ./StandortEnergieprofil.tsx}: that card is the building total, this is *where* on
 * the roof the potential sits. Sits under the rooftop content on the building page.
 *
 * The wrapper serves the WKT footprints within the LoD2-BY dump's coverage (currently the
 * Nuremberg pilot, AGS 09564), so the plan renders there. It degrades to nothing outside that
 * coverage — the hook returns null, or a building arrives without a `polygon` → no plan.
 */
import { Box, Stack, Typography } from "@mui/material";
import GridOnIcon from "@mui/icons-material/GridOn";
import type { Building } from "../../types.ts";
import { msg } from "../../lib/messages.ts";
import { useLod2Rooftop } from "../../hooks/lod2Rooftop.ts";
import { evaluateRoofs, type RoofEval } from "../../services/sources/rooftopPv.ts";
import {
  magnitudeCategoriserFor,
  type MetricFraming,
} from "../../services/energy/energyMetric.ts";
import { bandColor } from "../../constants/lensBand.ts";
import MagnitudeLegend from "../region/MagnitudeLegend.tsx";

const FRAMING: MetricFraming = "magnitude";
// The plan's coordinate canvas; the Box caps display at W px (svg is width:100%), so bumping
// these enlarges the rendered plan while keeping the same fit. Sized to fill the detail column.
const W = 640;
const H = 440;
const PAD = 6;

export default function RoofPlan({ building }: { building: Building }) {
  const data = useLod2Rooftop(building).data ?? null;

  // Only the surfaces the wrapper served a footprint for (outside coverage → none → omitted).
  const surfaces = (data ? evaluateRoofs(data.roofs) : [])
    .map((e) => ({ e, ring: e.surface.polygon }))
    .filter((s): s is { e: RoofEval; ring: [number, number][] } => !!s.ring);
  if (surfaces.length === 0) return null;

  // Project lon/lat → a local plan: compress lon by cos(lat), flip Y (north up), fit to box.
  const pts = surfaces.flatMap((s) => s.ring);
  const lons = pts.map((p) => p[0]);
  const lats = pts.map((p) => p[1]);
  const minLon = Math.min(...lons);
  const maxLat = Math.max(...lats);
  const kx = Math.cos((Math.min(...lats) + maxLat) / 2 * Math.PI / 180);
  const local = surfaces.map((s) => ({
    e: s.e,
    ring: s.ring.map(([lon, lat]): [number, number] => [
      (lon - minLon) * kx,
      maxLat - lat,
    ]),
  }));
  const xy = local.flatMap((s) => s.ring);
  const maxX = Math.max(...xy.map((p) => p[0])) || 1;
  const maxY = Math.max(...xy.map((p) => p[1])) || 1;
  const scale = Math.min((W - 2 * PAD) / maxX, (H - 2 * PAD) / maxY);
  const toSvg = ([x, y]: [number, number]) => `${PAD + x * scale},${PAD + y * scale}`;

  // Shade suitable faces by yield (terciles over the suitable set); unsuitable → grey.
  const classify = magnitudeCategoriserFor(
    local.filter((s) => s.e.suitable).map((s) => s.e.annualKwh),
  );
  const bandOf = (e: RoofEval) => (e.suitable ? classify(e.annualKwh) : "none");
  const tip = (e: RoofEval) => {
    const head = `${e.orientation} · ${e.surface.areaM2.toFixed(0)} m² · ${
      e.surface.tiltDeg.toFixed(0)
    }°`;
    return e.suitable
      ? `${head} · ${e.annualKwh.toLocaleString("de-DE", { maximumFractionDigits: 0 })} kWh/a`
      : `${head} · ${msg("rpRoofUnsuitable")}`;
  };

  return (
    <Stack spacing={1}>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
        <GridOnIcon color="action" />
        <Typography variant="h6">{msg("rpRoofPlan")}</Typography>
      </Stack>
      <Box sx={{ position: "relative", width: "100%", maxWidth: W }}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          width="100%"
          role="img"
          aria-label={msg("rpRoofPlan")}
        >
          {local.map((s, i) => (
            <polygon
              key={i}
              points={s.ring.map(toSvg).join(" ")}
              fill={bandColor(bandOf(s.e), FRAMING)}
              fillOpacity={0.85}
              stroke="#555"
              strokeWidth={0.7}
            >
              <title>{tip(s.e)}</title>
            </polygon>
          ))}
        </svg>
        <MagnitudeLegend framing={FRAMING} />
      </Box>
      <Typography variant="caption" color="text.secondary">
        {msg("rpRoofPlanHint")}
      </Typography>
    </Stack>
  );
}
