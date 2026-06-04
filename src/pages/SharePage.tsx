import { useState } from "react";
import {
  Button,
  IconButton,
  Switch,
  Tooltip,
  Typography,
} from "@mui/material";
import DownloadIcon from "@mui/icons-material/Download";
import VisibilityIcon from "@mui/icons-material/Visibility";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOff";
import { Parser } from "n3";
import { Session } from "@inrupt/solid-client-authn-browser";
import type { BuildingType } from "../../types/types.ts";
import { ROLE_LABELS } from "../constants/roles.ts";
import { useNotification } from "../context/NotificationContext.tsx";
import { formatError } from "../services/utils/formatError.ts";
import { useSharedWithMe } from "../hooks/queries.ts";
import { useToggleVisibility } from "../hooks/mutations.ts";
import { parseBuildings } from "../services/utils/buildingParser.ts";
import {
  attachAnnualData,
  buildingsToXlsx,
  buildingToXlsx,
} from "../services/utils/buildingSerializer.ts";
import { downloadXlsx } from "../services/utils/download.ts";
import { UriLink } from "../components/detail/DetailView.tsx";
import { listStyle, rowStyle } from "../components/listStyles.ts";
import Pager from "../components/Pager.tsx";
import { usePaging } from "../components/usePaging.ts";

interface SharePageProps {
  session: Session;
}

/**
 * The SHARE tab: a pure inbox of what others have shared with you. Outgoing
 * sharing (your buildings and aggregated views) lives on the MANAGE tab.
 */
export default function SharePage({ session }: SharePageProps) {
  const { showNotification } = useNotification();

  const sharedWithMeQuery = useSharedWithMe();
  const sharedWithMe = sharedWithMeQuery.data ?? [];
  const loading = sharedWithMeQuery.isLoading;
  const sharedPaging = usePaging(sharedWithMe);

  const toggleVis = useToggleVisibility();
  const [bundling, setBundling] = useState(false);

  // Load a shared building as a typed BuildingType. Unlike the MANAGE tab (which
  // has the buildings in memory), shared buildings aren't all loaded — hidden
  // ones are pruned from useSolidData — so fetch the source document and parse it.
  // The producer's role comes from the sharing entry, so the export uses the
  // matching template (investor / bsp / generic).
  const loadSharedBuilding = async (entry: {
    buildingUri: string;
    sharedRole?: string;
  }): Promise<BuildingType | null> => {
    const res = await session.fetch(entry.buildingUri, {
      headers: { Accept: "text/turtle" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const parsed = parseBuildings(new Parser().parse(await res.text()));
    const found = [...parsed.values()].find((b) => b.uri === entry.buildingUri) ??
      [...parsed.values()][0];
    if (!found) return null;
    // Provenance comes from the shared building file (PROV attribution); fall
    // back to the role it was shared as when the file carries none.
    return {
      ...found,
      provenance: found.provenance ??
        (entry.sharedRole as BuildingType["provenance"]),
    };
  };

  const handleDownloadBuilding = async (entry: {
    buildingUri: string;
    buildingId: string;
    sharedRole?: string;
  }) => {
    try {
      const building = await loadSharedBuilding(entry);
      if (!building) throw new Error("no building data found in the source file");
      const [enriched] = await attachAnnualData([building], session);
      downloadXlsx(buildingToXlsx(enriched), `building-${entry.buildingId}.xlsx`);
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
          const b = await loadSharedBuilding(entry);
          if (b) built.push(b);
        } catch {
          // skip a building that can't be read right now
        }
      }
      if (built.length === 0) {
        throw new Error("none of the shared buildings could be read");
      }
      const enriched = await attachAnnualData(built, session);
      downloadXlsx(buildingsToXlsx(enriched), "buildings-shared.xlsx");
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
      {loading
        ? <p>Loading…</p>
        : sharedWithMe.length === 0
        ? (
          <p>
            No buildings have been shared with you yet. Ask a building owner to
            share their data with your WebID.
          </p>
        )
        : (
          <ul style={listStyle}>
            {sharedPaging.pageItems.map((building) => (
              <li key={building.buildingUri} style={rowStyle}>
                <span style={{ minWidth: 0 }}>
                  Building {building.buildingId}
                  <br />
                  <span style={{ wordBreak: "break-all" }}>
                    <UriLink href={building.buildingUri}>
                      {building.buildingUri}
                    </UriLink>
                  </span>
                  <br />
                  <small>
                    Shared by: {building.sharedBy}
                    {building.sharedRole &&
                      ` — Role: ${
                        ROLE_LABELS[building.sharedRole] ?? building.sharedRole
                      }`}
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
    </section>
  );
}
