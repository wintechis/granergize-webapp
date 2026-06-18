/**
 * The shared choropleth legend — a floating box listing each magnitude band's colour
 * + i18n label (best/lowest first → no-data last), for whichever framing the map uses.
 * One source so the building's neighbourhood map and the regional-metrics map read
 * identically. Positioned absolutely; place it inside a `position: relative` map box.
 */
import { Box, Typography } from "@mui/material";
import type { MetricFraming } from "../../services/energy/energyMetric.ts";
import { bandColor, bandLabelKey, legendBands } from "../../constants/lensBand.ts";
import { useT } from "../../context/I18nProvider.tsx";

export default function MagnitudeLegend({ framing }: { framing: MetricFraming }) {
  const t = useT();
  return (
    <Box
      sx={{
        position: "absolute",
        bottom: 16,
        right: 16,
        zIndex: 1000,
        bgcolor: "background.paper",
        p: 1,
        borderRadius: 1,
        boxShadow: 2,
      }}
    >
      {legendBands(framing).map((band) => (
        <Box key={band} sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <Box
            sx={{
              width: 14,
              height: 14,
              bgcolor: bandColor(band, framing),
              border: "1px solid",
              borderColor: "divider",
            }}
          />
          <Typography variant="caption">{t(bandLabelKey(band, framing))}</Typography>
        </Box>
      ))}
    </Box>
  );
}
