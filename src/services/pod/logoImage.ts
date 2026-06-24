// Shared logo-image plumbing for the two org logo surfaces — the user's OWN
// organisation (`foaf:logo` at `profile/logo.<ext>`, organizationManager) and a
// referenced organisation CONTACT (`vcard:logo` under the app tree, agentLogo).
// Both upload a small image and publish a public-read `.acl` so plain cross-agent
// `<img>` loads (map markers, the agent page) resolve it; the only difference is
// the target URI. Centralised here so the MIME table and ACL shape can't drift.
import type { PodGateway } from "./podGateway.ts";
import { putAcl } from "./podWrite.ts";
import { logError } from "../../lib/logError.ts";

/** image/* MIME → file extension for the stored logo. */
export const EXT_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/svg+xml": "svg",
  "image/webp": "webp",
  "image/gif": "gif",
};

/** The `accept` attribute for a logo file input (the supported image types). */
export const LOGO_ACCEPT = Object.keys(EXT_BY_MIME).join(",");

/** True when the file's MIME is a supported logo image. */
export function isSupportedLogoType(file: File): boolean {
  return file.type in EXT_BY_MIME;
}

/** The public-read `.acl` Turtle for a logo: world-readable + owner full control. */
function publicReadLogoAcl(resourceUri: string, ownerWebId: string): string {
  return `@prefix acl: <http://www.w3.org/ns/auth/acl#>.
@prefix foaf: <http://xmlns.com/foaf/0.1/>.
<#public> a acl:Authorization; acl:accessTo <${resourceUri}>;
  acl:agentClass foaf:Agent; acl:mode acl:Read.
<#owner> a acl:Authorization; acl:accessTo <${resourceUri}>;
  acl:agent <${ownerWebId}>; acl:mode acl:Read, acl:Write, acl:Control.
`;
}

/**
 * PUT an image to `targetUri` and publish its public-read `.acl`. Returns the URI.
 * The ACL write is best-effort: a non-WAC Pod rejects it without failing the upload
 * (there the provider's container defaults decide visibility). Throws if the image
 * PUT itself fails, or the MIME is unsupported.
 * @operation mutation
 */
export async function uploadPublicLogo(
  file: File,
  targetUri: string,
  ownerWebId: string,
  gateway: PodGateway,
): Promise<string> {
  const ext = EXT_BY_MIME[file.type];
  if (!ext) {
    throw new Error(`Unsupported image type: ${file.type || "unknown"}`);
  }
  const put = await gateway.fetch(targetUri, {
    method: "PUT",
    headers: { "Content-Type": file.type },
    body: file,
  });
  if (!put.ok) {
    throw new Error(`Failed to upload logo to ${targetUri}: ${put.statusText}`);
  }
  await putAcl(`${targetUri}.acl`, publicReadLogoAcl(targetUri, ownerWebId), gateway)
    .catch((err) => logError("publish logo ACL", err));
  return targetUri;
}
