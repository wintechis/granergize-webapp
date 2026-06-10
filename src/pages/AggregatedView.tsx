import { type ReactNode, useEffect, useState } from "react";
import Modal from "../components/Modal.tsx";
import { useNavigate, useParams } from "react-router-dom";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CardHeader,
  CircularProgress,
  Container,
  IconButton,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import RefreshIcon from "@mui/icons-material/Refresh";
import ShareIcon from "@mui/icons-material/Share";
import MetricBarChart from "../components/detail/MetricBarChart.tsx";
import { Session } from "@inrupt/solid-client-authn-browser";
import type {
  AggregatedViewDefinition,
  AggregatedViewSnapshot,
} from "../types.ts";
import {
  getComputedSnapshotByViewId,
  getSnapshotUrl,
  getViewDefinition,
} from "../services/aggregation/viewManager.ts";
import { refreshSnapshot } from "../services/aggregation/viewComputer.ts";
import {
  useRefreshView,
  useShareViewSnapshot,
} from "../hooks/mutations.ts";
import { CHART_COLOR_PALETTE } from "../constants/chartColors.ts";
import { useNotification } from "../context/NotificationContext.tsx";
import { formatDate, formatDateTime } from "../lib/formatDate.ts";
import { formatNumber } from "../lib/formatNumber.ts";
import { formatError } from "../lib/formatError.ts";
import { annualMetricLabel } from "../constants/annualMetrics.ts";

interface AggregatedViewProps {
  session: Session;
}

