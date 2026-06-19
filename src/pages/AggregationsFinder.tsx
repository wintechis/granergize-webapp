import { useState } from "react";
import {
  Box,
  Button,
  IconButton,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import VisibilityIcon from "@mui/icons-material/Visibility";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Session } from "@inrupt/solid-client-authn-browser";
import type { AggregationDefinition } from "../types.ts";
import { aggregationRoute, regionalRoute } from "../routes.ts";
import { useNotification } from "../context/NotificationContext.tsx";
import { useConfirm } from "../context/ConfirmContext.tsx";
import {
  useAggregationDefinitions,
  useReceivedAggregations,
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
import ObjectActions from "../components/ObjectActions.tsx";
import Pager from "../components/Pager.tsx";
import NestedAgentList from "../components/NestedAgentList.tsx";
import { usePaging } from "../hooks/usePaging.ts";
import { useListSearch } from "../hooks/useListSearch.ts";
import { useListFacet } from "../hooks/useListFacet.ts";
import SearchField from "../components/SearchField.tsx";
import TierFilter from "../components/TierFilter.tsx";
import { AGGREGATION_TIERS } from "../constants/tiers.ts";
import { filterByText } from "../lib/textSearch.ts";
import {
  type OpenRegionalItem,
  openRegionalItemsFromBuildings,
} from "../services/openRegional.ts";
import ReceivedAggregationRow from "../components/aggregation/ReceivedAggregationRow.tsx";
import type { ReceivedAggregation } from "../services/interop/sharingManager.ts";
import ShareAggregationDialog from "../components/ShareAggregationDialog.tsx";
import CreateAggregationDialog from "../components/CreateAggregationDialog.tsx";
import AggregationsMap from "../components/aggregation/AggregationsMap.tsx";
import AggregationsTimeline from "../components/aggregation/AggregationsTimeline.tsx";

interface AggregationsFinderProps {
  session: Session;
}

/** A row in the unified Aggregations collection: an own definition (`mine`), a
 * snapshot shared with me (`shared`), or a public open-data regional dataset
 * (`open`). */
type AggItem =
  | { kind: "own"; def: AggregationDefinition }
  | { kind: "received"; recv: ReceivedAggregation }
  | { kind: "open"; open: OpenRegionalItem };

/** The finder's collection guises (plan-aggregations Slice 3): the list (today), a region
 * choropleth (Slice 4), and a cross-year timeline (Slice 5). URL-synced via `?guise=`. */
type Guise = "list" | "map" | "timeline";

const aggItemSearchText = (it: AggItem): string =>
  it.kind === "own"
    ? `${it.def.name} ${it.def.aggregationType}`
    : it.kind === "received"
    ? `${it.recv.aggregationId} ${it.recv.sharedBy}`
    : `${it.open.region} ${it.open.tableId}`;

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

  const [searchParams, setSearchParams] = useSearchParams();
  const [createAggregationOpen, setCreateAggregationOpen] = useState(false);
  const [aggregationToShare, setAggregationToShare] = useState<
    AggregationDefinition | null
  >(null);

  // Honour a palette-routed `?action=create-aggregation` by DERIVING the
  // dialog-open state from the URL (no setState-in-effect): the palette routes
  // this no-object create verb to the finder that owns its bespoke dialog
  // (plan-palette §5). The close handler strips the param so a reload/Back
  // doesn't re-open it.
  const actionIsCreate = searchParams.get("action") === "create-aggregation";
  const closeCreate = () => {
    setCreateAggregationOpen(false);
    if (actionIsCreate) {
      setSearchParams((prev) => {
        const sp = new URLSearchParams(prev);
        sp.delete("action");
        return sp;
      }, { replace: true });
    }
  };

  // Collection guise from the URL (`?guise=map|timeline`; absent → list). Single-select, so a
  // plain searchParams read/write (mirroring `action` above), not the multi-select listFacet.
  const rawGuise = searchParams.get("guise");
  const guise: Guise = rawGuise === "map" || rawGuise === "timeline" ? rawGuise : "list";
  const setGuise = (g: Guise) =>
    setSearchParams((prev) => {
      const sp = new URLSearchParams(prev);
      if (g === "list") sp.delete("guise"); // keep the default URL clean
      else sp.set("guise", g);
      return sp;
    }, { replace: true });

  const aggregationDefsQuery = useAggregationDefinitions();
  const aggregationDefinitions = aggregationDefsQuery.data ?? [];
  const receivedAggregationsQuery = useReceivedAggregations();
  const receivedAggregations = receivedAggregationsQuery.data ?? [];
  // Public open-data datasets (regionalstatistik), keyed to the regions of my own
  // buildings — derived in-memory (no network here; figures load on the detail page).
  const openItems = openRegionalItemsFromBuildings(buildings);
  const totalReachable = aggregationDefinitions.length +
    receivedAggregations.length + openItems.length;

  const { query, setQuery } = useListSearch();
  const tierFacet = useListFacet("tiers", AGGREGATION_TIERS);
  // Own aggregations are the `mine` tier; received (snapshots shared with me) the
  // `shared` tier; public regionalstatistik datasets the `open` tier — one
  // collection, the union of the ticked tiers (plan Slice 4 / Slice 6-7).
  const items: AggItem[] = [
    ...(tierFacet.isSelected("mine")
      ? aggregationDefinitions.map((def): AggItem => ({ kind: "own", def }))
      : []),
    ...(tierFacet.isSelected("shared")
      ? receivedAggregations.map((recv): AggItem => ({ kind: "received", recv }))
      : []),
    ...(tierFacet.isSelected("open")
      ? openItems.map((open): AggItem => ({ kind: "open", open }))
      : []),
  ];
  const filteredItems = filterByText(items, query, aggItemSearchText);
  const aggregationPaging = usePaging(filteredItems);
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
        {totalReachable > 0 && (
          <Stack
            direction="row"
            spacing={1.5}
            sx={{ flexWrap: "wrap", alignItems: "center", mb: 1 }}
          >
            <SearchField value={query} onChange={setQuery} />
            {/* The tier selector is always offered (whenever there are
                aggregations), even with a single tier, so the source-tier
                affordance stays discoverable. */}
            <TierFilter facet={tierFacet} options={AGGREGATION_TIERS} />
            <Box sx={{ flexGrow: 1 }} />
            <ToggleButtonGroup
              size="small"
              exclusive
              value={guise}
              onChange={(_e, next: Guise | null) => {
                if (next) setGuise(next); // ignore deselect of the active button
              }}
              aria-label={t("aggGuiseAria")}
            >
              <ToggleButton value="list">{t("btnList")}</ToggleButton>
              <ToggleButton value="map">{t("btnMap")}</ToggleButton>
              <ToggleButton value="timeline">{t("guiseTimeline")}</ToggleButton>
            </ToggleButtonGroup>
          </Stack>
        )}
        {aggregationDefsQuery.isLoading
          ? <Typography variant="body2">{t("loadingEllipsis")}</Typography>
          : totalReachable === 0
          ? (
            <Typography variant="body2">
              {t("aggregationsEmpty")}
            </Typography>
          )
          : guise === "map"
          // Slice 4: the collection on the choropleth, shaded by a chosen metric. Each tier is
          // included only when its facet is ticked (its own empty/loading states inside).
          ? (
            <AggregationsMap
              definitions={tierFacet.isSelected("mine") ? aggregationDefinitions : []}
              received={tierFacet.isSelected("shared") ? receivedAggregations : []}
              openItems={tierFacet.isSelected("open") ? openItems : []}
            />
          )
          : guise === "timeline"
          // Slice 5: the collection's chosen metric across the years (own computed per-year,
          // open from regionalstatistik, received a single point). Tiers per the facet.
          ? (
            <AggregationsTimeline
              definitions={tierFacet.isSelected("mine") ? aggregationDefinitions : []}
              received={tierFacet.isSelected("shared") ? receivedAggregations : []}
              openItems={tierFacet.isSelected("open") ? openItems : []}
            />
          )
          : filteredItems.length === 0
          ? (
            <Typography variant="body2">
              {query ? t("searchNoMatches", { query }) : t("filterNoMatch")}
            </Typography>
          )
          : (
            <Box
              component="ul"
              aria-label={t("navAggregations")}
              sx={{ listStyle: "none", pl: 0, m: 0 }}
            >
              {aggregationPaging.pageItems.map((item) => {
                if (item.kind === "received") {
                  return (
                    <ReceivedAggregationRow
                      key={item.recv.snapshotUri}
                      aggregation={item.recv}
                    />
                  );
                }
                if (item.kind === "open") {
                  const { open } = item;
                  return (
                    <ResourceRow
                      key={open.id}
                      title={<strong>{t(open.labelId)} — {open.region}</strong>}
                      subtitle={t("openRegionalMeta")}
                      actions={
                        // Public, read-only: the only affordance is opening the
                        // dataset's standalone figures page.
                        <Tooltip title={t("aggDetailsAria")}>
                          <IconButton
                            size="small"
                            aria-label={t("aggDetailsAria")}
                            onClick={() =>
                              navigate(regionalRoute(open.tableId, open.ags))}
                          >
                            <VisibilityIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      }
                    />
                  );
                }
                const aggregation = item.def;
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
                      // Registry-driven: which verbs apply (refresh needs a
                      // snapshot, share/delete always) comes from the intent
                      // registry's `applies()` guards, not inline conditionals.
                      // "Details" is navigation, not a mutation intent → leading.
                      <ObjectActions
                        object={aggregation}
                        handlers={{
                          RefreshAggregation: () =>
                            handleRefreshAggregation(aggregation.id),
                          ShareAggregation: () =>
                            setAggregationToShare(aggregation),
                          DeleteAggregation: () => {
                            void handleDeleteAggregation(aggregation.id);
                          },
                        }}
                        pending={(name) =>
                          (name === "RefreshAggregation" &&
                            refreshAggregation.isPending &&
                            refreshAggregation.variables === aggregation.id) ||
                          (name === "DeleteAggregation" &&
                            deleteAggregationMut.isPending &&
                            deleteAggregationMut.variables === aggregation.id)}
                        leading={
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
                        }
                      />
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
        {guise === "list" && <Pager paging={aggregationPaging} />}
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
        open={createAggregationOpen || actionIsCreate}
        buildings={buildings}
        onClose={closeCreate}
      />
    </Box>
  );
}
