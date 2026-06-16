import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
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
import { ACTION_PARAM } from "../routes.ts";
import { usePaletteFocus } from "../context/PaletteFocusContext.tsx";
import { useNotification } from "../context/NotificationContext.tsx";
import { useConfirm } from "../context/ConfirmContext.tsx";
import { msg } from "../lib/messages.ts";
import { useAggregationDetail } from "../hooks/queries.ts";
import {
  useDeleteAggregation,
  useRefreshAggregation,
} from "../hooks/mutations.ts";
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
  // The aggregation reference is a query param now (`?ref=` relative / `?uri=`
  // absolute), not a path segment — matching the building/observation routes.
  const [searchParams] = useSearchParams();
  const aggregationId = searchParams.get("uri") ?? searchParams.get("ref") ??
    undefined;
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

  // A palette-routed Share arrives with `?action=share-aggregation`, opened by
  // the sharing section on mount (plan-palette §5).
  const action = searchParams.get(ACTION_PARAM);

  // Register this aggregation as the ⌘K palette's focused object, with the SIMPLE
  // (param-less) verbs the palette can fire directly: refresh + delete. Rich
  // Share carries no handler — the palette routes here `?action=share-aggregation`
  // instead. The hooks stay the implementation (busy/toast/invalidation theirs).
  const { showNotification } = useNotification();
  const { confirm } = useConfirm();
  const { setFocus, clearFocus } = usePaletteFocus();
  const refresh = useRefreshAggregation();
  const remove = useDeleteAggregation();
  useEffect(() => {
    if (!definition) return;
    const id = definition.id;
    setFocus({
      object: definition,
      handlers: {
        RefreshAggregation: () =>
          refresh.mutate(id, {
            onSuccess: () => showNotification(msg("snapshotRefreshed"), "success"),
          }),
        DeleteAggregation: () => {
          void (async () => {
            if (
              !await confirm({
                title: msg("dlgDeleteAggregation"),
                message:
                  "Delete this aggregation? This also revokes access for everyone it is shared with.",
                confirmLabel: "Delete",
              })
            ) return;
            remove.mutate(id, {
              onSuccess: () => {
                showNotification(msg("aggregationDeleted"), "success");
                goBack();
              },
            });
          })();
        },
      },
    });
    return () => clearFocus();
    // Re-register when the focused aggregation changes; the rest are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [definition?.id]);

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
      <Container maxWidth="lg" sx={{ py: 4 }}>
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
      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Button startIcon={<ArrowBackIcon />} onClick={goBack} sx={{ mb: 2 }}>
          Back
        </Button>
        <Typography>{msg("aggNotFound")}</Typography>
      </Container>
    );
  }

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Stack spacing={3} divider={<Divider />}>
        <AggregationHeader definition={definition} />
        <AggregationDetailsSection definition={definition} snapshot={snapshot} />
        <AggregationResultsSection
          definition={definition}
          snapshot={snapshot}
          computeError={detail.data?.computeError}
        />
        <AggregationSharingSection
          aggregation={definition}
          session={session}
          autoOpenShare={action === "share-aggregation"}
        />
        {rdf && (
          <RdfSourceLink href={`${rdf.aggregations}${definition.id}.ttl`} />
        )}
      </Stack>
    </Container>
  );
}
