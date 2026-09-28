import { msg } from "../../lib/messages.ts";
import { Box, Button, Chip, Stack, Typography } from "@mui/material";
import RefreshIcon from "@mui/icons-material/Refresh";
import type { AggregationDefinition } from "../../types.ts";
import { useRefreshAggregation } from "../../hooks/mutations.ts";
import { useNotification } from "../../context/NotificationContext.tsx";
import { BackLink } from "../detail/DetailView.tsx";
import { AGGREGATIONS_VIEW } from "../../routes.ts";

/** Capitalise the first letter (e.g. "average" → "Average"). */
function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * The aggregation page's identity header: a back link, the aggregation name,
 * a badge of its type, and a Refresh action (recomputes the snapshot). Sharing
 * lives in its own section, not here.
 */
export default function AggregationHeader(
  { definition }: { definition: AggregationDefinition },
) {
  const { showNotification } = useNotification();
  const refresh = useRefreshAggregation();
  const refreshing = refresh.isPending;

  const handleRefresh = () => {
    refresh.mutate(definition.id, {
      onSuccess: () => showNotification(msg("snapshotRefreshed"), "success"),
    });
  };

  return (
    <Box>
      <BackLink fallback={AGGREGATIONS_VIEW} />
      <Stack
        direction="row"
        sx={{
          alignItems: "center",
          justifyContent: "space-between",
          gap: 2,
          mt: 1,
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
          <Typography variant="h5">{definition.name}</Typography>
          <Chip label={capitalize(definition.aggregationType)} size="small" />
        </Box>
        {/* Button goes disabled while in flight — no inline spinner. */}
        <Button
          variant="outlined"
          startIcon={<RefreshIcon />}
          onClick={handleRefresh}
          disabled={refreshing}
        >
          {refreshing ? msg("aggRefreshing") : msg("aggRefreshBtn")}
        </Button>
      </Stack>
    </Box>
  );
}
