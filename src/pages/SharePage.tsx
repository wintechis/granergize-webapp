import { useEffect, useState } from "react";
import {
  Box,
  Button,
  IconButton,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableRow,
  Tooltip,
  Typography,
} from "@mui/material";
import DownloadIcon from "@mui/icons-material/Download";
import VisibilityIcon from "@mui/icons-material/Visibility";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOff";
import { Session } from "@inrupt/solid-client-authn-browser";
import type {
  AggregatedViewSnapshot,
  BuildingType,
} from "../types.ts";
import { CHART_COLOR_PALETTE } from "../constants/chartColors.ts";
import { useNotification } from "../context/NotificationContext.tsx";
import { logError } from "../lib/logError.ts";
import { formatError } from "../lib/formatError.ts";
import { useReceivedViews, useSharedWithMe } from "../hooks/queries.ts";
import { useCheckInbox, useToggleVisibility } from "../hooks/mutations.ts";
import { loadSharedBuilding } from "../services/interop/sharedBuilding.ts";
import {
  attachAnnualData,
  buildingsToXlsx,
  buildingToXlsx,
} from "../services/rdf/building/buildingSerializer.ts";
import { loadComputedSnapshot } from "../services/aggregation/viewManager.ts";
import { downloadXlsx } from "../lib/download.ts";
import { tryPodResources } from "../services/pod/solidUtils.ts";
import { RdfSourceLink, UriLink } from "../components/detail/DetailView.tsx";
import { AgentLabel } from "../components/AgentLabel.tsx";
import FilesSection from "../components/detail/FilesSection.tsx";
import { useDevMode } from "../hooks/devMode.ts";
import MetricBarChart from "../components/detail/MetricBarChart.tsx";
import { listStyle, rowStyle } from "../constants/listStyles.ts";
import Pager from "../components/Pager.tsx";
import { usePaging } from "../hooks/usePaging.ts";

interface SharePageProps {
  session: Session;
}

/**
 * One "view shared with you" row. Only the sharer's computed *snapshot* is
 * granted (not the definition), so we fetch it on demand from its URL (we hold
 * Read access) and show the aggregated values — a small table plus the same
 * SVG bar chart the owner sees.
 */
