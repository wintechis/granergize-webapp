import { useState } from "react";
import { Box, Button, Stack, Typography } from "@mui/material";
import { Session } from "@inrupt/solid-client-authn-browser";
import type { AttachmentRef, BuildingType } from "../../types.ts";
import { useNotification } from "../../context/NotificationContext.tsx";
import { useConfirm } from "../../context/ConfirmContext.tsx";
import {
  useDeleteAttachment,
  useSetEnergyCertificate,
  useUploadAttachments,
} from "../../hooks/mutations.ts";
import { useAttachmentDownload } from "../../hooks/useAttachmentDownload.ts";
import { formatBytes } from "../../lib/download.ts";
import { listStyle, rowStyle } from "../../constants/listStyles.ts";
import AttachmentInfo from "../AttachmentInfo.tsx";
import { buildingFileUri } from "../../services/rdf/building/buildingId.ts";

// Soft caps — warned, not enforced (mirrors the manage FilesDialog).
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_FILES = 20;

/**
 * The building page's Files section: the building's attachments, inline on the page, with
 * upload, download, set/unset energy-certificate, and delete. Reuses the same
 * attachment mutation hooks + {@link AttachmentInfo} the manage FilesDialog uses,
 * so there's one file-handling behaviour — just no modal. A shared building is
 * read-only (download only); the recipient can't write the owner's container.
 */
export default function BuildingFilesSection(
  { building, session }: { building: BuildingType; session: Session },
) {
  const { showNotification } = useNotification();
  const { confirm } = useConfirm();
  const canWrite = !building.isShared;

  const fileUri = (building.sourceUri as string) ?? buildingFileUri(building.uri);
  const subjectUri = building.uri;
  // Keep a local copy so the list stays live across uploads/deletes; the
  // mutation hooks invalidate the buildings query so the rest of the app refetches.
  const [items, setItems] = useState<AttachmentRef[]>(
    () => ((building.attachments as AttachmentRef[] | undefined) ?? []).slice(),
  );

  const upload = useUploadAttachments();
  const del = useDeleteAttachment();
  const cert = useSetEnergyCertificate();
  const { download, downloadingUrl } = useAttachmentDownload(session);
  const busy = upload.isPending || del.isPending || cert.isPending ||
    downloadingUrl !== null;

  const handleFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;
    if (items.length + files.length > MAX_FILES) {
      showNotification(
        `This building will have more than ${MAX_FILES} files — consider keeping it tidy.`,
        "warning",
      );
    }
    for (const file of files) {
      if (file.size > MAX_FILE_BYTES) {
        showNotification(
          `"${file.name}" is large (${
            formatBytes(file.size)
          }); the upload may be slow or rejected by the Pod.`,
          "warning",
        );
      }
    }
    upload.mutate({
      fileUri,
      subjectUri,
      files,
      onUploaded: (ref) => setItems((prev) => [...prev, ref]),
    });
  };

  const handleDelete = async (a: AttachmentRef) => {
    if (
      !await confirm({
        title: "Delete file",
        message: `Delete "${a.filename}"? This cannot be undone.`,
        confirmLabel: "Delete",
      })
    ) {
      return;
    }
    del.mutate({ fileUri, subjectUri, url: a.url }, {
      onSuccess: () => setItems((prev) => prev.filter((x) => x.url !== a.url)),
    });
  };

  const handleToggleCert = (a: AttachmentRef) => {
    const makeIt = !a.isEnergyCertificate;
    cert.mutate({ fileUri, subjectUri, url: makeIt ? a.url : null }, {
      onSuccess: () =>
        setItems((prev) =>
          prev.map((x) => ({
            ...x,
            isEnergyCertificate: makeIt && x.url === a.url,
          }))
        ),
    });
  };

  return (
    <Box>
      <Typography variant="h6" sx={{ mb: 1 }}>Files</Typography>
      {items.length === 0
        ? (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            No files yet.{canWrite
              ? " Attach a PDF, image, or document below — it's stored on your Pod and shared automatically with anyone you share the building with."
              : ""}
          </Typography>
        )
        : (
          <ul style={listStyle}>
            {items.map((a) => (
              <li key={a.url} style={rowStyle}>
                <AttachmentInfo a={a} />
                <span style={{ display: "flex", gap: "0.25rem" }}>
                  <Button
                    size="small"
                    onClick={() => download(a)}
                    disabled={downloadingUrl === a.url}
                  >
                    {downloadingUrl === a.url ? "Downloading…" : "Download"}
                  </Button>
                  {canWrite && (
                    <>
                      <Button
                        size="small"
                        onClick={() => handleToggleCert(a)}
                        disabled={busy}
                      >
                        {a.isEnergyCertificate ? "Unset cert" : "Set as cert"}
                      </Button>
                      <Button
                        size="small"
                        color="error"
                        aria-label={`Delete ${a.filename}`}
                        onClick={() => handleDelete(a)}
                        disabled={busy}
                      >
                        Delete
                      </Button>
                    </>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      {canWrite && (
        <Stack direction="row" spacing={1} sx={{ mt: 1, alignItems: "center" }}>
          <input
            type="file"
            multiple
            onChange={handleFiles}
            id="building-files-input"
            style={{ display: "none" }}
            disabled={busy}
          />
          <label htmlFor="building-files-input">
            <Button variant="contained" component="span" disabled={busy}>
              {busy ? "Working…" : "Add files"}
            </Button>
          </label>
        </Stack>
      )}
    </Box>
  );
}
