import { buildingDisplayName } from "../lib/buildingDisplay.ts";
import { buildingFileUri } from "../services/rdf/building/buildingId.ts";
import { aggregationRoute } from "../routes.ts";
import { useMemo, useState } from "react";
import {
  Box,
  Button,
  IconButton,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import DownloadIcon from "@mui/icons-material/Download";
import DeleteIcon from "@mui/icons-material/Delete";
import ShareIcon from "@mui/icons-material/Share";
import RefreshIcon from "@mui/icons-material/Refresh";
import VisibilityIcon from "@mui/icons-material/Visibility";
import { useNavigate } from "react-router-dom";
import { Session } from "@inrupt/solid-client-authn-browser";
import type {
  AggregationDefinition,
  BuildingType,
} from "../types.ts";
import { useNotification } from "../context/NotificationContext.tsx";
import { useConfirm } from "../context/ConfirmContext.tsx";
import {
  useSharedBuildings,
  useSharedAggregations,
  useSolidData,
  useAggregationDefinitions,
} from "../hooks/queries.ts";
import {
  useDeleteBuilding,
  useDeleteAggregation,
  useRefreshAggregation,
  useRevokeBuildingAccess,
  useRevokeAggregationAccess,
} from "../hooks/mutations.ts";
import { getSnapshotUri } from "../services/aggregation/aggregationManager.ts";
import { attachAnnualData } from "../services/rdf/building/buildingSerializer.ts";
import { buildingsToXlsx } from "../services/rdf/buildingWorkbook.ts";
import { buildBuildingDeletionPreview } from "../services/buildingActions.ts";
import { tryPodResources } from "../services/pod/solidUtils.ts";
import { formatError } from "../lib/formatError.ts";
import { formatDate } from "../lib/formatDate.ts";
import { downloadXlsx } from "../lib/download.ts";
import {
  RdfSourceLink,
  RefLink,
  UriLink,
} from "../components/detail/DetailView.tsx";
import { useDevMode } from "../hooks/devMode.ts";
import ResourceRow from "../components/ResourceRow.tsx";
import RowAction from "../components/RowAction.tsx";
import Pager from "../components/Pager.tsx";
import NestedAgentList from "../components/NestedAgentList.tsx";
import { usePaging } from "../hooks/usePaging.ts";
import AddBuildingDialog from "../components/AddBuildingDialog.tsx";
import ShareAggregationDialog from "../components/ShareAggregationDialog.tsx";
import CreateAggregationDialog from "../components/CreateAggregationDialog.tsx";

interface ManagePageProps {
  session: Session;
}

/**
 * The MANAGE tab: manage everything you own. Buildings are finder rows — the
 * name navigates to the building page (/building/:id, where edit / files /
 * energy / share / download all live) and the row carries one destructive
 * action (delete); each row still shows who it's shared with (and revokes) — and
 * aggregations you build from your (and shared-in) data: create / share /
 * revoke / refresh / delete. This is the single home for outgoing data: the
 * map's detail pane is view-only, and SHARE shows only what others shared with you.
 */
export default function ManagePage({ session }: ManagePageProps) {
  const { showNotification } = useNotification();
  const { confirm } = useConfirm();
  const { buildings, isLoading: buildingsLoading } = useSolidData();
  const navigate = useNavigate();
  const ownedBuildings = buildings.filter((b) => !b.isShared);
  const buildingPaging = usePaging(ownedBuildings);
  const rdf = session.info.webId ? tryPodResources(session.info.webId) : null;
  const dev = useDevMode();

  const [addOpen, setAddOpen] = useState(false);
  const [importMode, setImportMode] = useState(false);
  const [createAggregationOpen, setCreateAggregationOpen] = useState(false);
  const [aggregationToShare, setAggregationToShare] = useState<
    AggregationDefinition | null
  >(null);

  // buildingUri → WebIDs it is shared with.
  const sharedQuery = useSharedBuildings();
  const recipients = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const s of sharedQuery.data ?? []) map[s.buildingUri] = s.sharedWith;
    return map;
  }, [sharedQuery.data]);

  const aggregationDefsQuery = useAggregationDefinitions();
  const aggregationDefinitions = aggregationDefsQuery.data ?? [];
  const aggregationPaging = usePaging(aggregationDefinitions);
  const sharedAggregationsQuery = useSharedAggregations();
  const sharedAggregations = sharedAggregationsQuery.data ?? [];

  const deleteBuilding = useDeleteBuilding();
  const revoke = useRevokeBuildingAccess();
  const refreshAggregation = useRefreshAggregation();
  const deleteAggregationMut = useDeleteAggregation();
  const revokeAggregation = useRevokeAggregationAccess();

  const handleDelete = async (building: BuildingType) => {
    // Build the "what will be removed" preview, confirm, then delete (the
    // confirm lives here, not in the service — same pattern as handleRevoke).
    const { message } = await buildBuildingDeletionPreview(session, building);
    if (!await confirm({ title: "Delete building", message, confirmLabel: "Delete" })) {
      return;
    }
    deleteBuilding.mutate(building, {
      onSuccess: () => showNotification("Building deleted", "success"),
    });
  };

  const handleRevoke = async (buildingUri: string, webId: string) => {
    if (
      !await confirm({
        title: "Revoke access",
        message: `Revoke access for ${webId}?`,
        confirmLabel: "Revoke",
      })
    ) return;
    revoke.mutate({ buildingUri, webId }, {
      onSuccess: () => showNotification("Access revoked", "success"),
    });
  };

  const handleDownloadAll = async () => {
    if (ownedBuildings.length === 0) return;
    try {
      const enriched = await attachAnnualData(ownedBuildings, session);
      downloadXlsx(await buildingsToXlsx(enriched), "buildings-mine.xlsx");
    } catch (error) {
      showNotification(formatError("export the buildings", error), "error");
    }
  };

  const handleRefreshAggregation = (aggregationId: string) =>
    refreshAggregation.mutate(aggregationId, {
      onSuccess: () => showNotification("Aggregation snapshot refreshed", "success"),
    });

  const handleDeleteAggregation = async (aggregationId: string) => {
    if (
      !await confirm({
        title: "Delete aggregation",
        message:
          "Delete this aggregation? This also revokes access for everyone it is shared with.",
        confirmLabel: "Delete",
      })
    ) {
      return;
    }
    deleteAggregationMut.mutate(aggregationId, {
      onSuccess: () => showNotification("Aggregation deleted", "success"),
    });
  };

  const handleRevokeAggregationAccess = async (snapshotUri: string, webId: string) => {
    if (
      !await confirm({
        title: "Revoke aggregation access",
        message: `Revoke aggregation access for ${webId}?`,
        confirmLabel: "Revoke",
      })
    ) return;
    revokeAggregation.mutate({ snapshotUri, webId }, {
      onSuccess: () => showNotification("Aggregation access revoked", "success"),
    });
  };

  const getAggregationSharedWith = (aggregationId: string): string[] => {
    const webId = session.info.webId;
    if (!webId) return [];
    const snapshotUri = getSnapshotUri(webId, aggregationId);
    const shared = sharedAggregations.find((sv) => sv.snapshotUri === snapshotUri);
    return shared?.sharedWith || [];
  };

  return (
    <Box component="section" sx={{ p: 3 }}>
      <section>
        <Typography variant="h6" sx={{ mb: 1 }}>Your buildings</Typography>
        {rdf && <RdfSourceLink href={rdf.buildings} />}
        <Stack
          direction="row"
          spacing={1.5}
          sx={{ flexWrap: "wrap", alignItems: "center", mb: 1 }}
        >
          <Button
            variant="outlined"
            startIcon={<AddIcon />}
            onClick={() => {
              setImportMode(false);
              setAddOpen(true);
            }}
          >
            Add Building
          </Button>
          <Button
            variant="outlined"
            startIcon={<UploadFileIcon />}
            onClick={() => {
              setImportMode(true);
              setAddOpen(true);
            }}
          >
            Autofill from file
          </Button>
          <Button
            variant="outlined"
            startIcon={<DownloadIcon />}
            onClick={handleDownloadAll}
            disabled={ownedBuildings.length === 0}
          >
            Download all (Excel)
          </Button>
        </Stack>

        {buildingsLoading
          ? <Typography variant="body2">Loading…</Typography>
          : ownedBuildings.length === 0
          ? (
            <Typography variant="body2">
              No buildings yet. Add one, or autofill it from a file.
            </Typography>
          )
          : (
            <Box component="ul" sx={{ listStyle: "none", pl: 0, m: 0 }}>
              {buildingPaging.pageItems.map((b) => {
                const fileUri = buildingFileUri(b.sourceUri ?? b.uri);
                const sharedWith = recipients[fileUri] ?? recipients[b.uri] ??
                  [];
                const name = buildingDisplayName(b);
                return (
                  // data-building-id: the row shows the DISPLAY name (label /
                  // address), so the e2e suite resolves a row's id from this
                  // attribute instead of parsing the old "Building <id>" text.
                  <ResourceRow
                    key={b.uri}
                    buildingId={b.id}
                    title={
                      <>
                        <RefLink
                          to={`/building/${encodeURIComponent(b.id)}`}
                        >
                          <strong>{name}</strong>
                        </RefLink>
                        {b.streetAddress && b.streetAddress !== name
                          ? ` — ${b.streetAddress}`
                          : ""}
                        {dev && (
                          <Box
                            component="span"
                            sx={{ display: "block", wordBreak: "break-all" }}
                          >
                            <UriLink href={b.uri as string}>{b.uri}</UriLink>
                          </Box>
                        )}
                      </>
                    }
                    actions={
                      // A finder row carries at most one (destructive) action;
                      // Edit / Files / energy / Share / Download all live on the
                      // building page (/building/:id) now.
                      <RowAction
                        label="Delete building"
                        color="error"
                        icon={<DeleteIcon fontSize="small" />}
                        onClick={() => handleDelete(b)}
                      />
                    }
                  >
                    {sharedQuery.isLoading
                      ? (
                        <Typography variant="caption" color="text.secondary">
                          Shared with: Loading…
                        </Typography>
                      )
                      : (
                        <NestedAgentList
                          agents={sharedWith}
                          label="Shared with:"
                          onRevoke={(webId) => handleRevoke(fileUri, webId)}
                          isRevoking={(webId) =>
                            revoke.isPending &&
                            revoke.variables?.buildingUri === fileUri &&
                            revoke.variables?.webId === webId}
                        />
                      )}
                  </ResourceRow>
                );
              })}
            </Box>
          )}
        <Pager paging={buildingPaging} />
      </section>

      <section>
        <Typography variant="h6" sx={{ mt: 4, mb: 1 }}>
          Aggregations
        </Typography>
        {rdf && <RdfSourceLink href={rdf.aggregations} />}
        <Stack
          direction="row"
          spacing={1.5}
          sx={{ flexWrap: "wrap", alignItems: "center", mb: 1 }}
        >
          <Button
            variant="outlined"
            startIcon={<AddIcon />}
            onClick={() => setCreateAggregationOpen(true)}
          >
            Create aggregation
          </Button>
        </Stack>
        {aggregationDefsQuery.isLoading
          ? <Typography variant="body2">Loading…</Typography>
          : aggregationDefinitions.length === 0
          ? (
            <Typography variant="body2">
              No aggregations yet. Create one to aggregate energy values
              across buildings.
            </Typography>
          )
          : (
            <Box component="ul" sx={{ listStyle: "none", pl: 0, m: 0 }}>
              {aggregationPaging.pageItems.map((aggregation) => {
                const sharedWith = getAggregationSharedWith(aggregation.id);
                return (
                  <ResourceRow
                    key={aggregation.id}
                    title={<strong>{aggregation.name}</strong>}
                    subtitle={
                      <>
                        Type: {aggregation.aggregationType} | Buildings:{" "}
                        {aggregation.buildingUris.length} | Metrics:{" "}
                        {aggregation.metrics.length}
                        <br />
                        Created: {formatDate(aggregation.createdAt)}
                        {aggregation.lastComputedAt &&
                          ` | Last computed: ${formatDate(aggregation.lastComputedAt)}`}
                      </>
                    }
                    actions={
                      <>
                        <Tooltip title="Aggregation details">
                          <IconButton
                            size="small"
                            aria-label="Aggregation details"
                            onClick={() =>
                              navigate(aggregationRoute(aggregation.id))}
                          >
                            <VisibilityIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Refresh snapshot">
                          <span>
                            <IconButton
                              size="small"
                              aria-label="Refresh snapshot"
                              onClick={() => handleRefreshAggregation(aggregation.id)}
                              disabled={refreshAggregation.isPending &&
                                refreshAggregation.variables === aggregation.id}
                            >
                              <RefreshIcon />
                            </IconButton>
                          </span>
                        </Tooltip>
                        <Tooltip title="Share aggregation">
                          <IconButton
                            size="small"
                            aria-label="Share aggregation"
                            onClick={() => setAggregationToShare(aggregation)}
                          >
                            <ShareIcon />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Delete aggregation">
                          <span>
                            <IconButton
                              size="small"
                              aria-label="Delete aggregation"
                              onClick={() => handleDeleteAggregation(aggregation.id)}
                              disabled={deleteAggregationMut.isPending &&
                                deleteAggregationMut.variables === aggregation.id}
                            >
                              <DeleteIcon />
                            </IconButton>
                          </span>
                        </Tooltip>
                      </>
                    }
                  >
                    {sharedAggregationsQuery.isLoading
                      ? (
                        <Typography variant="caption" color="text.secondary">
                          Shared with: Loading…
                        </Typography>
                      )
                      : (
                        <NestedAgentList
                          agents={sharedWith}
                          label="Shared with:"
                          onRevoke={(webId) =>
                            handleRevokeAggregationAccess(
                              getSnapshotUri(session.info.webId!, aggregation.id),
                              webId,
                            )}
                          isRevoking={(webId) =>
                            revokeAggregation.isPending &&
                            revokeAggregation.variables?.snapshotUri ===
                              getSnapshotUri(session.info.webId!, aggregation.id) &&
                            revokeAggregation.variables?.webId === webId}
                        />
                      )}
                  </ResourceRow>
                );
              })}
            </Box>
          )}
        <Pager paging={aggregationPaging} />
      </section>

      {/* Outgoing-share log — the append-only record of buildings and aggregations you've
          shared out (and revoked). It backs the "Shared with" badges above; the
          symmetric incoming side (shared-in/ + inbox) lives on the Share tab.
          Developer-mode only: this exposes the raw log container. */}
      {dev && rdf && (
        <section>
          <Typography variant="h6" sx={{ mt: 4, mb: 1 }}>
            Outgoing shares
          </Typography>
          <RdfSourceLink href={rdf.sharedOut} />
        </section>
      )}

      <AddBuildingDialog
        open={addOpen}
        autostartImport={importMode}
        onClose={() => setAddOpen(false)}
      />
      {aggregationToShare && (
        <ShareAggregationDialog
          aggregation={aggregationToShare}
          open
          onClose={() => setAggregationToShare(null)}
          session={session}
        />
      )}
      <CreateAggregationDialog
        open={createAggregationOpen}
        buildings={buildings}
        onClose={() => setCreateAggregationOpen(false)}
      />
    </Box>
  );
}
