import { IconButton, Switch, Tooltip, Typography } from "@mui/material";
import DownloadIcon from "@mui/icons-material/Download";
import VisibilityIcon from "@mui/icons-material/Visibility";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOff";
import { Session } from "@inrupt/solid-client-authn-browser";
import { ROLE_LABELS } from "../constants/roles.ts";
import { useNotification } from "../context/NotificationContext.tsx";
import { useSharedWithMe } from "../hooks/queries.ts";
import { useToggleVisibility } from "../hooks/mutations.ts";
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

  // Export a building's actual data (its Turtle) — available for any building
  // the user can read. `fileUrl` is the building's source document; what it
  // contains depends on the building's role.
  const handleDownloadBuilding = async (
    fileUrl: string,
    id: string | number,
  ) => {
    try {
      const res = await session.fetch(fileUrl, {
        headers: { Accept: "text/turtle" },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      const url = URL.createObjectURL(
        new Blob([text], { type: "text/turtle" }),
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
                  <Tooltip title="Download this building's data (Turtle)">
                    <IconButton
                      size="small"
                      aria-label="Download this building's data"
                      onClick={() =>
                        handleDownloadBuilding(
                          building.buildingUri,
                          building.buildingId,
                        )}
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
    </section>
  );
}
