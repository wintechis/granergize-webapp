import { type ReactNode, useCallback, useEffect, useState } from "react";
import Modal from "../components/Modal.tsx";
import { useNavigate, useParams } from "react-router-dom";
import {
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
import { shareAggregatedView } from "../services/interop/share.ts";
import { CHART_COLOR_PALETTE } from "../constants/chartColors.ts";
import { useNotification } from "../context/NotificationContext.tsx";
import { formatDate, formatDateTime } from "../services/utils/formatDate.ts";

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
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [shareWebId, setShareWebId] = useState("");
  const [sharing, setSharing] = useState(false);

  const loadViewData = useCallback(async () => {
    if (!viewId) return;

    setLoading(true);
    setError(null);

    try {
      const [definition, snapshotData] = await Promise.all([
        getViewDefinition(session, viewId),
        getComputedSnapshotByViewId(session, viewId),
      ]);

      if (!definition) {
        setError("View not found");
        return;
      }

      setViewDefinition(definition);
      setSnapshot(snapshotData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load view");
    } finally {
      setLoading(false);
    }
  }, [session, viewId]);

  useEffect(() => {
    loadViewData();
  }, [loadViewData]);

  const handleRefresh = async () => {
    if (!viewId) return;

    setRefreshing(true);
    try {
      const result = await refreshSnapshot(session, viewId);
      setSnapshot(result.snapshot);
      // Reload definition to get updated lastComputedAt
      const definition = await getViewDefinition(session, viewId);
      if (definition) {
        setViewDefinition(definition);
      }
      showNotification("Snapshot refreshed", "success");
    } catch (err) {
      showNotification(
        `Failed to refresh: ${
          err instanceof Error ? err.message : String(err)
        }`,
        "error",
      );
    } finally {
      setRefreshing(false);
    }
  };

  const handleShare = async () => {
    if (!viewId || !shareWebId.trim() || !session.info.webId) return;

    setSharing(true);
    try {
      const snapshotUrl = getSnapshotUrl(session.info.webId, viewId);
      await shareAggregatedView(snapshotUrl, shareWebId.trim(), session);
      setShareDialogOpen(false);
      setShareWebId("");
      showNotification("View shared successfully", "success");
    } catch (err) {
      showNotification(
        `Failed to share: ${err instanceof Error ? err.message : String(err)}`,
        "error",
      );
    } finally {
      setSharing(false);
    }
  };

  const formatNumber = (value: number): string => {
    return new Intl.NumberFormat("de-DE", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
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

  const chartRows = snapshot
    ? Object.entries(snapshot.values).map(([name, value]) => ({ name, value }))
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
          <Button
            variant="outlined"
            startIcon={refreshing
              ? <CircularProgress size={20} />
              : <RefreshIcon />}
            onClick={handleRefresh}
            disabled={refreshing}
          >
            Refresh Snapshot
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

      {snapshot
        ? (
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
                          {viewDefinition.aggregationType.charAt(0)
                            .toUpperCase() +
                            viewDefinition.aggregationType.slice(1)} Value (kWh)
                        </TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {Object.entries(snapshot.values).map((
                        [metric, value],
                      ) => (
                        <TableRow key={metric}>
                          <TableCell component="th" scope="row">
                            {metric.charAt(0).toUpperCase() + metric.slice(1)}
                          </TableCell>
                          <TableCell align="right">
                            {formatNumber(value)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </CardContent>
            </Card>
          </>
        )
        : (
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
              {sharing ? <CircularProgress size={20} /> : "Share"}
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
