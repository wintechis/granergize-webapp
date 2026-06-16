import { msg } from "../../lib/messages.ts";
import { useMemo, useState } from "react";
import { Box, Button, Stack, Typography } from "@mui/material";
import ShareIcon from "@mui/icons-material/Share";
import { Session } from "@inrupt/solid-client-authn-browser";
import type { BuildingType } from "../../types.ts";
import { useNotification } from "../../context/NotificationContext.tsx";
import { useConfirm } from "../../context/ConfirmContext.tsx";
import { useSharedBuildings } from "../../hooks/queries.ts";
import { useRevokeBuildingAccess } from "../../hooks/mutations.ts";
import { buildingFileUri } from "../../services/rdf/building/buildingId.ts";
import NestedAgentList from "../NestedAgentList.tsx";
import { ShareBuildingDialog } from "../BuildingDialogs.tsx";

/**
 * The building page's Sharing STATUS section: who this (owned) building is shared with,
 * each with a Revoke action, and a [Share] button that opens the existing
 * {@link ShareBuildingDialog}. A shared building (the user is a recipient, not
 * the owner) has no sharing controls — it renders nothing.
 */
export default function SharingSection(
  { building, session, autoOpenShare }: {
    building: BuildingType;
    session: Session;
    /** Open the Share dialog on mount (the palette routed here `?action=share`). */
    autoOpenShare?: boolean;
  },
) {
  const { showNotification } = useNotification();
  const { confirm } = useConfirm();
  // Honour a palette-routed `?action=share` by SEEDING the open state from the
  // prop (no setState-in-effect): an own building opens the Share dialog on
  // arrival (a shared building renders nothing below, so the seed is harmless).
  const [shareOpen, setShareOpen] = useState(
    () => autoOpenShare === true && !building.isShared,
  );

  // The share grant / log key on the building FILE URI (fragment stripped), like
  // the manage list — the recipients map is keyed that way.
  const fileUri = buildingFileUri((building.sourceUri ?? building.uri) as string);

  const sharedQuery = useSharedBuildings();
  const sharedWith = useMemo(() => {
    for (const s of sharedQuery.data ?? []) {
      if (s.buildingUri === fileUri || s.buildingUri === building.uri) {
        return s.sharedWith;
      }
    }
    return [];
  }, [sharedQuery.data, fileUri, building.uri]);

  const revoke = useRevokeBuildingAccess();

  const handleRevoke = async (webId: string) => {
    if (
      !await confirm({
        title: msg("dlgRevokeAccess"),
        message: msg("confirmRevokeMessage", { webId }),
        confirmLabel: msg("confirmRevoke"),
      })
    ) return;
    revoke.mutate({ buildingUri: fileUri, webId }, {
      onSuccess: () => showNotification(msg("accessRevoked"), "success"),
    });
  };

  if (building.isShared) return null;

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
              revoke.variables?.buildingUri === fileUri &&
              revoke.variables?.webId === webId}
          />
        )}

      {shareOpen && (
        <ShareBuildingDialog
          open
          buildingUri={(building.sourceUri ?? building.uri) as string}
          building={building}
          session={session}
          onClose={() => setShareOpen(false)}
        />
      )}
    </Box>
  );
}
