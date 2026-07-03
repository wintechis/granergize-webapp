import { Link, Stack, Typography } from "@mui/material";
import SolarPowerIcon from "@mui/icons-material/SolarPower";
import type { Building } from "../../types.ts";
import { msg, type MessageId } from "../../lib/messages.ts";
import { useStandortEnergieprofil } from "../../hooks/standortEnergieprofil.ts";
import { useLod2Rooftop } from "../../hooks/lod2Rooftop.ts";
import type { RooftopPotential } from "../../services/sources/lod2Rooftop.ts";
import {
  areaUrl,
  type BiomassCard as BiomassCardData,
  computePvBenchmark,
  type GreenCard as GreenCardData,
  type MixEntry,
  type PotentialCard as PotentialCardData,
  type PvBenchmark,
} from "../../services/sources/standortEnergieprofil.ts";
import { RdfSourceLink } from "../detail/DetailView.tsx";
import SourceNote from "../SourceNote.tsx";
import { ProvenanceMarker } from "../ProvenanceMarker.tsx";
import { SOURCES } from "../../constants/dataSources.ts";

const fmt0 = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 });
const fmt1 = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 1 });

/** Electricity price for the "money on your roof" estimate: a single self-consumption rate
 *  (avoided purchase ≈ a commercial/industrial roof's own daytime use). Tunable. */
const PRICE_CT_PER_KWH = 20;
const PRICE_EUR_PER_KWH = PRICE_CT_PER_KWH / 100;

/** Carrier → message id, shared by the generation mix and the nearby breakdown. */
const CARRIER_LABEL: Record<MixEntry["carrier"], MessageId> = {
  solar: "sepSolar",
  wind: "sepWind",
  biomass: "sepBiomass",
  hydro: "sepHydro",
  geothermal: "sepGeothermal",
};

/** One figure: a value over a muted label. The headroom figure is accented. */
function Figure(
  { label, value, accent }: { label: string; value: string; accent?: boolean },
) {
  return (
    <Stack spacing={0}>
      <Typography variant="h6" color={accent ? "success.main" : "text.primary"}>
        {value}
      </Typography>
      <Typography variant="body2" color="text.secondary">{label}</Typography>
    </Stack>
  );
}

/** A potential-vs-installed card (rooftop or Freiflächen PV) → the Ausbaulücke. */
function PotentialCardView(
  { title, data }: { title: string; data: PotentialCardData },
) {
  return (
    <Stack spacing={0.5}>
      <Typography variant="subtitle2">{title}</Typography>
      <Stack direction="row" spacing={4} useFlexGap sx={{ flexWrap: "wrap" }}>
        <Figure label={msg("sepPotential")} value={`${fmt0(data.potentialMWp)} MWp`} />
        <Figure label={msg("sepInstalled")} value={`${fmt0(data.installedMWp)} MWp`} />
        <Figure
          label={msg("sepHeadroom")}
          value={`${fmt0(data.remainingMWp)} MWp`}
          accent
        />
      </Stack>
      <Typography variant="body2" color="text.secondary">
        {Math.round(data.degreePct)}% {msg("sepBuiltOut")}
      </Typography>
    </Stack>
  );
}

/** The per-building rooftop-PV card: installable kWp + annual yield + value, computed in-app
 *  over this building's LoD2 roof geometry — the per-building grain above the per-Gemeinde
 *  rooftop Ausbaulücke. */
export function RooftopBuildingCardView({ data }: { data: RooftopPotential }) {
  const euroPerYear = data.annualKwh * PRICE_EUR_PER_KWH;
  return (
    <Stack spacing={0.5}>
      <Typography variant="subtitle2">{msg("rpRooftopPotential")}</Typography>
      <Stack direction="row" spacing={4} useFlexGap sx={{ flexWrap: "wrap" }}>
        <Figure label={msg("rpInstallable")} value={`${fmt1(data.installableKwp)} kWp`} />
        <Figure label={msg("rpAnnualYield")} value={`${fmt0(data.annualKwh)} kWh/a`} />
        <Figure label={msg("rpValuePerYear")} value={`${fmt0(euroPerYear)} €/a`} accent />
        <Figure label={msg("rpUsableArea")} value={`${fmt0(data.suitableAreaM2)} m²`} />
        {data.dominantOrientation && (
          <Figure label={msg("rpOrientation")} value={data.dominantOrientation} />
        )}
      </Stack>
      <Typography variant="body2" color="text.secondary">
        {msg("rpEstimateCaption", { price: PRICE_CT_PER_KWH })}
      </Typography>
      <Link href={`${data.iri}.html`} target="_blank" rel="noopener" variant="body2">
        {msg("rpViewOnMap")}
      </Link>
    </Stack>
  );
}

/**
 * The rooftop-PV benchmark: this building's own installed/potential set against its
 * Gemeinde's (a read-time comparison, not stored data). Three framings — #1 the
 * realization gap (this building's built-out % vs the area's), #2 the headroom this
 * roof adds into, #3 this building against the typical local installation size.
 */
