import { msg } from "../../lib/messages.ts";
import { useMemo, useState } from "react";
import { Box, Button, Stack, Typography } from "@mui/material";
import ShareIcon from "@mui/icons-material/Share";
import { Session } from "@inrupt/solid-client-authn-browser";
import type { AggregationDefinition } from "../../types.ts";
import { useNotification } from "../../context/NotificationContext.tsx";
import { useConfirm } from "../../context/ConfirmContext.tsx";
import { useSharedAggregations } from "../../hooks/queries.ts";
import { useRevokeAggregationAccess } from "../../hooks/mutations.ts";
import { getSnapshotUri } from "../../services/aggregation/aggregation.ts";
import NestedAgentList from "../NestedAgentList.tsx";
import ShareAggregationDialog from "../ShareAggregationDialog.tsx";

/**
 * The aggregation page's Sharing STATUS section: who this aggregation's snapshot
 * is shared with, each with a Revoke action, and a [Share] button that opens the
 * existing {@link ShareAggregationDialog}. Mirrors the building page's
 * SharingSection.
 */
export default function AggregationSharingSection(
  { aggregation, session, autoOpenShare }: {
    aggregation: AggregationDefinition;
    session: Session;
    /** Open the Share dialog on mount (palette routed here `?action=share-aggregation`). */
    autoOpenShare?: boolean;
  },
) {
  const { showNotification } = useNotification();
  const { confirm } = useConfirm();
  // Honour a palette-routed `?action=share-aggregation` by SEEDING the open state
  // from the prop (no setState-in-effect): open the bespoke Share dialog on
  // arrival.
  const [shareOpen, setShareOpen] = useState(() => autoOpenShare === true);

  // The snapshot is the shared resource (recipients see values only, not the
  // private building list); revoke keys on its IRI.
  const snapshotUri = session.info.webId
    ? getSnapshotUri(session.info.webId, aggregation.id)
    : "";

  const sharedQuery = useSharedAggregations();
  const sharedWith = useMemo(() => {
    const shares = (sharedQuery.data ?? []).filter(
      (s) => s.aggregationId === aggregation.id,
    );
    return [...new Set(shares.flatMap((s) => s.sharedWith))];
  }, [sharedQuery.data, aggregation.id]);

  const revoke = useRevokeAggregationAccess();

  const handleRevoke = async (webId: string) => {
    if (
      !await confirm({
        title: msg("dlgRevokeAccess"),
        message: msg("confirmRevokeMessage", { webId }),
        confirmLabel: msg("confirmRevoke"),
      })
    ) return;
    revoke.mutate({ snapshotUri, webId }, {
      onSuccess: () => showNotification(msg("accessRevoked"), "success"),
    });
  };

  return (
    <Box>
      <Stack
        direction="row"
        sx={{ alignItems: "center", justifyContent: "space-between", mb: 1 }}
      >
        <Typography variant="h6">{msg("secSharing")}</Typography>
        <Button
          size="small"
          startIcon={<ShareIcon fontSize="small" />}
          onClick={() => setShareOpen(true)}
        >
          {msg("btnShare")}
        </Button>
      </Stack>

      {sharedQuery.isLoading
        ? <Typography variant="body2" color="text.secondary">{msg("loadingEllipsis")}</Typography>
        : sharedWith.length === 0
        ? (
          <Typography variant="body2" color="text.secondary">
            {msg("shareBuildingNoneYet")}
          </Typography>
        )
        : (
          <NestedAgentList
            agents={sharedWith}
            label={msg("sharedWithLabel")}
            onRevoke={handleRevoke}
            isRevoking={(webId) =>
              revoke.isPending &&
              revoke.variables?.snapshotUri === snapshotUri &&
              revoke.variables?.webId === webId}
          />
        )}

      {shareOpen && (
        <ShareAggregationDialog
          open
          aggregation={aggregation}
          session={session}
          onClose={() => setShareOpen(false)}
        />
      )}
    </Box>
  );
}
