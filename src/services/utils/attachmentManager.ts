import { Session } from "@inrupt/solid-client-authn-browser";
import { DataFactory } from "n3";
import type { AttachmentRef } from "../../../types/types.ts";
import { ensureContainer, readModifyWrite } from "./podWrite.ts";
import { logError } from "./logError.ts";
import {
  DCTERMS_CREATED,
  GRAN_HAS_ATTACHMENT,
  GRAN_HAS_ENERGY_CERTIFICATE,
  RDF_TYPE,
  SCHEMA_CONTENT_SIZE,
  SCHEMA_ENCODING_FORMAT,
  SCHEMA_MEDIA_OBJECT,
  SCHEMA_NAME,
  XSD_DATETIME,
  XSD_INTEGER,
} from "./vocabularies.ts";

const { namedNode, literal } = DataFactory;

/**
 * Owner-side management of a building's file attachments. Each file is stored in
 * the building's per-building `files/` container and described in the building TTL
 * with `gran:hasAttachment <fileIRI>` plus schema.org `MediaObject` metadata (the
 * file IRI is the metadata subject — no blank node). The energy certificate is
 * just one such file, additionally flagged `gran:hasEnergyCertificate`.
 *
 * Binaries are PUT to a client-chosen URI and the TTL edit goes through
 * `readModifyWrite` (optimistic lock), matching the rest of the app's write model.
 */

/** The per-building `files/` container for a building file URI. */
export function filesContainerFor(buildingFileUri: string): string {
  const file = buildingFileUri.split("#")[0];
  return `${file.replace(/\.ttl$/, "/")}files/`;
}

/** A safe, collision-free file URL in `container` for `filename` (suffixes on clash). */
async function uniqueFileUrl(
  container: string,
  filename: string,
  session: Session,
): Promise<{ url: string; name: string }> {
  const dot = filename.lastIndexOf(".");
  const base = dot > 0 ? filename.slice(0, dot) : filename;
  const ext = dot > 0 ? filename.slice(dot) : "";
  for (let i = 0; i < 50; i++) {
    const name = i === 0 ? filename : `${base}-${i}${ext}`;
    const url = container + encodeURIComponent(name);
    const res = await session.fetch(url, { method: "HEAD" });
    await res.body?.cancel().catch((err) =>
      logError("cancel HEAD response body during name probe", err)
    );
    if (res.status === 404) return { url, name };
  }
  const name = `${base}-${Date.now()}${ext}`;
  return { url: container + encodeURIComponent(name), name };
}

/**
 * Upload one file as a building attachment: PUT the binary into the building's
 * `files/` container, then add its `gran:hasAttachment` link + metadata to the
 * building TTL. Returns the new {@link AttachmentRef}.
 */
export async function uploadAttachment(
  buildingFileUri: string,
  subjectUri: string,
  file: File,
  session: Session,
): Promise<AttachmentRef> {
  if (!session.info.isLoggedIn) throw new Error("User is not logged in");

  const container = filesContainerFor(buildingFileUri);
  // Provision the per-building container then the files/ sub-container.
  await ensureContainer(container.replace(/files\/$/, ""), session);
  await ensureContainer(container, session);

  const { url, name } = await uniqueFileUrl(container, file.name, session);
  const mediaType = file.type || "application/octet-stream";

  const put = await session.fetch(url, {
    method: "PUT",
    headers: { "Content-Type": mediaType },
    body: file,
  });
  if (!put.ok) {
    throw new Error(`Failed to upload ${name} to ${url}: HTTP ${put.status}`);
  }

  const uploadDate = new Date().toISOString();
  const subject = namedNode(subjectUri);
  const fileNode = namedNode(url);
  await readModifyWrite(buildingFileUri.split("#")[0], session, (store, { created }) => {
    if (created) throw new Error(`Building not found: ${buildingFileUri}`);
    store.addQuad(subject, namedNode(GRAN_HAS_ATTACHMENT), fileNode);
    store.addQuad(fileNode, namedNode(RDF_TYPE), namedNode(SCHEMA_MEDIA_OBJECT));
    store.addQuad(fileNode, namedNode(SCHEMA_NAME), literal(name));
    store.addQuad(fileNode, namedNode(SCHEMA_ENCODING_FORMAT), literal(mediaType));
    store.addQuad(
      fileNode,
      namedNode(SCHEMA_CONTENT_SIZE),
      literal(String(file.size), namedNode(XSD_INTEGER)),
    );
    store.addQuad(
      fileNode,
      namedNode(DCTERMS_CREATED),
      literal(uploadDate, namedNode(XSD_DATETIME)),
    );
  });

  return { url, filename: name, mediaType, size: file.size, uploadDate };
}

/**
 * Delete an attachment: remove the binary, then drop its `gran:hasAttachment`
 * link + metadata from the building TTL (and clear `gran:hasEnergyCertificate`
 * if it pointed at this file). A missing binary (404) is tolerated.
 */
export async function deleteAttachment(
  buildingFileUri: string,
  subjectUri: string,
  attachmentUrl: string,
  session: Session,
): Promise<void> {
  if (!session.info.isLoggedIn) throw new Error("User is not logged in");

  const del = await session.fetch(attachmentUrl, { method: "DELETE" });
  if (!del.ok && del.status !== 404) {
    throw new Error(`Failed to delete ${attachmentUrl}: HTTP ${del.status}`);
  }

  const subject = namedNode(subjectUri);
  const fileNode = namedNode(attachmentUrl);
  await readModifyWrite(buildingFileUri.split("#")[0], session, (store, { created }) => {
    if (created) return false; // nothing to clean
    store.removeQuads(
      store.getQuads(subject, namedNode(GRAN_HAS_ATTACHMENT), fileNode, null),
    );
    store.removeQuads(store.getQuads(fileNode, null, null, null));
    store.removeQuads(
      store.getQuads(subject, namedNode(GRAN_HAS_ENERGY_CERTIFICATE), fileNode, null),
    );
  });
}

/**
 * Mark `attachmentUrl` as the building's energy certificate (or clear it when
 * `attachmentUrl` is null). Replaces any existing `gran:hasEnergyCertificate`.
 */
export async function setEnergyCertificate(
  buildingFileUri: string,
  subjectUri: string,
  attachmentUrl: string | null,
  session: Session,
): Promise<void> {
  if (!session.info.isLoggedIn) throw new Error("User is not logged in");
  const subject = namedNode(subjectUri);
  const pred = namedNode(GRAN_HAS_ENERGY_CERTIFICATE);
  await readModifyWrite(buildingFileUri.split("#")[0], session, (store, { created }) => {
    if (created) throw new Error(`Building not found: ${buildingFileUri}`);
    store.removeQuads(store.getQuads(subject, pred, null, null));
    if (attachmentUrl) store.addQuad(subject, pred, namedNode(attachmentUrl));
  });
}

/** Fetch an attachment's bytes with the authed session (works for shared files). */
export async function fetchAttachmentBlob(
  url: string,
  session: Session,
): Promise<Blob> {
  const res = await session.fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${res.status}`);
  }
  return await res.blob();
}
