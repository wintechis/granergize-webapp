import { useState } from "react";
import { Box, Button, Table, TableBody, TableCell, TableRow, Typography } from "@mui/material";
import type { ReceivedAggregation } from "../../services/interop/sharing.ts";
import { useComputedSnapshot } from "../../hooks/queries.ts";
import { useT } from "../../context/I18nProvider.tsx";
import { CHART_COLOR_PALETTE } from "../../constants/chartColors.ts";
import { formatNumber } from "../../lib/formatNumber.ts";
import { AgentLabel } from "../AgentLabel.tsx";
import MetricBarChart from "../detail/MetricBarChart.tsx";
import ResourceRow from "../ResourceRow.tsx";
import TierDot from "../TierDot.tsx";

/**
 * One "aggregation shared with you" row. Only the sharer's computed *snapshot* is
 * granted (not the definition), so we fetch it on demand from its URL (we hold
 * Read access) and show the aggregated values — a small table plus the same
 * MetricBarChart the owner sees. The "shared by" subtitle is the provenance marker
 * (these are the `shared`/`granted` tier of the Aggregations collection). Shared by
 * the Aggregations finder (the `shared` tier) and the Sharing finder.
 */
export default function ReceivedAggregationRow(
  { aggregation }: { aggregation: ReceivedAggregation },
) {
  const [open, setOpen] = useState(false);
  const t = useT();

  // Recipients hold Read on the snapshot (which carries the aggregation's name) but not
  // the definition. The query loads it on mount so the row shows the aggregation's NAME
  // up front instead of the opaque snapshot id; expanding reuses the cached data.
  const snapQuery = useComputedSnapshot(aggregation.snapshotUri);
  const snapshot = snapQuery.data ?? null;
  const loading = snapQuery.isLoading;
  const error = snapQuery.error
    ? (snapQuery.error instanceof Error
      ? snapQuery.error.message
      : String(snapQuery.error))
    : snapQuery.isSuccess && snapQuery.data === null
    ? t("shareSnapshotEmpty")
    : null;

  const toggle = () => setOpen((prev) => !prev);

  const label = (snapshot?.name && snapshot.name.trim()) || aggregation.aggregationId ||
    t("shareAggFallbackName");
  const entries = snapshot ? Object.entries(snapshot.values) : [];

  return (
    <ResourceRow
      title={<><strong>{label}</strong><TierDot tier="shared" /></>}
      subtitle={<>{t("shareSharedBy")} <AgentLabel value={aggregation.sharedBy} /></>}
      actions={
        <Button size="small" variant="text" onClick={toggle}>
          {open ? t("shareHideValues") : t("shareShowValues")}
        </Button>
      }
      expansion={open && (
        <Box sx={{ mt: 1 }}>
          {loading && (
            <Typography variant="body2" color="text.secondary">
              {t("loadingEllipsis")}
            </Typography>
          )}
          {error && (
            <Typography variant="body2" color="error">{error}</Typography>
          )}
          {snapshot && entries.length === 0 && (
            <Typography variant="body2" color="text.secondary">
              {t("shareNoComputedValues")}
            </Typography>
          )}
          {snapshot && entries.length > 0 && (
            <>
              <Typography variant="body2" color="text.secondary">
                {t("shareAcrossBuildings", {
                  type: snapshot.aggregationType,
                  count: snapshot.buildingCount,
                })}
              </Typography>
              <Table size="small">
                <TableBody>
                  {entries.map(([metric, value]) => (
                    <TableRow key={metric}>
                      <TableCell>{metric}</TableCell>
                      <TableCell align="right">
                        {formatNumber(value, 2)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <Box sx={{ mt: 1 }}>
                <MetricBarChart
                  data={entries.map(([name, value]) => ({ name, value }))}
                  bars={[{
                    key: "value",
                    name: `${snapshot.aggregationType} value`,
                    color: CHART_COLOR_PALETTE[0],
                    palette: CHART_COLOR_PALETTE,
                  }]}
                  xKey="name"
                  hideLegend
                />
              </Box>
            </>
          )}
        </Box>
      )}
    />
  );
}
