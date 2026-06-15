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
      <SectionTitle>Details</SectionTitle>
      <Box sx={{ mt: 1 }}>
        <DetailRow
          label="Type"
          value={capitalize(definition.aggregationType)}
        />
        <DetailRow
          label="Buildings included"
          value={definition.buildingUris.length}
        />
        <DetailRow label="Metrics" value={definition.metrics.length} />
        <DetailRow label="Created" value={formatDate(definition.createdAt)} />
        {definition.lastComputedAt && (
          <DetailRow
            label="Last computed"
            value={formatDateTime(definition.lastComputedAt)}
          />
        )}
        {definition.period && (
          <DetailRow
            label="Period"
            value={new Date(`${definition.period}-01`).toLocaleString(
              "default",
              { month: "long", year: "numeric" },
            )}
          />
        )}
        {snapshot && (
          <DetailRow
            label="Buildings in snapshot"
            value={snapshot.buildingCount}
          />
        )}
      </Box>
    </Box>
  );
}
