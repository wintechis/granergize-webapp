import { useEffect, useState } from "react";
import { Button, IconButton, Tooltip, Typography } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import DownloadIcon from "@mui/icons-material/Download";
import DeleteIcon from "@mui/icons-material/Delete";
import EditIcon from "@mui/icons-material/Edit";
import ShareIcon from "@mui/icons-material/Share";
import { Session } from "@inrupt/solid-client-authn-browser";
import type { BuildingType } from "../../types/types.ts";
import { useNotification } from "../context/NotificationContext.tsx";
import { useSolidData } from "../context/SolidDataContext.tsx";
import {
  getSharedBuildings,
  revokeAccess,
} from "../services/interop/sharingManager.ts";
import { confirmAndDeleteBuilding } from "../services/utils/buildingActions.ts";
import { tryPodResources } from "../services/utils/solidUtils.ts";
import { RdfSourceLink, UriLink } from "./detail/DetailView.tsx";
import { ShareBuildingDialog } from "./BuildingDialogs.tsx";
import EditBuildingDialog from "./EditBuildingDialog.tsx";
import AddBuildingDialog from "./AddBuildingDialog.tsx";

interface BuildingsPageProps {
  session: Session;
}

const listStyle: React.CSSProperties = {
  listStyle: "none",
  paddingLeft: 0,
  margin: 0,
};
const nestedListStyle: React.CSSProperties = {
  ...listStyle,
  paddingLeft: "1.25rem",
  marginTop: "0.25rem",
};
const rowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "0.5rem",
};
const ellipsis: React.CSSProperties = {
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

/**
 * The DATA tab: manage the buildings you own — view their RDF, see who they're
 * shared with (and revoke), and edit / share / delete each. This is the single
 * home for owned-building management (the map's detail pane is view-only; SHARE
 * shows only views + buildings shared with you).
 */
export default function BuildingsPage({ session }: BuildingsPageProps) {
  const { showNotification } = useNotification();
  const { buildings, reloadData } = useSolidData();
  const ownedBuildings = buildings.filter((b) => !b.isShared);
  const rdf = session.info.webId ? tryPodResources(session.info.webId) : null;

  const [addOpen, setAddOpen] = useState(false);
  const [importMode, setImportMode] = useState(false);
  const [editBuilding, setEditBuilding] = useState<BuildingType | null>(null);
  const [shareBuilding, setShareBuilding] = useState<BuildingType | null>(null);
  // buildingUri → WebIDs it is shared with.
  const [recipients, setRecipients] = useState<Record<string, string[]>>({});
  const [revokingKey, setRevokingKey] = useState<string | null>(null);

  const loadRecipients = async () => {
    try {
      const shared = await getSharedBuildings(session);
      const map: Record<string, string[]> = {};
      for (const s of shared) map[s.buildingUri] = s.sharedWith;
      setRecipients(map);
    } catch (error) {
      console.error("Error loading sharing recipients:", error);
    }
  };

  useEffect(() => {
    loadRecipients();
  }, [session, buildings]);

  const handleDelete = async (building: BuildingType) => {
    try {
      if (await confirmAndDeleteBuilding(session, building)) {
        showNotification("Building deleted", "success");
        await reloadData();
      }
    } catch (err) {
      showNotification(
        `Failed to delete building: ${(err as Error).message}`,
        "error",
      );
    }
  };

  const handleRevoke = async (buildingUri: string, webId: string) => {
    if (!globalThis.confirm(`Revoke access for ${webId}?`)) return;
    const key = `${buildingUri}__${webId}`;
    setRevokingKey(key);
    try {
      await revokeAccess(buildingUri, webId, session);
      await loadRecipients();
      showNotification("Access revoked", "success");
    } catch (error) {
      showNotification(
        `Failed to revoke access: ${
          error instanceof Error ? error.message : String(error)
        }`,
        "error",
      );
    } finally {
      setRevokingKey(null);
    }
  };

  const handleDownload = async (fileUrl: string, id: string | number) => {
    try {
      const res = await session.fetch(fileUrl, {
        headers: { Accept: "text/turtle" },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const url = URL.createObjectURL(
        new Blob([await res.text()], { type: "text/turtle" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = `building-${id}.ttl`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      showNotification(
        `Failed to download building data: ${
          error instanceof Error ? error.message : String(error)
        }`,
        "error",
      );
    }
  };

  return (
    <section style={{ padding: "1.5rem" }}>
      <Typography variant="h6" sx={{ mb: 1 }}>Your buildings</Typography>
      {rdf && <RdfSourceLink href={rdf.buildings} />}

      {ownedBuildings.length === 0
        ? <p>You haven't added any buildings yet.</p>
        : (
          <ul style={listStyle}>
            {ownedBuildings.map((b) => {
              const fileUri = (b.sourceUri ?? b.uri).split("#")[0];
              const sharedWith = recipients[fileUri] ?? recipients[b.uri] ?? [];
              return (
                <li key={b.uri} style={{ marginBottom: "1rem" }}>
                  <div style={{ ...rowStyle, alignItems: "flex-start" }}>
                    <div style={{ minWidth: 0 }}>
                      <strong>Building {b.id}</strong>
                      {b.streetAddress ? ` — ${b.streetAddress}` : ""}
                      <br />
                      <span style={{ wordBreak: "break-all" }}>
                        <UriLink href={b.uri as string}>{b.uri}</UriLink>
                      </span>
                      {sharedWith.length > 0 && (
                        <>
                          <br />
                          <small>Shared with:</small>
                          <ul style={nestedListStyle}>
                            {sharedWith.map((webId) => (
                              <li key={webId} style={rowStyle}>
                                <span title={webId} style={ellipsis}>
                                  {webId}
                                </span>
                                <IconButton
                                  size="small"
                                  title="Revoke access"
                                  onClick={() => handleRevoke(fileUri, webId)}
                                  disabled={revokingKey === `${fileUri}__${webId}`}
                                >
                                  <DeleteIcon fontSize="small" />
                                </IconButton>
                              </li>
                            ))}
                          </ul>
                        </>
                      )}
                    </div>
                    <div style={{ display: "flex", gap: "0.25rem" }}>
                      <Tooltip title="Edit building">
                        <IconButton
                          size="small"
                          aria-label="Edit building"
                          onClick={() => setEditBuilding(b)}
                        >
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Share building data">
                        <IconButton
                          size="small"
                          aria-label="Share building data"
                          onClick={() => setShareBuilding(b)}
                        >
                          <ShareIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Download this building's data (Turtle)">
                        <IconButton
                          size="small"
                          aria-label="Download building data"
                          onClick={() => handleDownload(fileUri, b.id)}
                        >
                          <DownloadIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Delete building">
                        <IconButton
                          size="small"
                          color="error"
                          aria-label="Delete building"
                          onClick={() => handleDelete(b)}
                        >
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
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
      </div>

      {editBuilding && (
        <EditBuildingDialog
          key={editBuilding.uri as string}
          open
          building={editBuilding}
          session={session}
          onClose={() => setEditBuilding(null)}
          onBuildingUpdated={reloadData}
        />
      )}
      {shareBuilding && (
        <ShareBuildingDialog
          open
          buildingUri={(shareBuilding.sourceUri ?? shareBuilding.uri) as string}
          session={session}
          role={shareBuilding.sourceRole}
          onClose={() => {
            setShareBuilding(null);
            loadRecipients();
          }}
        />
      )}
      <AddBuildingDialog
        open={addOpen}
        session={session}
        autostartImport={importMode}
        onClose={() => setAddOpen(false)}
        onBuildingAdded={() => {
          setAddOpen(false);
          reloadData();
        }}
      />
    </section>
  );
}
