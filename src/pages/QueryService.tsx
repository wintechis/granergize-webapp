import { useState } from "react";
import {
  Box,
  Typography,
  Card,
  CardContent,
  CardActions,
  IconButton,
  Chip,
  Alert,
  CircularProgress,
} from "@mui/material";
import Grid from "@mui/material/Grid2";
import RefreshIcon from "@mui/icons-material/Refresh";
import ShareIcon from "@mui/icons-material/Share";
import DeleteIcon from "@mui/icons-material/Delete";
import VisibilityIcon from "@mui/icons-material/Visibility";
import { useNavigate } from "react-router-dom";
import { Session } from "@inrupt/solid-client-authn-browser";
import { AggregatedViewDefinition } from "../../types/types.ts";
import { deleteView } from "../services/aggregation/viewManager.ts";
import { refreshSnapshot } from "../services/aggregation/viewComputer.ts";
import ShareViewDialog from "../components/ShareViewDialog.tsx";

interface ViewsPageProps {
  session: Session;
  viewDefinitions: AggregatedViewDefinition[];
  onRefreshViews: () => void;
}

export default function ViewsPage({ session, viewDefinitions, onRefreshViews }: ViewsPageProps) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [selectedViewForShare, setSelectedViewForShare] = useState<AggregatedViewDefinition | null>(null);

  const handleViewClick = (viewId: string) => {
    navigate(`/view/${encodeURIComponent(viewId)}`);
  };

  const handleRefreshView = async (view: AggregatedViewDefinition) => {
    if (!session.info.webId) return;
    setLoading(view.id);
    setError(null);
    try {
      await refreshSnapshot(session, view.id);
      onRefreshViews();
    } catch (err) {
      setError(`Failed to refresh view: ${err}`);
    } finally {
      setLoading(null);
    }
  };

  const handleShareView = (view: AggregatedViewDefinition) => {
    setSelectedViewForShare(view);
    setShareDialogOpen(true);
  };

  const handleDeleteView = async (view: AggregatedViewDefinition) => {
    if (!session.info.webId) return;
    if (!globalThis.confirm(`Delete view "${view.name}"?`)) return;
    
    setLoading(view.id);
    setError(null);
    try {
      await deleteView(session, view.id);
      onRefreshViews();
    } catch (err) {
      setError(`Failed to delete view: ${err}`);
    } finally {
      setLoading(null);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <Box p={3}>
      <Box sx={{ display: "flex", alignItems: "center", mb: 3 }}>
        <Typography variant="h4">
          Aggregated Views
        </Typography>
        <IconButton onClick={onRefreshViews} sx={{ ml: 2 }}>
          <RefreshIcon />
        </IconButton>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {viewDefinitions.length === 0 ? (
        <Alert severity="info">
          No aggregated views yet. Click "Create View" in the header to create your first view.
        </Alert>
      ) : (
        <Grid container spacing={3}>
          {viewDefinitions.map((view) => (
            <Grid size={{ xs: 12, sm: 6, md: 4 }} key={view.id}>
              <Card 
                sx={{ 
                  height: "100%", 
                  display: "flex", 
                  flexDirection: "column",
                  cursor: "pointer",
                  "&:hover": { boxShadow: 4 },
                }}
                onClick={() => handleViewClick(view.id)}
              >
                <CardContent sx={{ flexGrow: 1 }}>
                  <Typography variant="h6" gutterBottom>
                    {view.name}
                  </Typography>
                  <Box sx={{ mb: 1 }}>
                    <Chip 
                      label={view.aggregationType} 
                      size="small" 
                      color="primary" 
                      variant="outlined"
                      sx={{ mr: 1 }}
                    />
                    <Chip 
                      label={`${view.buildingUris.length} buildings`} 
                      size="small" 
                      variant="outlined"
                    />
                  </Box>
                  <Typography variant="body2" color="text.secondary">
                    Metrics: {view.metrics.join(", ")}
                  </Typography>
                  {view.lastComputedAt && (
                    <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
                      Last updated: {formatDate(view.lastComputedAt)}
                    </Typography>
                  )}
                </CardContent>
                <CardActions sx={{ justifyContent: "flex-end" }} onClick={(e) => e.stopPropagation()}>
                  <IconButton 
                    size="small" 
                    onClick={() => handleViewClick(view.id)}
                    title="View details"
                  >
                    <VisibilityIcon fontSize="small" />
                  </IconButton>
                  <IconButton 
                    size="small" 
                    onClick={() => handleRefreshView(view)}
                    disabled={loading === view.id}
                    title="Refresh data"
                  >
                    {loading === view.id ? (
                      <CircularProgress size={18} />
                    ) : (
                      <RefreshIcon fontSize="small" />
                    )}
                  </IconButton>
                  <IconButton 
                    size="small" 
                    onClick={() => handleShareView(view)}
                    title="Share view"
                  >
                    <ShareIcon fontSize="small" />
                  </IconButton>
                  <IconButton 
                    size="small" 
                    onClick={() => handleDeleteView(view)}
                    disabled={loading === view.id}
                    color="error"
                    title="Delete view"
                  >
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </CardActions>
              </Card>
            </Grid>
          ))}
        </Grid>
      )}

      {selectedViewForShare && (
        <ShareViewDialog
          open={shareDialogOpen}
          onClose={() => {
            setShareDialogOpen(false);
            setSelectedViewForShare(null);
          }}
          view={selectedViewForShare}
          session={session}
        />
      )}
    </Box>
  );
}
