import { Chip, Typography } from "@mui/material";
import type { AttachmentRef } from "../types.ts";
import { formatBytes } from "../lib/download.ts";

/**
 * The shared attachment-row info block — filename, the energy-certificate chip, and
 * the mediaType/size caption — rendered by both the read-only FilesSection and the
 * manage FilesDialog (which differ only in the action buttons beside it).
 */
export default function AttachmentInfo({ a }: { a: AttachmentRef }) {
  return (
    <span style={{ minWidth: 0 }}>
      {a.filename}
      {a.isEnergyCertificate && (
        <Chip size="small" label="Energy certificate" sx={{ ml: 1 }} />
      )}
      <br />
      <Typography component="span" variant="caption" color="text.secondary">
        {a.mediaType}
        {a.size ? ` · ${formatBytes(a.size)}` : ""}
      </Typography>
    </span>
  );
}
