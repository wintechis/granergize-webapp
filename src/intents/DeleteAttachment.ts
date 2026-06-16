// Intent core (React-free) for DeleteAttachment. See ./README.md for the
// core/adapter split and the write→outcome convention.
import type { Session } from "@inrupt/solid-client-authn-browser";
import { deleteAttachment } from "../services/attachmentManager.ts";
import type { Settled } from "./outcomes.ts";

/** Parameters of the DeleteAttachment intent. */
export interface DeleteAttachmentParams {
  /** The building file's IRI (the resource the attachment links from). */
  fileUri: string;
  /** The building subject's IRI (`#b` in the file). */
  subjectUri: string;
  /** The IRI of the attachment resource to delete. */
  url: string;
}

/**
 * React-free core of {@link import("../hooks/mutations.ts").useDeleteAttachment}:
 * delete one attachment file + its `gran:hasAttachment` link. The adapter owns
 * the buildings invalidation.
 */
export async function deleteAttachmentCore(
  session: Session,
  params: DeleteAttachmentParams,
): Promise<Settled> {
  await deleteAttachment(params.fileUri, params.subjectUri, params.url, session);
  return { ok: true };
}
