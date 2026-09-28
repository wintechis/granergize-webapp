import { Card, CardContent, CardHeader, Typography } from "@mui/material";
import ElectricBoltIcon from "@mui/icons-material/ElectricBolt";
import { msg } from "../lib/messages.ts";
import { buildingDisplayName } from "../lib/buildingDisplay.ts";
import type { Building } from "../types.ts";
import { RdfSourceLink } from "../components/detail/DetailView.tsx";
import { splitEnergyDatasets } from "../lib/energyResolution.ts";
import UserEnergyChart from "./UserEnergyChart.tsx";

/**
 * The time-series view of a building's energy: the sub-hourly datasets'
 * day/month charts (`UserEnergyChart`), which lazy-load the daily reading
 * files on demand. Render only for a building that carries series datasets.
 *
 * `hideTitle` drops the card header for a host that already names the coordinate
 * itself — Explore's `?series=` drill panel (`SeriesDrillPanel`), whose own header
 * carries the building name, the grain and the close action. Default `false`, so the
 * observation page's use is unchanged.
 */
export default function SeriesEnergy(
  { building, hideTitle = false }: { building: Building; hideTitle?: boolean },
) {
  const { series } = splitEnergyDatasets(building.energyDatasets);
  return (
    <Card>
      {!hideTitle && (
        <CardHeader
          avatar={<ElectricBoltIcon />}
          title={
            <Typography variant="h5">
              {msg("seriesElectricityTitle", {
                building: buildingDisplayName(building),
              })}
            </Typography>
          }
        />
      )}
      <CardContent>
        {series.map((d) => <RdfSourceLink key={d.uri} href={d.uri} />)}
        <UserEnergyChart seriesDatasets={series} />
      </CardContent>
    </Card>
  );
}
