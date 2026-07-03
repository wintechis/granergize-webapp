import { msg } from "../../lib/messages.ts";
import {
  Box,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import type { Building, TechnicalSystem } from "../../types.ts";
import { useAnnualDatasets } from "../../hooks/queries.ts";
import { ANNUAL_METRICS, annualMetricLabel } from "../../constants/annualMetrics.ts";
import { buildingFileUri } from "../../services/rdf/building/buildingId.ts";
import { UNIT_PARAM } from "../../routes.ts";
import { systemKindLabel, systemValueLine } from "../../lib/systemDisplay.ts";
import Sparkline from "../detail/Sparkline.tsx";

/** "PV system: Solaranlage Langguth · 63.45 kW, since 2011" — the SAME kind label
 * and value line the building page's system row shows, so the row's link lands on
 * a heading the reader recognises as the same system. */
const unitTitle = (u: TechnicalSystem): string =>
  `${systemKindLabel(u.kind)}: ${systemValueLine(u)}`;

/** The DOM id the `?unit=` deep link scrolls to. */
const unitAnchorId = (unitId: string): string => `unit-${unitId}`;

const fmt = (v: number, decimals: number): string =>
  new Intl.NumberFormat("de-DE", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(v);

/**
 * Per-unit observations on the building's observation page: for each energy unit
 * (`bldg:hasSystem`) that carries its OWN `sosa:hasFeatureOfInterest` annual series,
 * a compact year×metric table. These are the observations the building-level views
 * deliberately exclude (no double-count), surfaced here under their unit. Renders
 * nothing when no unit has observations. Reuses `useAnnualDatasets` (loads every
 * annual dataset, building- and unit-level, with metrics).
 */
export default function UnitObservationsSection(
  { building }: { building: Building },
) {
  const all = useAnnualDatasets(building).data ?? [];
  const file = buildingFileUri(building.uri as string);
  const units = (building.systems ?? []) as TechnicalSystem[];
  const groups = units
    .map((unit) => ({
      unit,
      datasets: all
        .filter((d) => d.featureOfInterest === `${file}#${unit.id}` && d.scenario === "actual")
        .sort((a, b) => a.year - b.year),
    }))
    .filter((g) => g.datasets.length > 0);

  // A `?unit=` deep link (the building page's per-system link) scrolls to that
  // unit's table once its datasets have loaded.
  const [searchParams] = useSearchParams();
  const focusUnit = searchParams.get(UNIT_PARAM);
  const focusReady = focusUnit !== null &&
    groups.some((g) => g.unit.id === focusUnit);
  useEffect(() => {
    if (!focusReady) return;
    document.getElementById(unitAnchorId(focusUnit as string))
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [focusReady, focusUnit]);

  if (groups.length === 0) return null;

  return (
    <Box>
      <Typography variant="h6" sx={{ mb: 1 }}>{msg("unitObsHeading")}</Typography>
      <Stack spacing={3}>
        {groups.map(({ unit, datasets }) => {
          const metrics = ANNUAL_METRICS.filter((m) =>
            datasets.some((d) => d.metrics?.[m.key] != null)
          );
          // A sparkline of the unit's primary (first present) metric over the years —
          // the trend at a glance, beside the exact figures in the table below.
          const spark = metrics.length > 0
            ? datasets
              .map((d) => d.metrics?.[metrics[0].key])
              .filter((v): v is number => v != null)
            : [];
          return (
            <Box key={unit.id} id={unitAnchorId(unit.id)}>
              <Stack
                direction="row"
                sx={{ alignItems: "center", gap: 1, mb: 0.5 }}
              >
                <Typography variant="subtitle2">{unitTitle(unit)}</Typography>
                <Sparkline values={spark} />
              </Stack>
              <TableContainer component={Paper} variant="outlined">
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell><strong>{msg("lblYear")}</strong></TableCell>
                      {metrics.map((m) => (
                        <TableCell key={m.key} align="right">
                          <strong>{annualMetricLabel(m.key)}</strong>
                        </TableCell>
                      ))}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {datasets.map((d) => (
                      <TableRow key={d.year}>
                        <TableCell>{d.year}</TableCell>
                        {metrics.map((m) => {
                          const v = d.metrics?.[m.key];
                          return (
                            <TableCell key={m.key} align="right">
                              {v != null ? fmt(v, m.decimals) : "—"}
                            </TableCell>
                          );
                        })}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </Box>
          );
        })}
      </Stack>
    </Box>
  );
}
