import { msg } from "../../lib/messages.ts";
import { Button } from "@mui/material";
import type { AttachmentRef, BuildingType } from "../../types.ts";
import { RdfSourceLink, SectionTitle } from "./DetailView.tsx";
import { listStyle, rowStyle } from "../../constants/listStyles.ts";
import { filesContainerFor } from "../../services/attachmentManager.ts";
import { getGateway } from "../../hooks/session.ts";
import { useAttachmentDownload } from "../../hooks/useAttachmentDownload.ts";
import AttachmentInfo from "../AttachmentInfo.tsx";

/**
 * Read-only list of a building's file attachments with a Download action. The
 * binary is fetched with the authenticated session (so it works for both the
 * owner and a share recipient) and saved via a blob download. Renders nothing
 * when the building has no files.
 */
export default function FilesSection({ building }: { building: BuildingType }) {
  const attachments = (building.attachments as AttachmentRef[] | undefined) ?? [];
  const { download, downloadingUrl } = useAttachmentDownload(getGateway());

  if (attachments.length === 0) return null;

  return (
    <>
      <SectionTitle divider>{msg("secFiles")}</SectionTitle>
      <ul style={listStyle}>
        {attachments.map((a) => (
          <li key={a.uri} style={rowStyle}>
            <AttachmentInfo a={a} />
            <Button
              size="small"
              onClick={() => download(a)}
              disabled={downloadingUrl === a.uri}
            >
              {downloadingUrl === a.uri ? msg("fileDownloading") : msg("btnDownload")}
            </Button>
          </li>
        ))}
      </ul>
      <RdfSourceLink href={filesContainerFor(building.uri)} />
    </>
  );
}
