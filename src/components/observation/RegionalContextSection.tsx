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
import QueryStatsIcon from "@mui/icons-material/QueryStats";
import type { BuildingType } from "../../types.ts";
import { useRegionalContext } from "../../hooks/regional.ts";
import { regionalTableDataUrl } from "../../services/rdf/regionalCube.ts";
import { RdfSourceLink } from "../detail/DetailView.tsx";
import { useT } from "../../context/I18nProvider.tsx";

/** German "Prozent" → the universal symbol; other units pass through as-is. */
const UNIT_DISPLAY: Record<string, string> = { Prozent: "%" };

/**
 * The building's REGIONAL CONTEXT: official statistics for its Bundesland from
 * `linked-regionalstatistik` (an RDF Data Cube), an external observation about
 * the building's *place* — the queried, place-joined sibling of the weather
 * layer, presented with the same visual weight (icon header → value table →
 * data-source attribution). Best-effort and standalone (not aligned into the
 * energy table, which would mislead given the area-vs-building grain mismatch —
 * hence the explicit grain caption); it shows directly-comparable rates/shares
 * only. Renders nothing when the building has no recognised German region or no
 * figures came back (mirrors the weather section). The raw statistik table code
 * + source link stay Developer-mode-only (`RdfSourceLink` self-hides).
 */
export default function RegionalContextSection(
  { building }: { building: BuildingType },
) {
  const t = useT();
  const { data } = useRegionalContext(building);

  if (!data || data.metrics.length === 0) return null;

  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
        <QueryStatsIcon color="action" />
        <Typography variant="h6">
          {t("regContextTitle", { region: data.region })}
        </Typography>
      </Stack>

      {data.metrics.map((m) => (
        <Box key={m.table.tableId}>
          <TableContainer component={Paper} sx={{ mb: 1 }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t("lblYear")}</TableCell>
                  <TableCell>{t(m.table.labelId)}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {m.observations.map((o) => (
                  <TableRow key={o.year}>
                    <TableCell>{o.year}</TableCell>
                    <TableCell>
                      {o.value} {UNIT_DISPLAY[o.unit] ?? o.unit}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
          <RdfSourceLink href={regionalTableDataUrl(m.table.tableId)} />
        </Box>
      ))}

      <Typography variant="body2" color="text.secondary">
        {t("regDataSource")}
      </Typography>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ display: "block" }}
      >
        {t("regGeoCaption", { region: data.region })}
      </Typography>
    </Stack>
  );
}
