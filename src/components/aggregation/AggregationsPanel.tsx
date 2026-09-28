import { useState } from "react";
import {
  Box,
  Button,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import { useSearchParams } from "react-router-dom";
import type { AggregationDefinition } from "../../types.ts";
import { aggregationRoute, regionalRoute } from "../../routes.ts";
import { regionalTableDataUrl } from "../../services/sources/regionalCube.ts";
import { useNotification } from "../../context/NotificationContext.tsx";
import { useConfirm } from "../../context/ConfirmContext.tsx";
import {
  useAggregationDefinitions,
  useReceivedAggregations,
  useSharedAggregations,
  useSolidData,
} from "../../hooks/queries.ts";
import {
  useDeleteAggregation,
  useRefreshAggregation,
  useRevokeAggregationAccess,
} from "../../hooks/mutations.ts";
import { getSnapshotUri } from "../../services/aggregation/aggregation.ts";
import { getSession } from "../../hooks/session.ts";
import { tryPodResources } from "../../services/pod/solidUtils.ts";
import { formatDate } from "../../lib/formatDate.ts";
import { RdfSourceLink, RefLink } from "../detail/DetailView.tsx";
import { useT } from "../../context/I18nProvider.tsx";
import { msg } from "../../lib/messages.ts";
import { useDevMode } from "../../hooks/devMode.ts";
import ResourceRow from "../ResourceRow.tsx";
import TierDot from "../TierDot.tsx";
import ObjectActions from "../ObjectActions.tsx";
import Pager from "../Pager.tsx";
import NestedAgentList from "../NestedAgentList.tsx";
import { usePaging } from "../../hooks/usePaging.ts";
import { useListSearch } from "../../hooks/useListSearch.ts";
import { useListFacet } from "../../hooks/useListFacet.ts";
import { rememberedValue, rememberValue } from "../../lib/facetMemory.ts";
import SearchField from "../SearchField.tsx";
import TierFilter from "../TierFilter.tsx";
import { AGGREGATION_TIERS } from "../../constants/tiers.ts";
import { finderRowStyle } from "../../constants/listStyles.ts";
import { filterByText } from "../../lib/textSearch.ts";
import {
  type OpenRegionalItem,
  openRegionalItemsFromBuildings,
} from "../../services/sources/openRegional.ts";
import ReceivedAggregationRow from "./ReceivedAggregationRow.tsx";
import type { ReceivedAggregation } from "../../services/interop/sharing.ts";
import ShareAggregationDialog from "../ShareAggregationDialog.tsx";
import CreateAggregationDialog from "../CreateAggregationDialog.tsx";
import AggregationsMap from "./AggregationsMap.tsx";
import AggregationsTimeline from "./AggregationsTimeline.tsx";

/** A row in the unified Aggregations collection: an own definition (`mine`), a
 * snapshot shared with me (`shared`), or a public open-data regional dataset
 * (`open`). */
type AggItem =
  | { kind: "own"; def: AggregationDefinition }
  | { kind: "received"; recv: ReceivedAggregation }
  | { kind: "open"; open: OpenRegionalItem };

/** The panel's collection guises (plan-aggregations Slice 3): the list (today), a region
 * choropleth (Slice 4), and a cross-year timeline (Slice 5). URL-synced via `?guise=`. */
type Guise = "list" | "map" | "timeline";

const aggItemSearchText = (it: AggItem): string =>
  it.kind === "own"
    ? `${it.def.name} ${it.def.aggregationType}`
    : it.kind === "received"
    ? `${it.recv.aggregationId} ${it.recv.sharedBy}`
    : `${it.open.region} ${it.open.tableId}`;

/**
 * The **saved views** panel — the aggregations you build from your (and shared-in) data:
 * create / share / revoke / refresh / delete; each row shows who it's shared with and
 * opens its detail page. Also carries the dev-only "Outgoing shares" raw-log link (the
 * append-only record backing every "Shared with" badge across the Buildings + saved-views
 * surfaces).
 *
 * It used to be its own top-nav finder (`/aggregations`, `AggregationsFinder`). Step 2 of
 * `plans/plan-cube-centered-ui.md` folded it into **Explore** as the `?view=aggregations`
 * projection (an aggregation IS a saved cube coordinate + roll-up spec), so this is a
 * plain component rendered inside the Explore finder's content region — with its own
 * heading row, controls row and `?guise=` sub-axis, the chrome the surface always had.
 * `/aggregations` stays as a redirect onto the folded form (`src/routes.ts`).
 */
export default function AggregationsPanel() {
  const { showNotification } = useNotification();
  const { confirm } = useConfirm();
  const { buildings } = useSolidData();
  const webId = getSession().info.webId;
  const rdf = webId ? tryPodResources(webId) : null;
  const dev = useDevMode();
  const t = useT();

  const [searchParams, setSearchParams] = useSearchParams();
  const [createAggregationOpen, setCreateAggregationOpen] = useState(false);
  const [aggregationToShare, setAggregationToShare] = useState<
    AggregationDefinition | null
  >(null);

  // Honour a palette-routed `?action=create-aggregation` by DERIVING the
  // dialog-open state from the URL (no setState-in-effect): the palette routes
  // this no-object create verb to the surface that owns its bespoke dialog
  // (plan-palette §5). The close handler strips the param so a reload/Back
  // doesn't re-open it. The Explore pivot/map "Save as aggregation" affordance
  // routes here the same way.
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

  // Collection guise from the URL (`?guise=map|timeline`; absent → the session-remembered
  // guise, else list). Single-select, so a plain searchParams read/write (mirroring `action`
  // above), not the multi-select listFacet; sticks for the session like the other view axes.
  const isGuise = (g: string | null): g is Guise =>
    g === "map" || g === "timeline" || g === "list";
  const rawGuise = searchParams.get("guise");
  const remembered = rememberedValue("guise");
  const guise: Guise = isGuise(rawGuise)
    ? rawGuise
    : isGuise(remembered)
    ? remembered
    : "list";
  const setGuise = (g: Guise) => {
    rememberValue("guise", g);
    setSearchParams((prev) => {
      const sp = new URLSearchParams(prev);
      if (g === "list") sp.delete("guise"); // keep the default URL clean
      else sp.set("guise", g);
      return sp;
    }, { replace: true });
  };

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
    if (!webId) return [];
    const snapshotUri = getSnapshotUri(webId, aggregationId);
    const shared = sharedAggregations.find((sv) => sv.snapshotUri === snapshotUri);
    return shared?.sharedWith || [];
  };

  return (
    <Box component="section">
      {/* The panel's own header + controls rows — the same two-row finder chrome
          `FinderHeader` renders, kept here because the surface is now a projection
          INSIDE Explore (whose own header names the surface and switches the view). */}
      <Box sx={finderRowStyle}>
        <Typography variant="h6">{t("navAggregations")}</Typography>
        {rdf?.aggregations && <RdfSourceLink href={rdf.aggregations} inline />}
        <Box sx={{ flexGrow: 1 }} />
        <Button
          variant="outlined"
          startIcon={<AddIcon />}
          onClick={() => setCreateAggregationOpen(true)}
        >
          {t("aggCreateTitle")}
        </Button>
      </Box>
      {totalReachable > 0 && (
        <Box sx={finderRowStyle}>
          <SearchField value={query} onChange={setQuery} />
          {/* The tier selector is always offered (whenever there are
              aggregations), even with a single tier, so the source-tier
              affordance stays discoverable. */}
          <TierFilter
            facet={tierFacet}
            options={AGGREGATION_TIERS}
            counts={{
              mine: aggregationDefinitions.length,
              shared: receivedAggregations.length,
              open: openItems.length,
            }}
          />
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
        </Box>
      )}

      {aggregationDefsQuery.isLoading || receivedAggregationsQuery.isLoading
        // Both Pod tiers must have settled before "no aggregations yet" —
        // with only defs gated, a still-loading received tier flashed the
        // empty state at a user whose aggregations are all shared-in.
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
                    title={
                      <>
                        <RefLink to={regionalRoute(open.tableId, open.ags)}>
                          <strong>{t(open.labelId)} — {open.region}</strong>
                        </RefLink>
                        <TierDot tier="open" />
                        {/* The public regionalstatistik cube doc backing this dataset
                            (dev-mode only; RdfSourceLink self-hides otherwise). */}
                        <RdfSourceLink
                          href={regionalTableDataUrl(open.tableId)}
                          inline
                        />
                      </>
                    }
                    subtitle={t("openRegionalMeta")}
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
                      <RefLink to={aggregationRoute(aggregation.id)}>
                        <strong>{aggregation.name}</strong>
                      </RefLink>
                      <TierDot tier="mine" />
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
                    // Opening is the linked title now — no separate "details" icon.
                    <ObjectActions
                      object={aggregation}
                      handlers={{
                        RefreshAggregation: () =>
                          handleRefreshAggregation(aggregation.id),
                        ShareAggregation: () => setAggregationToShare(aggregation),
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
                        onRevoke={(recipient) =>
                          handleRevokeAggregationAccess(
                            getSnapshotUri(webId!, aggregation.id),
                            recipient,
                          )}
                        isRevoking={(recipient) =>
                          revokeAggregation.isPending &&
                          revokeAggregation.variables?.snapshotUri ===
                            getSnapshotUri(webId!, aggregation.id) &&
                          revokeAggregation.variables?.webId === recipient}
                      />
                    )}
                </ResourceRow>
              );
            })}
          </Box>
        )}
      {guise === "list" && <Pager paging={aggregationPaging} />}

      {/* Outgoing-share log — the append-only record of buildings and aggregations you've
          shared out (and revoked). It backs the "Shared with" badges across the
          Buildings + saved-views surfaces; the symmetric incoming side (shared-in/ +
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
          session={getSession()}
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
