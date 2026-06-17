// Intent core (React-free) for UploadAttachments (the hook is
// `useUploadAttachments`). See ./README.md for the core/adapter split and the
// write→outcome convention.
import type { PodGateway } from "../services/pod/podGateway.ts";
import { uploadAttachment } from "../services/attachmentManager.ts";
import type { AttachmentRef } from "../types.ts";
import type { Tally } from "./outcomes.ts";

/** Parameters of the UploadAttachments intent. */
export interface UploadAttachmentsParams {
  /** The building file's IRI (the resource the attachments link from). */
  fileUri: string;
  /** The building subject's IRI (`#b` in the file). */
  subjectUri: string;
  /** The files to upload, committed sequentially. */
  files: File[];
  /** Per-landed-file callback (runtime-only — not a modelled RDF param). */
  onUploaded?: (ref: AttachmentRef) => void;
}

/**
 * React-free core of {@link import("../hooks/mutations.ts").useUploadAttachments}:
 * upload files to a building's `files/` container, sequentially; `onUploaded`
 * reports each landed file so the dialog's list can grow as the batch runs.
 * Stops at the first failure (the files before it are kept and counted in the
 * tally). The adapter owns the buildings invalidation.
 */
export async function uploadAttachmentsCore(
  gateway: PodGateway,
  params: UploadAttachmentsParams,
): Promise<Tally> {
  const total = params.files.length;
  let done = 0;
  for (const file of params.files) {
    const ref = await uploadAttachment(params.fileUri, params.subjectUri, file, gateway);
    params.onUploaded?.(ref);
    done++;
  }
  return { done, total };
}
