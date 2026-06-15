import { useParams } from "react-router-dom";
import { useBackNavigation } from "../hooks/backNavigation.ts";
import {
  Box,
  Button,
  CircularProgress,
  Container,
  Divider,
  Stack,
  Typography,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import { Session } from "@inrupt/solid-client-authn-browser";
import { useAggregationDetail } from "../hooks/queries.ts";
import { classifyQueryError } from "../hooks/queryErrors.ts";
import { tryPodResources } from "../services/pod/solidUtils.ts";
import { RdfSourceLink } from "../components/detail/DetailView.tsx";
import AggregationHeader from "../components/aggregation/AggregationHeader.tsx";
import AggregationDetailsSection from "../components/aggregation/AggregationDetailsSection.tsx";
import AggregationResultsSection from "../components/aggregation/AggregationResultsSection.tsx";
import AggregationSharingSection from "../components/aggregation/AggregationSharingSection.tsx";

interface AggregationProps {
  session: Session;
}

/**
 * The AGGREGATION PAGE — a single scrolling column of read-first sections for
 * one aggregated view: an identity header (back link, name, type badge, Refresh),
 * its definition details, the computed results (chart + table, or an empty/no-
 * snapshot state), and the sharing status (who the snapshot is shared with,
 * revoke, and a Share dialog) — mirroring the building page's master-detail
 * composition.
 */
export default function Aggregation({ session }: AggregationProps) {
  const { id: aggregationId } = useParams<{ id: string }>();
  // Back = the in-app location the user came from (Manage, Share, …), falling
  // back to the overview for a deep link — see useBackNavigation.
  const goBack = useBackNavigation();

  // Reads go through the aggregationDetail query (definition + snapshot; a missing
  // snapshot is auto-materialised in the queryFn — see useAggregationDetail), so the
  // navigate-away race is the cache's problem, not this page's: a late /aggregation/A
  // completion lands in A's cache entry, never on B's render. Writes go
  // through mutation hooks (busy = isPending, error toasts central); their
  // aggregationDetail invalidation refetches the query, so no result lands in local
  // state.
  const detail = useAggregationDetail(aggregationId);
  const definition = detail.data?.definition ?? null;
  const snapshot = detail.data?.snapshot ?? null;

  // Dev-mode-only source link to the backing definition resource
  // (`aggregations/<id>.ttl`); self-hides outside dev mode, null until the root
  // resolves.
  const rdf = session.info.webId ? tryPodResources(session.info.webId) : null;

  if (detail.isPending) {
    return (
      <Box
        sx={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          height: "100vh",
        }}
      >
        <CircularProgress />
      </Box>
    );
  }

  if (detail.isError) {
    return (
      <Container maxWidth="md" sx={{ py: 4 }}>
        <Button startIcon={<ArrowBackIcon />} onClick={goBack} sx={{ mb: 2 }}>
          Back
        </Button>
        <Typography color="error">
          {classifyQueryError(detail.error).message}
        </Typography>
      </Container>
    );
  }

  if (!definition) {
    return (
      <Container maxWidth="md" sx={{ py: 4 }}>
        <Button startIcon={<ArrowBackIcon />} onClick={goBack} sx={{ mb: 2 }}>
          Back
        </Button>
        <Typography>Aggregation not found</Typography>
      </Container>
    );
  }

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Stack spacing={3} divider={<Divider />}>
        <AggregationHeader definition={definition} />
        <AggregationDetailsSection definition={definition} snapshot={snapshot} />
        <AggregationResultsSection
          definition={definition}
          snapshot={snapshot}
          computeError={detail.data?.computeError}
        />
        <AggregationSharingSection aggregation={definition} session={session} />
        {rdf && (
          <RdfSourceLink href={`${rdf.aggregations}${definition.id}.ttl`} />
        )}
      </Stack>
    </Container>
  );
}
