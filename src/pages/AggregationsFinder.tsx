import { useState } from "react";
import {
  Box,
  Button,
  IconButton,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import ShareIcon from "@mui/icons-material/Share";
import RefreshIcon from "@mui/icons-material/Refresh";
import VisibilityIcon from "@mui/icons-material/Visibility";
import { useNavigate } from "react-router-dom";
import { Session } from "@inrupt/solid-client-authn-browser";
import type { AggregationDefinition } from "../types.ts";
import { aggregationRoute } from "../routes.ts";
import { useNotification } from "../context/NotificationContext.tsx";
import { useConfirm } from "../context/ConfirmContext.tsx";
import {
  useAggregationDefinitions,
  useSharedAggregations,
  useSolidData,
} from "../hooks/queries.ts";
import {
  useDeleteAggregation,
  useRefreshAggregation,
  useRevokeAggregationAccess,
} from "../hooks/mutations.ts";
import { getSnapshotUri } from "../services/aggregation/aggregationManager.ts";
import { tryPodResources } from "../services/pod/solidUtils.ts";
import { formatDate } from "../lib/formatDate.ts";
import { RdfSourceLink } from "../components/detail/DetailView.tsx";
import { useT } from "../context/I18nProvider.tsx";
import { msg } from "../lib/messages.ts";
import { useDevMode } from "../hooks/devMode.ts";
import ResourceRow from "../components/ResourceRow.tsx";
import Pager from "../components/Pager.tsx";
import NestedAgentList from "../components/NestedAgentList.tsx";
import { usePaging } from "../hooks/usePaging.ts";
import ShareAggregationDialog from "../components/ShareAggregationDialog.tsx";
import CreateAggregationDialog from "../components/CreateAggregationDialog.tsx";

interface AggregationsFinderProps {
  session: Session;
}

/**
 * The Aggregations finder (`/aggregations`): the aggregations you build from your
 * (and shared-in) data — create / share / revoke / refresh / delete; each row
 * shows who it's shared with and opens its detail page. Also carries the
 * dev-only "Outgoing shares" raw-log link (the append-only record backing every
 * "Shared with" badge across the Buildings + Aggregations finders). Split out of
 * the former Manage page, which folded buildings and aggregations together.
 */
export default function AggregationsFinder({ session }: AggregationsFinderProps) {
  const { showNotification } = useNotification();
  const { confirm } = useConfirm();
  const { buildings } = useSolidData();
  const navigate = useNavigate();
  const rdf = session.info.webId ? tryPodResources(session.info.webId) : null;
  const dev = useDevMode();
  const t = useT();

  const [createAggregationOpen, setCreateAggregationOpen] = useState(false);
  const [aggregationToShare, setAggregationToShare] = useState<
    AggregationDefinition | null
  >(null);

  const aggregationDefsQuery = useAggregationDefinitions();
  const aggregationDefinitions = aggregationDefsQuery.data ?? [];
  const aggregationPaging = usePaging(aggregationDefinitions);
  const sharedAggregationsQuery = useSharedAggregations();
  const sharedAggregations = sharedAggregationsQuery.data ?? [];

  const refreshAggregation = useRefreshAggregation();
  const deleteAggregationMut = useDeleteAggregation();
  const revokeAggregation = useRevokeAggregationAccess();

  const handleRefreshAggregation = (aggregationId: string) =>
    refreshAggregation.mutate(aggregationId, {
      onSuccess: () => showNotification(msg("snapshotRefreshed"), "success"),
    });

  const handleDeleteAggregation = async (aggregationId: string) => {
    if (
      !await confirm({
        title: msg("dlgDeleteAggregation"),
        message:
          msg("aggDeleteConfirm"),
        confirmLabel: msg("btnDelete"),
      })
    ) {
      return;
    }
    deleteAggregationMut.mutate(aggregationId, {
      onSuccess: () => showNotification(msg("aggregationDeleted"), "success"),
    });
  };

  const handleRevokeAggregationAccess = async (snapshotUri: string, webId: string) => {
    if (
      !await confirm({
        title: msg("dlgRevokeAggregation"),
        message: msg("aggRevokeMessage", { webId }),
        confirmLabel: msg("confirmRevoke"),
      })
    ) return;
    revokeAggregation.mutate({ snapshotUri, webId }, {
      onSuccess: () => showNotification(msg("aggregationAccessRevoked"), "success"),
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
    <Box component="section" sx={{ p: 3, flexGrow: 1, minHeight: 0, overflow: "auto" }}>
      <section>
        <Typography variant="h6" sx={{ mb: 1 }}>
          {t("navAggregations")}
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
            {t("aggCreateTitle")}
          </Button>
        </Stack>
        {aggregationDefsQuery.isLoading
          ? <Typography variant="body2">{t("loadingEllipsis")}</Typography>
          : aggregationDefinitions.length === 0
          ? (
            <Typography variant="body2">
              {t("aggregationsEmpty")}
            </Typography>
          )
          : (
            <Box component="ul" sx={{ listStyle: "none", pl: 0, m: 0 }}>
              {aggregationPaging.pageItems.map((aggregation) => {
                const sharedWith = getAggregationSharedWith(aggregation.id);
                return (
                  <ResourceRow
                    key={aggregation.id}
                    title={
                      <>
                        <strong>{aggregation.name}</strong>
                        {rdf && (
                          <RdfSourceLink
                            href={`${rdf.aggregations}${aggregation.id}.ttl`}
                            inline
                          />
                        )}
                      </>
                    }
                    subtitle={
                      <>
                        {t("aggRowMeta", {
                          type: aggregation.aggregationType,
                          buildings: aggregation.buildingUris.length,
                          metrics: aggregation.metrics.length,
                        })}
                        <br />
                        {t("aggRowCreated", { date: formatDate(aggregation.createdAt) })}
                        {aggregation.lastComputedAt &&
                          ` | ${
                            t("aggRowLastComputed", {
                              date: formatDate(aggregation.lastComputedAt),
                            })
                          }`}
                      </>
                    }
                    actions={
                      <>
                        <Tooltip title={t("aggDetailsAria")}>
                          <IconButton
                            size="small"
                            aria-label={t("aggDetailsAria")}
                            onClick={() =>
                              navigate(aggregationRoute(aggregation.id))}
                          >
                            <VisibilityIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title={t("aggRefreshAria")}>
                          <span>
                            <IconButton
                              size="small"
                              aria-label={t("aggRefreshAria")}
                              onClick={() => handleRefreshAggregation(aggregation.id)}
                              disabled={refreshAggregation.isPending &&
                                refreshAggregation.variables === aggregation.id}
                            >
                              <RefreshIcon />
                            </IconButton>
                          </span>
                        </Tooltip>
                        <Tooltip title={t("aggShareAria")}>
                          <IconButton
                            size="small"
                            aria-label={t("aggShareAria")}
                            onClick={() => setAggregationToShare(aggregation)}
                          >
                            <ShareIcon />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title={t("aggDeleteAria")}>
                          <span>
                            <IconButton
                              size="small"
                              aria-label={t("aggDeleteAria")}
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
                          {t("sharedWithLabel")} {t("loadingEllipsis")}
                        </Typography>
                      )
                      : (
                        <NestedAgentList
                          agents={sharedWith}
                          label={t("sharedWithLabel")}
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
          shared out (and revoked). It backs the "Shared with" badges across the
          Buildings + Aggregations finders; the symmetric incoming side (shared-in/ +
          inbox) lives on the Sharing finder. Developer-mode only: this exposes the
          raw log container. */}
      {dev && rdf && (
        <section>
          <Typography variant="h6" sx={{ mt: 4, mb: 1 }}>
            {t("headingOutgoingShares")}
          </Typography>
          <RdfSourceLink href={rdf.sharedOut} />
        </section>
      )}

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