function ReceivedViewRow(
  { view, session }: {
    view: { snapshotUrl: string; viewId: string; sharedBy: string };
    session: Session;
  },
) {
  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<AggregatedViewSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Recipients hold Read on the snapshot (which carries the view's name) but not
  // the definition. Load it once so the row shows the view's NAME up front instead
  // of the opaque snapshot id — a bare `view-<ts>-<rand>` is useless in a "shared
  // with you" list. Expanding then reuses the already-loaded snapshot (no refetch).
  const ensureSnapshot = async () => {
    if (snapshot || loading) return;
    setLoading(true);
    setError(null);
    try {
      const snap = await loadComputedSnapshot(session, view.snapshotUrl);
      if (!snap) throw new Error("snapshot not found or empty");
      setSnapshot(snap);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    ensureSnapshot();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.snapshotUrl]);

  const toggle = () => {
    setOpen((prev) => !prev);
    ensureSnapshot();
  };

  const label = (snapshot?.name && snapshot.name.trim()) || view.viewId ||
    "Shared view";
  const entries = snapshot ? Object.entries(snapshot.values) : [];

  return (
    <li style={{ marginBottom: "1rem" }}>
      <div style={rowStyle}>
        <span style={{ minWidth: 0 }}>
          {label}
          <br />
          <small>
            Shared by: <AgentLabel value={view.sharedBy} />
          </small>
        </span>
        <Button size="small" variant="text" onClick={toggle}>
          {open ? "Hide values" : "Show values"}
        </Button>
      </div>
      {open && (
        <Box sx={{ mt: 1 }}>
          {loading && (
            <Typography variant="body2" color="text.secondary">
              Loading…
            </Typography>
          )}
          {error && (
            <Typography variant="body2" color="error">{error}</Typography>
          )}
          {snapshot && entries.length === 0 && (
            <Typography variant="body2" color="text.secondary">
              This view has no computed values.
            </Typography>
          )}
          {snapshot && entries.length > 0 && (
            <>
              <Typography variant="body2" color="text.secondary">
                {snapshot.aggregationType} across {snapshot.buildingCount}{" "}
                building(s)
              </Typography>
              <Table size="small">
                <TableBody>
                  {entries.map(([metric, value]) => (
                    <TableRow key={metric}>
                      <TableCell>{metric}</TableCell>
                      <TableCell align="right">
                        {value.toLocaleString("de-DE", {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <Box sx={{ mt: 1 }}>
                <MetricBarChart
                  data={entries.map(([name, value]) => ({ name, value }))}
                  bars={[{
                    key: "value",
                    name: `${snapshot.aggregationType} value`,
                    color: CHART_COLOR_PALETTE[0],
                    palette: CHART_COLOR_PALETTE,
                  }]}
                  xKey="name"
                  hideLegend
                />
              </Box>
            </>
          )}
        </Box>
      )}
    </li>
  );
}

/**
 * Files attached to a building shared with you: load the building lazily (its
 * attachments aren't in the lightweight shared-list entry) and render the shared
 * FilesSection, whose download fetches each binary with the recipient's own
 * session. Renders nothing while loading or when the building has no files.
 */
function SharedBuildingFiles(
  { entry, session }: {
    entry: { buildingUri: string; buildingId: string };
    session: Session;
  },
) {
  const [building, setBuilding] = useState<BuildingType | null>(null);
  useEffect(() => {
    let cancelled = false;
    loadSharedBuilding(entry, session)
      .then((b) => {
        if (!cancelled) setBuilding(b);
      })
      .catch((err) => logError("load shared building preview", err));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry.buildingUri]);

  return building ? <FilesSection building={building} /> : null;
}

/**
 * The SHARE tab: a pure inbox of what others have shared with you. Outgoing
 * sharing (your buildings and aggregated views) lives on the MANAGE tab.
 */
export default function SharePage({ session }: SharePageProps) {
  const { showNotification } = useNotification();
  const dev = useDevMode();

  const sharedWithMeQuery = useSharedWithMe();
  const sharedWithMe = sharedWithMeQuery.data ?? [];
  const loading = sharedWithMeQuery.isLoading;
  const sharedPaging = usePaging(sharedWithMe);

  const receivedViewsQuery = useReceivedViews();
  const receivedViews = receivedViewsQuery.data ?? [];
  const receivedViewsPaging = usePaging(receivedViews);

  const toggleVis = useToggleVisibility();
  const checkInbox = useCheckInbox();
  const [bundling, setBundling] = useState(false);

  // Dev-mode: drain the inbox on demand (it otherwise only happens at
  // login/reload), then surface the outcome.
  const handleCheckInbox = () =>
    checkInbox.mutate(undefined, {
      onSuccess: () => showNotification("Checked for new shares", "success"),
      onError: (err) =>
        showNotification(formatError("check for new shares", err), "error"),
    });

  // The Solid containers that back this tab, so the user can open the raw RDF:
  // shared-in/ backs "Buildings shared with you" (linked under that heading), and
  // inbox/ is linked in its own section below. `inbox` here is the convention path
  // (where ensureOwnInbox provisions it); the live location is discoverable but the
  // default is correct in practice. null until the storage root resolves.
  const webId = session.info.webId;
  const collections = webId ? tryPodResources(webId) : null;

  const handleDownloadBuilding = async (entry: {
    buildingUri: string;
    buildingId: string;
  }) => {
    try {
      const building = await loadSharedBuilding(entry, session);
      if (!building) throw new Error("no building data found in the source file");
      const [enriched] = await attachAnnualData([building], session);
      downloadXlsx(await buildingToXlsx(enriched), `building-${entry.buildingId}.xlsx`);
    } catch (error) {
      showNotification(formatError("export the building", error), "error");
    }
  };

  // Bundle every shared building into one multi-sheet workbook. Unreadable ones
  // (e.g. access revoked since the grant) are skipped, not fatal.
  const handleDownloadAll = async () => {
    if (sharedWithMe.length === 0) return;
    setBundling(true);
    try {
      const built: BuildingType[] = [];
      for (const entry of sharedWithMe) {
        try {
          const b = await loadSharedBuilding(entry, session);
          if (b) built.push(b);
        } catch (err) {
          logError("read shared building for bundle", err);
          // skip a building that can't be read right now
        }
      }
      if (built.length === 0) {
        throw new Error("none of the shared buildings could be read");
      }
      const enriched = await attachAnnualData(built, session);
      downloadXlsx(await buildingsToXlsx(enriched), "buildings-shared.xlsx");
      if (built.length < sharedWithMe.length) {
        showNotification(
          `Exported ${built.length} of ${sharedWithMe.length} buildings; the rest could not be read.`,
          "info",
        );
      }
    } catch (error) {
      showNotification(formatError("export the buildings", error), "error");
    } finally {
      setBundling(false);
    }
  };

  const handleToggleVisibility = (buildingUri: string) =>
    toggleVis.mutate(buildingUri);

  return (
    <section style={{ padding: "1.5rem" }}>
      <Typography variant="h6" sx={{ mb: 1 }}>
        Buildings shared with you
      </Typography>
      {dev && (
        <Button
          size="small"
          variant="outlined"
          onClick={handleCheckInbox}
          disabled={checkInbox.isPending}
          sx={{ mb: 1 }}
        >
          {checkInbox.isPending ? "Checking…" : "Check for new shares"}
        </Button>
      )}
      {collections && <RdfSourceLink href={collections.sharedIn} />}
      {loading
        ? <p>Loading…</p>
        : sharedWithMe.length === 0
        ? (
          <p>
            No buildings have been shared with you yet. Join a data room so
            owners can find you, or ask an owner to share with your WebID.
          </p>
        )
        : (
          <ul style={listStyle} aria-label="Buildings shared with you">
            {sharedPaging.pageItems.map((building) => (
              <li key={building.buildingUri} style={{ marginBottom: "1rem" }}>
                <div style={rowStyle}>
                <span style={{ minWidth: 0 }}>
                  Building {building.buildingId}
                  {dev && (
                    <>
                      <br />
                      <span style={{ wordBreak: "break-all" }}>
                        <UriLink href={building.buildingUri}>
                          {building.buildingUri}
                        </UriLink>
                      </span>
                    </>
                  )}
                  <br />
                  <small>
                    Shared by: <AgentLabel value={building.sharedBy} />
                  </small>
                </span>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.25rem",
                  }}
                >
                  <Tooltip title="Download this building's data (Excel)">
                    <IconButton
                      size="small"
                      aria-label="Download this building's data"
                      onClick={() => handleDownloadBuilding(building)}
                    >
                      <DownloadIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="Controls whether this building appears in your dashboard. Does not affect the owner's sharing settings.">
                    <label
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                      }}
                    >
                      <Switch
                        checked={building.isVisible}
                        onChange={() =>
                          handleToggleVisibility(building.buildingUri)}
                        disabled={toggleVis.isPending &&
                          toggleVis.variables === building.buildingUri}
                        icon={<VisibilityOffIcon />}
                        checkedIcon={<VisibilityIcon />}
                      />
                      {building.isVisible ? "Shown" : "Hidden"}
                    </label>
                  </Tooltip>
                </div>
                </div>
                <SharedBuildingFiles entry={building} session={session} />
              </li>
            ))}
          </ul>
        )}
      <Pager paging={sharedPaging} />
      {sharedWithMe.length > 0 && (
        <Button
          variant="outlined"
          startIcon={<DownloadIcon />}
          onClick={handleDownloadAll}
          disabled={bundling}
          sx={{ mt: 1 }}
        >
          {bundling ? "Preparing…" : "Download all (Excel)"}
        </Button>
      )}

      <Typography variant="h6" sx={{ mt: 4, mb: 1 }}>
        Views shared with you
      </Typography>
      {receivedViewsQuery.isLoading
        ? <p>Loading…</p>
        : receivedViews.length === 0
        ? <p>No aggregated views have been shared with you yet.</p>
        : (
          <ul style={listStyle} aria-label="Views shared with you">
            {receivedViewsPaging.pageItems.map((view) => (
              <ReceivedViewRow
                key={view.snapshotUrl}
                view={view}
                session={session}
              />
            ))}
          </ul>
        )}
      <Pager paging={receivedViewsPaging} />

      {/* Your inbox — the receiving endpoint others post to when they share with
          you. Notices are drained into shared-in/ and surface in the lists above.
          Developer-mode only: this exposes the raw transport container. */}
      {dev && collections && (
        <>
          <Typography variant="h6" sx={{ mt: 4, mb: 1 }}>Your inbox</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            Sharing invitations and notifications from others arrive in your app
            inbox, then surface in the lists above. Open it to browse the raw
            RDF.
          </Typography>
          <RdfSourceLink href={collections.inbox} />
        </>
      )}
    </section>
  );
}
