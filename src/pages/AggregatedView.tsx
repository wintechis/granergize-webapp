import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Box,
  Button,
  Card,
  CardContent,
  CardHeader,
  CircularProgress,
  Container,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  Paper,
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
import "chart.js/auto";
import { Bar } from "react-chartjs-2";
import { Session } from "@inrupt/solid-client-authn-browser";
import type {
  AggregatedViewDefinition,
  AggregatedViewSnapshot,
} from "../../types/types.ts";
import {
  getComputedSnapshotByViewId,
  getSnapshotUrl,
  getViewDefinition,
} from "../services/aggregation/viewManager.ts";
import { refreshSnapshot } from "../services/aggregation/viewComputer.ts";
import { shareAggregatedView } from "../services/interop/share.ts";
import { CHART_COLOR_PALETTE } from "../constants/chartColors.ts";
import { useNotification } from "../context/NotificationContext.tsx";

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

  useEffect(() => {
    if (viewId) {
      loadViewData();
    }
  }, [viewId]);

  const loadViewData = async () => {
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
  };

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
      await shareAggregatedView(
        snapshotUrl,
        viewId,
        shareWebId.trim(),
        session,
      );
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

  const chartData = {
    labels: snapshot ? Object.keys(snapshot.values) : [],
    datasets: [
      {
        label: `${
          viewDefinition.aggregationType.charAt(0).toUpperCase() +
          viewDefinition.aggregationType.slice(1)
        } Values`,
        data: snapshot ? Object.values(snapshot.values) : [],
        backgroundColor: CHART_COLOR_PALETTE.slice(
          0,
          snapshot ? Object.keys(snapshot.values).length : 0,
        ),
        borderColor: CHART_COLOR_PALETTE.slice(
          0,
          snapshot ? Object.keys(snapshot.values).length : 0,
        ),
        borderWidth: 1,
      },
    ],
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: false,
      },
      title: {
        display: true,
        text: `Aggregated Energy Metrics (${viewDefinition.aggregationType})`,
      },
    },
    scales: {
      y: {
        beginAtZero: true,
        title: {
          display: true,
          text: viewDefinition.period ? "kWh/month" : "kWh",
        },
      },
    },
  };

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Box
        display="flex"
        alignItems="center"
        justifyContent="space-between"
        mb={3}
      >
        <Box display="flex" alignItems="center" gap={2}>
          <IconButton onClick={() => navigate("/")}>
            <ArrowBackIcon />
          </IconButton>
          <Typography variant="h4">{viewDefinition.name}</Typography>
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
            display="grid"
            gridTemplateColumns="repeat(auto-fit, minmax(200px, 1fr))"
            gap={2}
          >
            <Box>
              <Typography variant="body2" color="textSecondary">
                Aggregation Type
              </Typography>
              <Typography variant="body1" sx={{ textTransform: "capitalize" }}>
                {viewDefinition.aggregationType}
              </Typography>
            </Box>
            <Box>
              <Typography variant="body2" color="textSecondary">
                Buildings Included
              </Typography>
              <Typography variant="body1">
                {viewDefinition.buildingUris.length}
              </Typography>
            </Box>
            <Box>
              <Typography variant="body2" color="textSecondary">
                Metrics
              </Typography>
              <Typography variant="body1">
                {viewDefinition.metrics.length}
              </Typography>
            </Box>
            <Box>
              <Typography variant="body2" color="textSecondary">
                Created
              </Typography>
              <Typography variant="body1">
                {new Date(viewDefinition.createdAt).toLocaleDateString()}
              </Typography>
            </Box>
            {viewDefinition.lastComputedAt && (
              <Box>
                <Typography variant="body2" color="textSecondary">
                  Last Computed
                </Typography>
                <Typography variant="body1">
                  {new Date(viewDefinition.lastComputedAt).toLocaleString()}
                </Typography>
              </Box>
            )}
            {viewDefinition.period && (
              <Box>
                <Typography variant="body2" color="textSecondary">
                  Period
                </Typography>
                <Typography variant="body1">
                  {new Date(`${viewDefinition.period}-01`).toLocaleString(
                    "default",
                    {
                      month: "long",
                      year: "numeric",
                    },
                  )}
                </Typography>
              </Box>
            )}
            {snapshot && (
              <Box>
                <Typography variant="body2" color="textSecondary">
                  Buildings in Snapshot
                </Typography>
                <Typography variant="body1">
                  {snapshot.buildingCount}
                </Typography>
              </Box>
            )}
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
                  <Bar data={chartData} options={chartOptions} />
                </Box>
              </CardContent>
            </Card>

            <Card>
              <CardHeader title="Aggregated Values Table" />
              <CardContent>
                <TableContainer component={Paper}>
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
      <Dialog
        open={shareDialogOpen}
        onClose={() => setShareDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Share Aggregated View</DialogTitle>
        <DialogContent>
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
          <Box display="flex" justifyContent="flex-end" gap={1} mt={2}>
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
          </Box>
        </DialogContent>
      </Dialog>
    </Container>
  );
}
