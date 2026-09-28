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
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import { sourceKeys } from "../services/sources/sourceKeys.ts";
import QueryStatsIcon from "@mui/icons-material/QueryStats";
import ExploreIcon from "@mui/icons-material/Explore";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  fetchRegionalObservations,
  REGIONAL_TABLES,
  REGIONAL_UNIT_DISPLAY as UNIT_DISPLAY,
  regionalGeoUrl,
} from "../services/sources/regionalCube.ts";
import { bundeslandName } from "../services/sources/region.ts";
import { AGGREGATIONS_MAP_VIEW, AGGREGATIONS_VIEW } from "../routes.ts";
import { RdfSourceLink, RefLink } from "../components/detail/DetailView.tsx";
import IconAction from "../components/IconAction.tsx";
import RegionalMetricsMap from "../components/region/RegionalMetricsMap.tsx";
import { useT } from "../context/I18nProvider.tsx";

/**
 * Standalone read-only page for one **public open-data regional dataset** — a
 * `linked-regionalstatistik` table at one Bundesland (the `open` tier of the
 * Aggregations finder opens this). It holds only `table` + `ags` (no Pod
 * resource), fetches the year/value series on mount, and renders it like the
 * per-building Regional-context section but as its own route. A full-page route
 * (outside the app shell), so it carries its own back breadcrumb.
 */
export default function RegionalDataset() {
  const t = useT();
  const [sp] = useSearchParams();
  const tableId = sp.get("table") ?? "";
  const ags = sp.get("ags") ?? "";
  const table = REGIONAL_TABLES.find((tb) => tb.tableId === tableId) ?? null;
  const region = bundeslandName(ags) ?? ags;

  const { data, isFetching } = useQuery({
    // `table` is derived 1:1 from `tableId`, but the lint rule wants every value
    // the queryFn closes over represented in the key.
    queryKey: [...sourceKeys.regionalDataset, tableId, ags, table],
    enabled: Boolean(table) && Boolean(ags),
    staleTime: 1000 * 60 * 60,
    queryFn: () => fetchRegionalObservations(table!, ags),
    // Open-data read with its own inline empty state ("no data for this
    // region") — a wrapper outage shows that, not an error toast.
    meta: { silent: true },
  });

  // Table (this region's year series) ⇄ Map (the metric across all regions). Local state.
  const [view, setView] = useState<"table" | "map">("table");

  // "Explore this": the same cells on the shared analytical surface — Explore's
  // saved-views projection at its choropleth guise. The back link above returns to that
  // projection's LIST; this is the forward jump to the region-level cube.
  const navigate = useNavigate();

  const back = <RefLink to={AGGREGATIONS_VIEW}>{t("regDatasetBack")}</RefLink>;

  if (!table) {
    return (
      <Stack spacing={2}>
        {back}
        <Typography variant="body2">{t("regDatasetUnknown")}</Typography>
      </Stack>
    );
  }

  const observations = data ?? [];

  return (
    <Stack spacing={2}>
      {back}
      <Stack
        direction="row"
        spacing={1}
        sx={{ alignItems: "center", flexWrap: "wrap" }}
      >
        <QueryStatsIcon color="action" />
        <Typography variant="h5">
          {t(table.labelId)} — {region}
        </Typography>
        <IconAction
          label={t("showInExplore")}
          icon={<ExploreIcon fontSize="small" />}
          onClick={() => void navigate(AGGREGATIONS_MAP_VIEW)}
        />
        <Box sx={{ flexGrow: 1 }} />
        <ToggleButtonGroup
          size="small"
          exclusive
          value={view}
          onChange={(_e, next: "table" | "map" | null) => {
            if (next) setView(next);
          }}
          aria-label={t("regStatsViewAria")}
        >
          <ToggleButton value="table">{t("btnTable")}</ToggleButton>
          <ToggleButton value="map">{t("btnMap")}</ToggleButton>
        </ToggleButtonGroup>
      </Stack>

      {view === "table"
        ? (isFetching && observations.length === 0
          ? <Typography variant="body2">{t("loadingEllipsis")}</Typography>
          : observations.length === 0
          ? <Typography variant="body2">{t("regDatasetEmpty")}</Typography>
          : (
            <TableContainer component={Paper}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>{t("lblYear")}</TableCell>
                    <TableCell>{t(table.labelId)}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {observations.map((o) => (
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
          ))
        // The same metric across all regions, as a choropleth (zoom in for Kreis
        // detail, or switch metric); the table is this region's series.
        : (
          <Box sx={{ height: 420 }}>
            <RegionalMetricsMap initialTableId={tableId} />
          </Box>
        )}

      <Box>
        <RdfSourceLink href={regionalGeoUrl(table, ags)} />
        <Typography variant="body2" color="text.secondary">
          {t("regDataSource")}
        </Typography>
      </Box>
    </Stack>
  );
}
