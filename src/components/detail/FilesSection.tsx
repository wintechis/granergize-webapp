import { useState } from "react";
import { Button, Chip, Typography } from "@mui/material";
import type { AttachmentRef, BuildingType } from "../../../types/types.ts";
import { RdfSourceLink, SectionTitle } from "./DetailView.tsx";
import { listStyle, rowStyle } from "../listStyles.ts";
import {
  fetchAttachmentBlob,
  filesContainerFor,
} from "../../services/utils/attachmentManager.ts";
import { downloadBlob, formatBytes } from "../../services/utils/download.ts";
import { getSession } from "../../hooks/session.ts";
import { useNotification } from "../../context/NotificationContext.tsx";
import { formatError } from "../../services/utils/formatError.ts";

/**
 * Read-only list of a building's file attachments with a Download action. The
 * binary is fetched with the authenticated session (so it works for both the
 * owner and a share recipient) and saved via a blob download. Renders nothing
 * when the building has no files.
 */
export default function FilesSection({ building }: { building: BuildingType }) {
  const attachments = (building.attachments as AttachmentRef[] | undefined) ?? [];
  const { showNotification } = useNotification();
  const [busy, setBusy] = useState<string | null>(null);

  if (attachments.length === 0) return null;

  const download = async (a: AttachmentRef) => {
    setBusy(a.url);
    try {
      const blob = await fetchAttachmentBlob(a.url, getSession());
      downloadBlob(blob, a.filename);
    } catch (error) {
      showNotification(formatError("download the file", error), "error");
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <SectionTitle divider>Files</SectionTitle>
      <ul style={listStyle}>
        {attachments.map((a) => (
          <li key={a.url} style={rowStyle}>
            <span style={{ minWidth: 0 }}>
              {a.filename}
              {a.isEnergyCertificate && (
                <Chip
                  size="small"
                  label="Energy certificate"
                  sx={{ ml: 1 }}
                />
              )}
              <br />
              <Typography component="span" variant="caption" color="text.secondary">
                {a.mediaType}
                {a.size ? ` · ${formatBytes(a.size)}` : ""}
              </Typography>
            </span>
            <Button
              size="small"
              onClick={() => download(a)}
              disabled={busy === a.url}
            >
              {busy === a.url ? "Downloading…" : "Download"}
            </Button>
          </li>
        ))}
      </ul>
      <RdfSourceLink href={filesContainerFor(building.uri)} />
    </>
  );
}
