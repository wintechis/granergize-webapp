import { msg } from "../../lib/messages.ts";
import { Box } from "@mui/material";
import type {
  AggregationDefinition,
  AggregationSnapshot,
} from "../../types.ts";
import { DetailRow, SectionTitle } from "../detail/DetailView.tsx";
import { formatDate, formatDateTime } from "../../lib/formatDate.ts";

/** Capitalise the first letter (e.g. "average" → "Average"). */
function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * The aggregation page's Details section: the definition's metadata (type,
 * building/metric counts, timestamps, optional period and snapshot building
 * count) as standard label/value rows.
 */
export default function AggregationDetailsSection(
  { definition, snapshot }: {
    definition: AggregationDefinition;
    snapshot: AggregationSnapshot | null;
  },
) {
  return (
    <Box>
      <SectionTitle>{msg("secDetails")}</SectionTitle>
      <Box sx={{ mt: 1 }}>
        <DetailRow
          label={msg("aggDetType")}
          value={capitalize(definition.aggregationType)}
        />
        <DetailRow
          label={msg("aggDetBuildingsIncluded")}
          value={definition.buildingUris.length}
        />
        <DetailRow label={msg("aggDetMetrics")} value={definition.metrics.length} />
        <DetailRow label={msg("aggDetCreated")} value={formatDate(definition.createdAt)} />
        {definition.lastComputedAt && (
          <DetailRow
            label={msg("aggDetLastComputed")}
            value={formatDateTime(definition.lastComputedAt)}
          />
        )}
        {definition.period && (
          <DetailRow
            label={msg("aggDetPeriod")}
            value={new Date(`${definition.period}-01`).toLocaleString(
              "default",
              { month: "long", year: "numeric" },
            )}
          />
        )}
        {snapshot && (
          <DetailRow
            label={msg("aggDetBuildingsInSnapshot")}
            value={snapshot.buildingCount}
          />
        )}
      </Box>
    </Box>
  );
}
