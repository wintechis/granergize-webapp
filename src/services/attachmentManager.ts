import type { PodGateway } from "./pod/podGateway.ts";
import { DataFactory } from "n3";
import type { AttachmentRef } from "../types.ts";
import { ensureContainer, readModifyWrite } from "./pod/podWrite.ts";
import { logError } from "../lib/logError.ts";
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
} from "./rdf/vocabularies.ts";

const { namedNode, literal } = DataFactory;

/**
 * Owner-side management of a building's file attachments. Each file is stored in
 * the building's per-building `files/` container and described in the building TTL
 * with `bldg:hasAttachment <fileIRI>` plus schema.org `MediaObject` metadata (the
 * file IRI is the metadata subject — no blank node). The energy certificate is
 * just one such file, additionally flagged `bldg:hasEnergyCertificate`.
 *
 * Binaries are PUT to a client-chosen URI and the TTL edit goes through
 * `readModifyWrite` (optimistic lock), matching the rest of the app's write model.
 */

/** The per-building `files/` container for a building file URI. */
export function filesContainerFor(buildingFileUri: string): string {
  const file = buildingFileUri.split("#")[0];
  return `${file.replace(/\.ttl$/, "/")}files/`;
}

/** A safe, collision-free file IRI in `container` for `filename` (suffixes on clash). */
async function uniqueFileUri(
  container: string,
  filename: string,
  gateway: PodGateway,
): Promise<{ uri: string; name: string }> {
  const dot = filename.lastIndexOf(".");
  const base = dot > 0 ? filename.slice(0, dot) : filename;
  const ext = dot > 0 ? filename.slice(dot) : "";
  for (let i = 0; i < 50; i++) {
    const name = i === 0 ? filename : `${base}-${i}${ext}`;
    const uri = container + encodeURIComponent(name);
    const res = await gateway.fetch(uri, { method: "HEAD" });
    await res.body?.cancel().catch((err) =>
      logError("cancel HEAD response body during name probe", err)
    );
    if (res.status === 404) return { uri, name };
  }
  const name = `${base}-${Date.now()}${ext}`;
  return { uri: container + encodeURIComponent(name), name };
}

/**
 * Upload one file as a building attachment: PUT the binary into the building's
 * `files/` container, then add its `bldg:hasAttachment` link + metadata to the
 * building TTL. Returns the new {@link AttachmentRef}.
 * @operation mutation
 */
export async function uploadAttachment(
  buildingFileUri: string,
  subjectUri: string,
  file: File,
  gateway: PodGateway,
): Promise<AttachmentRef> {
  if (!gateway.webId) throw new Error("User is not logged in");

  const container = filesContainerFor(buildingFileUri);
  // Provision the per-building container then the files/ sub-container.
  await ensureContainer(container.replace(/files\/$/, ""), gateway);
  await ensureContainer(container, gateway);

  const { uri, name } = await uniqueFileUri(container, file.name, gateway);
  const mediaType = file.type || "application/octet-stream";

  const put = await gateway.fetch(uri, {
    method: "PUT",
    headers: { "Content-Type": mediaType },
    body: file,
  });
  if (!put.ok) {
    throw new Error(`Failed to upload ${name} to ${uri}: HTTP ${put.status}`);
  }

  const uploadDate = new Date().toISOString();
  const subject = namedNode(subjectUri);
  const fileNode = namedNode(uri);
  await readModifyWrite(buildingFileUri.split("#")[0], gateway, (store, { created }) => {
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

  return { uri, filename: name, mediaType, size: file.size, uploadDate };
}

/**
 * Delete an attachment: remove the binary, then drop its `bldg:hasAttachment`
 * link + metadata from the building TTL (and clear `bldg:hasEnergyCertificate`
 * if it pointed at this file). A missing binary (404) is tolerated.
 * @operation mutation
 */
export async function deleteAttachment(
  buildingFileUri: string,
  subjectUri: string,
  attachmentUri: string,
  gateway: PodGateway,
): Promise<void> {
  if (!gateway.webId) throw new Error("User is not logged in");

  const del = await gateway.fetch(attachmentUri, { method: "DELETE" });
  if (!del.ok && del.status !== 404) {
    throw new Error(`Failed to delete ${attachmentUri}: HTTP ${del.status}`);
  }

  const subject = namedNode(subjectUri);
  const fileNode = namedNode(attachmentUri);
  await readModifyWrite(buildingFileUri.split("#")[0], gateway, (store, { created }) => {
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
 * Mark `attachmentUri` as the building's energy certificate (or clear it when
 * `attachmentUri` is null). Replaces any existing `bldg:hasEnergyCertificate`.
 * @operation mutation
 */
export async function setEnergyCertificate(
  buildingFileUri: string,
  subjectUri: string,
  attachmentUri: string | null,
  gateway: PodGateway,
): Promise<void> {
  if (!gateway.webId) throw new Error("User is not logged in");
  const subject = namedNode(subjectUri);
  const pred = namedNode(GRAN_HAS_ENERGY_CERTIFICATE);
  await readModifyWrite(buildingFileUri.split("#")[0], gateway, (store, { created }) => {
    if (created) throw new Error(`Building not found: ${buildingFileUri}`);
    store.removeQuads(store.getQuads(subject, pred, null, null));
    if (attachmentUri) store.addQuad(subject, pred, namedNode(attachmentUri));
  });
}

/**
 * Fetch an attachment's bytes with the authed gateway (works for shared files).
 * @operation query
 */
export async function fetchAttachmentBlob(
  uri: string,
  gateway: PodGateway,
): Promise<Blob> {
  const res = await gateway.fetch(uri);
  if (!res.ok) {
    throw new Error(`Failed to fetch ${uri}: HTTP ${res.status}`);
  }
  return await res.blob();
}
