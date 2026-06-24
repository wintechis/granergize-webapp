import type { PodGateway } from "../pod/podGateway.ts";
import { podResources } from "../pod/solidUtils.ts";
import { EXT_BY_MIME, uploadPublicLogo } from "../pod/logoImage.ts";

/**
 * A filename-safe, deterministic stem for a contact's logo, derived from its WebID
 * (scheme stripped, non-alphanumerics collapsed to `-`). One contact ⇒ one stable
 * file, so re-uploading overwrites rather than orphaning — and the full host+path+
 * fragment keeps distinct WebIDs distinct.
 */
export function contactLogoStem(webId: string): string {
  return webId
    .replace(/^https?:\/\//, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/**
 * Upload an image as a referenced organisation contact's logo, stored under the
 * USER's own app tree (`<appRoot>contacts/logos/<stem>.<ext>`) with a public-read
 * `.acl` — the local-record counterpart of the own-org `foaf:logo`. Returns the
 * logo URI to record as the contact's `vcard:logo`. The contact's own profile is
 * never written; this is the user's annotation on their own Pod.
 * @operation mutation
 */
export function uploadContactLogo(
  file: File,
  contactWebId: string,
  gateway: PodGateway,
): Promise<string> {
  const ownerWebId = gateway.webId;
  if (!ownerWebId) throw new Error("User is not logged in");
  const ext = EXT_BY_MIME[file.type];
  if (!ext) throw new Error(`Unsupported image type: ${file.type || "unknown"}`);
  const target =
    `${podResources(ownerWebId).appRoot}contacts/logos/${contactLogoStem(contactWebId)}.${ext}`;
  return uploadPublicLogo(file, target, ownerWebId, gateway);
}
