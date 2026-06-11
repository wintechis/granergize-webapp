import { Card, CardContent, CardHeader, Typography } from "@mui/material";
import ElectricBoltIcon from "@mui/icons-material/ElectricBolt";
import { buildingDisplayName } from "../lib/buildingDisplay.ts";
import type { BuildingType } from "../types.ts";
import { RdfSourceLink } from "../components/detail/DetailView.tsx";
import { splitEnergyDatasets } from "../lib/energyResolution.ts";
import UserEnergyChart from "./UserEnergyChart.tsx";

/**
 * The time-series view of a building's energy: the sub-hourly datasets'
 * day/month charts (`UserEnergyChart`), which lazy-load the daily reading
 * files on demand. Render only for a building that carries series datasets.
 */
export default function SeriesEnergy({ building }: { building: BuildingType }) {
  const { series } = splitEnergyDatasets(building.energyDatasets);
  return (
    <Card>
      <CardHeader
        avatar={<ElectricBoltIcon />}
        title={
          <Typography variant="h5">
            Electricity Consumption for {buildingDisplayName(building)}
          </Typography>
        }
      />
      <CardContent>
        {series.map((d) => <RdfSourceLink key={d.url} href={d.url} />)}
        <UserEnergyChart seriesDatasets={series} />
      </CardContent>
    </Card>
  );
}