function PvBenchmarkView(
  { data, areaName }: { data: PvBenchmark; areaName: string },
) {
  return (
    <Stack spacing={0.5}>
      <Typography variant="subtitle2">{msg("sepBmTitle")}</Typography>
      <Stack direction="row" spacing={4} useFlexGap sx={{ flexWrap: "wrap" }}>
        <Figure
          label={msg("sepBmThisBuilding")}
          value={`${fmt0(data.buildingRealizationPct)}%`}
        />
        <Figure
          label={areaName || msg("sepBmArea")}
          value={`${fmt0(data.regionRealizationPct)}%`}
        />
      </Stack>
      <Typography variant="body2" color="text.secondary">
        {msg("sepBmRealizedCaption")}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {msg("sepBmShare", {
          self: fmt1(data.buildingPotentialKwp),
          remaining: fmt0(data.regionRemainingMWp),
        })}
      </Typography>
      {data.avgInstallationKwp != null && (
        <Typography variant="body2" color="text.secondary">
          {msg("sepBmVsAvg", {
            typical: fmt1(data.avgInstallationKwp),
            self: fmt1(data.buildingInstalledKwp),
          })}
        </Typography>
      )}
    </Stack>
  );
}

/** The green-electricity card: renewable share of consumption + the carrier mix. */
function GreenCardView({ data }: { data: GreenCardData }) {
  const mix = data.mix
    .map((e) => `${msg(CARRIER_LABEL[e.carrier])} ${Math.round(e.sharePct)}%`)
    .join(" · ");
  return (
    <Stack spacing={0.5}>
      <Typography variant="subtitle2">{msg("sepGreenElectricity")}</Typography>
      <Typography variant="h6" color="success.main">
        {Math.round(data.renewableSharePct)}% {msg("sepRenewable")}
      </Typography>
      {mix && <Typography variant="body2" color="text.secondary">{mix}</Typography>}
    </Stack>
  );
}

/** The biomass card: biogas potential + installed capacity + plant count. */
function BiomassCardView({ data }: { data: BiomassCardData }) {
  return (
    <Stack spacing={0.5}>
      <Typography variant="subtitle2">{msg("sepBiomass")}</Typography>
      <Stack direction="row" spacing={4} useFlexGap sx={{ flexWrap: "wrap" }}>
        <Figure
          label={msg("sepBiogasPotential")}
          value={`${fmt1(data.biogasPotentialGWh)} GWh/a`}
        />
        <Figure label={msg("sepInstalled")} value={`${fmt1(data.installedMW)} MW`} />
      </Stack>
      {data.plantCount > 0 && (
        <Typography variant="body2" color="text.secondary">
          {data.plantCount} {msg("sepPlants")}
        </Typography>
      )}
    </Stack>
  );
}

/**
 * The "Standort-Energieprofil" — the building's Gemeinde-level energy CONTEXT, shown
 * on the OBSERVATION page. (The building page carries the building-and-surroundings
 * layers — its own rooftop potential ({@link RooftopPotentialSection}), the nearby
 * installations and nearby rooftops; the observation page keeps the region-grain
 * context like this profile and the regional statistics.) It renders the
 * per-Gemeinde Energie-Atlas profile: rooftop- and Freiflächen-PV Ausbaulücke, the
 * renewable share + generation mix, and biomass (`linked-energieatlas`, Bavaria-only).
 * Renders nothing where no Energie-Atlas profile resolves (off-pilot).
 */
export default function StandortEnergieprofil(
  { building }: { building: Building },
) {
  const { query, ags } = useStandortEnergieprofil(building);
  const rooftop = useLod2Rooftop(building).data ?? null;
  const p = query.data ?? null;
  if (!p) return null;
  // Benchmark this building's rooftop PV against the Gemeinde: installed = the sum of
  // its own `<#pv>` system capacities; potential = its LoD2-computed installable kWp.
  const installedKwp = (building.systems ?? [])
    .filter((s) => s.kind === "pv")
    .reduce((sum, s) => sum + (s.capacityKW ?? 0), 0);
  const benchmark = rooftop
    ? computePvBenchmark(installedKwp, rooftop.installableKwp, p)
    : null;
  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
        <SolarPowerIcon color="action" />
        <Typography variant="h6">{msg("secStandortProfile")}</Typography>
      </Stack>
      {p.name && (
        <Typography variant="body2" color="text.secondary">{p.name}</Typography>
      )}
      <Stack spacing={2}>
        {p.rooftop && <PotentialCardView title={msg("sepRooftopPv")} data={p.rooftop} />}
        {benchmark && <PvBenchmarkView data={benchmark} areaName={p.name} />}
        {p.ground && <PotentialCardView title={msg("sepGroundPv")} data={p.ground} />}
        {p.green && <GreenCardView data={p.green} />}
        {p.biomass && <BiomassCardView data={p.biomass} />}
      </Stack>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
        <SourceNote variant="caption" sources={[SOURCES.energieatlas]} />
        {/* Document-level record: the Gemeinde's Energie-Atlas area document is
            the profile's source (the cards render derived figures, no IRIs). */}
        {ags && <ProvenanceMarker subject={[]} sources={[areaUrl(ags)]} />}
      </Stack>
      {ags && <RdfSourceLink href={areaUrl(ags)} />}
    </Stack>
  );
}
