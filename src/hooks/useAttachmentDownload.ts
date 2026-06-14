import { useState } from "react";
import type { Session } from "@inrupt/solid-client-authn-browser";
import type { AttachmentRef } from "../types.ts";
import { fetchAttachmentBlob } from "../services/attachmentManager.ts";
import { downloadBlob } from "../lib/download.ts";
import { useNotification } from "../context/NotificationContext.tsx";
import { formatError } from "../lib/formatError.ts";

/**
 * Download a building attachment with the authenticated session (works for the owner
 * AND a share recipient) and save it as a blob — the shared "Download" behaviour
 * behind the read-only FilesSection and the manage FilesDialog. A download is a READ,
 * so it owns its busy flag: `downloadingUrl` is the in-flight attachment's URL, or
 * null when idle.
 */
export function useAttachmentDownload(
  session: Session,
): { download: (a: AttachmentRef) => Promise<void>; downloadingUrl: string | null } {
  const { showNotification } = useNotification();
  const [downloadingUrl, setDownloadingUrl] = useState<string | null>(null);

  const download = async (a: AttachmentRef) => {
    setDownloadingUrl(a.url);
    try {
      downloadBlob(await fetchAttachmentBlob(a.url, session), a.filename);
    } catch (error) {
      showNotification(formatError("download the file", error), "error");
    } finally {
      setDownloadingUrl(null);
    }
  };

  return { download, downloadingUrl };
}