export default function AggregatedView({ session }: AggregatedViewProps) {
  const { viewId } = useParams<{ viewId: string }>();
  const navigate = useNavigate();
  const { showNotification } = useNotification();

  const [viewDefinition, setViewDefinition] = useState<
    AggregatedViewDefinition | null
  >(null);
  const [snapshot, setSnapshot] = useState<AggregatedViewSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [shareWebId, setShareWebId] = useState("");
  // The writes go through mutation hooks (busy = isPending, error toasts +
  // invalidations central); this page keeps the results in local state because
  // it renders outside the main data flow (standalone /view/:id route).
  const refreshMut = useRefreshView();
  const refreshing = refreshMut.isPending;
  const shareMut = useShareViewSnapshot();
  const sharing = shareMut.isPending;

  // Load (and possibly auto-compute) the view. Cancellation matters here:
  // navigating /view/A → /view/B while A's load — or its multi-fetch
  // auto-compute — is in flight must not let A's late completion land its
  // state on top of B's page.
  useEffect(() => {
    if (!viewId) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [definition, snapshotData] = await Promise.all([
          getViewDefinition(session, viewId),
          getComputedSnapshotByViewId(session, viewId),
        ]);
        if (cancelled) return;

        if (!definition) {
          setError("View not found");
          return;
        }
        setViewDefinition(definition);

        // Auto-compute on first open: a freshly-created view has no snapshot yet,
        // so the summary would otherwise show an empty "Refresh Snapshot" prompt.
        // Materialise it now so the chart/table render immediately. Best-effort —
        // on failure fall back to the manual Refresh affordance. Safe to key on
        // null: loadComputedSnapshot returns null ONLY for genuine absence (404)
        // and THROWS on transient failures (caught by the outer handler), so a
        // failed read of an existing snapshot can never trigger this write.
        let snap = snapshotData;
        if (!snap) {
          try {
            const result = await refreshSnapshot(session, viewId);
            const updated = await getViewDefinition(session, viewId);
            if (cancelled) return;
            snap = result.snapshot;
            if (updated) setViewDefinition(updated);
          } catch (err) {
            if (cancelled) return;
            showNotification(formatError("compute the view summary", err), "warning");
          }
        }
        if (!cancelled) setSnapshot(snap);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load view");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [session, viewId, showNotification]);

  const handleRefresh = () => {
    if (!viewId) return;
    refreshMut.mutate(viewId, {
      onSuccess: async (result) => {
        setSnapshot(result.snapshot);
        // Reload definition to get updated lastComputedAt
        const definition = await getViewDefinition(session, viewId);
        if (definition) {
          setViewDefinition(definition);
        }
        showNotification("Snapshot refreshed", "success");
      },
    });
  };

  const handleShare = () => {
    if (!viewId || !shareWebId.trim() || !session.info.webId) return;
    const snapshotUrl = getSnapshotUrl(session.info.webId, viewId);
    shareMut.mutate({ snapshotUrl, recipients: [shareWebId.trim()] }, {
      onSuccess: () => {
        setShareDialogOpen(false);
        setShareWebId("");
        showNotification("View shared successfully", "success");
      },
    });
  };

  if (loading) {
    return (
      <Box
        display="flex"
        justifyContent="center"
        alignItems="center"
        height="100vh"
      >
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Button
          startIcon={<ArrowBackIcon />}
          onClick={() => navigate("/")}
          sx={{ mb: 2 }}
        >
          Back to Overview
        </Button>
        <Typography color="error">{error}</Typography>
      </Container>
    );
  }

  if (!viewDefinition) {
    return (
      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Button
          startIcon={<ArrowBackIcon />}
          onClick={() => navigate("/")}
          sx={{ mb: 2 }}
        >
          Back to Overview
        </Button>
        <Typography>View not found</Typography>
      </Container>
    );
  }

  // Human metric labels (with units) from the shared annual-metric schema —
  // never the raw camelCase identifier.
  const chartRows = snapshot
    ? Object.entries(snapshot.values).map(([metric, value]) => ({
      name: annualMetricLabel(metric),
      value,
    }))
    : [];
  const aggregationLabel = `${
    viewDefinition.aggregationType.charAt(0).toUpperCase() +
    viewDefinition.aggregationType.slice(1)
  } Values`;

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Box
        display="flex"
        alignItems="center"
        justifyContent="space-between"
        mb={3}
      >
        <Box display="flex" alignItems="center" gap={2}>
          <IconButton onClick={() => navigate("/")} aria-label="Back to overview">
            <ArrowBackIcon />
          </IconButton>
          <Typography variant="h5">{viewDefinition.name}</Typography>
        </Box>
        <Box display="flex" gap={1}>
          {/* Buttons go disabled while in flight — no inline spinner (the
              full-page-route spinner exemption covers the PAGE load only). */}
          <Button
            variant="outlined"
            startIcon={<RefreshIcon />}
            onClick={handleRefresh}
            disabled={refreshing}
          >
            {refreshing ? "Refreshing…" : "Refresh Snapshot"}
          </Button>
          <Button
            variant="contained"
            startIcon={<ShareIcon />}
            onClick={() => setShareDialogOpen(true)}
          >
            Share
          </Button>
        </Box>
      </Box>

      <Card sx={{ mb: 3 }}>
        <CardHeader title="View Details" />
        <CardContent>
          <Box
            component="dl"
            display="grid"
            gridTemplateColumns="repeat(auto-fit, minmax(200px, 1fr))"
            gap={2}
            sx={{ m: 0 }}
          >
            {(
              [
                [
                  "Aggregation Type",
                  <Box component="span" sx={{ textTransform: "capitalize" }}>
                    {viewDefinition.aggregationType}
                  </Box>,
                ],
                ["Buildings Included", viewDefinition.buildingUris.length],
                ["Metrics", viewDefinition.metrics.length],
                [
                  "Created",
                  formatDate(viewDefinition.createdAt),
                ],
                viewDefinition.lastComputedAt && [
                  "Last Computed",
                  formatDateTime(viewDefinition.lastComputedAt),
                ],
                viewDefinition.period && [
                  "Period",
                  new Date(`${viewDefinition.period}-01`).toLocaleString(
                    "default",
                    { month: "long", year: "numeric" },
                  ),
                ],
                snapshot && ["Buildings in Snapshot", snapshot.buildingCount],
              ].filter(Boolean) as [string, ReactNode][]
            ).map(([label, value]) => (
              <div key={label}>
                <Typography component="dt" variant="body2" color="textSecondary">
                  {label}
                </Typography>
                <Typography component="dd" variant="body1" sx={{ m: 0 }}>
                  {value}
                </Typography>
              </div>
            ))}
          </Box>
        </CardContent>
      </Card>

      {snapshot && chartRows.length === 0 && (
        // A snapshot can legitimately compute to NO values — the selected
        // metrics are absent from every included building, or the chosen month
        // has no readings. Say so instead of rendering bare empty axes
        // (heike-4's "empty diagram"). Inline persistent state → Alert.
        <Alert severity="info">
          The computed summary contains no values: none of the included
          buildings carry data for the selected metrics
          {viewDefinition.period ? " in the selected month" : ""}. Enter energy
          data for them (or adjust the view), then refresh the snapshot.
        </Alert>
      )}
      {snapshot && chartRows.length > 0 && (
          <>
            <Card sx={{ mb: 3 }}>
              <CardHeader title="Aggregated Values Chart" />
              <CardContent>
                <Box height={400}>
                  <MetricBarChart
                    data={chartRows}
                    bars={[{
                      key: "value",
                      name: aggregationLabel,
                      color: CHART_COLOR_PALETTE[0],
                      palette: CHART_COLOR_PALETTE,
                    }]}
                    xKey="name"
                    yUnit={viewDefinition.period ? "kWh/month" : "kWh"}
                    height={400}
                    hideLegend
                  />
                </Box>
              </CardContent>
            </Card>

            <Card>
              <CardHeader title="Aggregated Values Table" />
              <CardContent>
                <TableContainer>
                  <Table>
                    <TableHead>
                      <TableRow>
                        <TableCell>Metric</TableCell>
                        <TableCell align="right">
                          {/* Units live in the per-metric row labels — a flat
                              "(kWh)" here lied for the m³ and % metrics. */}
                          {viewDefinition.aggregationType.charAt(0)
                            .toUpperCase() +
                            viewDefinition.aggregationType.slice(1)} Value
                        </TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {Object.entries(snapshot.values).map((
                        [metric, value],
                      ) => (
                        <TableRow key={metric}>
                          <TableCell component="th" scope="row">
                            {annualMetricLabel(metric)}
                          </TableCell>
                          <TableCell align="right">
                            {formatNumber(value, 2)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </CardContent>
            </Card>
          </>
      )}
      {!snapshot && (
        <Card>
          <CardContent>
            <Typography color="textSecondary" align="center">
              No snapshot computed yet. Click "Refresh Snapshot" to compute
              aggregated values.
            </Typography>
          </CardContent>
        </Card>
      )}

      {/* Share Dialog */}
      <Modal
        open={shareDialogOpen}
        onClose={() => setShareDialogOpen(false)}
        dirty={shareWebId.trim() !== ""}
        busy={sharing}
        title="Share Aggregated View"
        actions={
          <>
            <Button
              onClick={() => setShareDialogOpen(false)}
              disabled={sharing}
            >
              Cancel
            </Button>
            <Button
              onClick={handleShare}
              variant="contained"
              disabled={!shareWebId.trim() || sharing}
            >
              {sharing ? "Sharing…" : "Share"}
            </Button>
          </>
        }
      >
        <Typography variant="body2" sx={{ mb: 2 }}>
          Share this view with another user. They will receive access to the
          computed snapshot values only, without seeing which buildings were
          included.
        </Typography>
        <TextField
          autoFocus
          margin="dense"
          label="Recipient WebID"
          type="url"
          fullWidth
          variant="outlined"
          value={shareWebId}
          onChange={(e) => setShareWebId(e.target.value)}
          placeholder="https://example.solidcommunity.net/profile/card#me"
        />
      </Modal>
    </Container>
  );
}
