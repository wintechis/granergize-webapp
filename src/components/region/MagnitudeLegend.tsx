/**
 * The **floating** band legend — a paper box in a map corner listing each band's
 * colour + label (best/lowest first → no-data last), for whichever framing the map
 * uses. The keys themselves come from the shared `BandKeys`; this component owns only
 * the placement, which is the one thing a map legend needs and a colour key must not
 * know about. Positioned absolutely: place it inside a `position: relative` box (an
 * inline key beside a chart renders `BandKeys` directly instead).
 *
 * `shape`/`placement` exist because the two floating legends explain different marks
 * and would otherwise collide: the energy lens colours round markers in the
 * bottom-left, the choropleths colour polygons in the bottom-right — a map can show
 * both at once.
 */
import { Box } from "@mui/material";
import type { MetricFraming } from "../../services/energy/energyMetric.ts";
import { BandKeys } from "../Legend.tsx";

export default function MagnitudeLegend(
  { framing, shape = "square", placement = "bottom-right" }: {
    framing: MetricFraming;
    /** Mirror the mark: polygon/area fills → square, map markers → dot. */
    shape?: "square" | "dot";
    placement?: "bottom-right" | "bottom-left";
  },
) {
  const left = placement === "bottom-left";
  return (
    <Box
      sx={{
        position: "absolute",
        bottom: 16,
        ...(left ? { left: 16 } : { right: 16 }),
        zIndex: 1000,
        bgcolor: "background.paper",
        p: 1,
        border: 1,
        borderColor: "divider",
        borderRadius: 1,
        boxShadow: 2,
      }}
    >
      <BandKeys framing={framing} shape={shape} />
    </Box>
  );
}
