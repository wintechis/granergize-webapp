import { Session } from "@inrupt/solid-client-authn-browser";
import { DataFactory, Parser, Store } from "n3";
import { fetchFresh, readStoreOrEmpty } from "../pod/podFetch.ts";
import { appendToContainer, ensureContainer, putAcl } from "../pod/podWrite.ts";
import { LDP_CONTAINS, LDP_INBOX } from "../rdf/vocabularies.ts";
import {
  APP_DIR,
  podResources,
  resolveStorageRootForWebId,
} from "../pod/solidUtils.ts";
import {
  appendSharingEvent,
  buildSharingEventTurtle,
  parseSharingEvents,
  type SharingEvent,
  sharedInUri,
} from "./sharingLog.ts";
import { logError } from "../../lib/logError.ts";

/**
 * Is `url` a real inbox message — i.e. NOT an auxiliary sidecar (`.acl`/`.meta`)?
 *
 * Draining an inbox GETs + DELETEs every `ldp:contains` entry. A container
 * listing should expose only members, but some servers (JSS) also list a
 * resource's auxiliaries; a stray `.acl` would then be deleted as if it were a
 * message — wiping the inbox's OWN access-control resource and silently revoking
 * every future sender's append grant. CSS/NSS omit auxiliaries from
 * `ldp:contains`, so this never bit there. A leading-dot final path segment
 * (`.acl`, `.meta`, …) is never a sharing message, so exclude it.
 */
export function isMessageResource(url: string): boolean {
  const lastSegment = url.replace(/\/$/, "").split("/").pop() ?? "";
  return !lastSegment.startsWith(".");
}

/**
 * Drain the logged-in user's LDP inbox. Each message is a sharing event (a grant
 * or revocation in the shared `interop:`/`prov:` shape — see {@link sharingLog}).
 * We copy each into the user's append-only `shared-in/` log and delete the
 * message. "Shared with me, now" is the fold of that log; enforcement stays in
 * the sharer's `.acl` (a building whose grant was revoked 403s on load and is
 * pruned, so a missed revocation self-heals).
 * @operation mutation
 */
export async function drainInbox(session: Session) {
  if (!session.info.isLoggedIn || !session.info.webId) {
    throw new Error("User is not logged in");
  }
  const myWebId = session.info.webId;
  const sharedIn = sharedInUri(myWebId);

  const podInbox = await getInboxUri(session);
  const store = await readStoreOrEmpty(podInbox, session);
  const messageUris = store.getQuads(
    null,
    DataFactory.namedNode(LDP_CONTAINS),
    null,
    null,
  ).map((q) => q.object.value).filter(isMessageResource);

  // Create shared-in/ once, up front. Each appendSharingEvent below ensures its
  // container, so without this the concurrent messages would all race to create
  // shared-in/ on its first use (every one GETs 404, every one PUTs) — a duplicate
  // create that a strict server rejects (e.g. JSS 409 "Cannot PUT to existing
  // container") and a lenient one (CSS) silently absorbs. With the container in
  // place the appends are plain POSTs into it, which ARE safe to run concurrently.
  // Announced: the inbox drain provisions shared-in/ as a side effect the user
  // wouldn't otherwise see.
  await ensureContainer(sharedIn, session, { announce: true });

  // Process each message fully (fetch → record in shared-in/ → delete) so a
  // re-read doesn't reprocess it. Distinct event resources, so the appends below
  // are safe to do concurrently.
  await Promise.all(messageUris.map(async (messageUri) => {
    const msgResponse = await fetchFresh(messageUri, session);
    if (msgResponse.status !== 200) {
      console.error(
        `Failed to fetch message at ${messageUri}: ${msgResponse.statusText}`,
      );
      return;
    }
    const msgStore = new Store(
      new Parser({ baseIRI: messageUri }).parse(await msgResponse.text()),
    );
    for (const event of parseSharingEvents(msgStore)) {
      await appendSharingEvent(sharedIn, session, event);
    }
    await removeMessageFromInbox(session, messageUri, podInbox);
  }));
}

async function removeMessageFromInbox(
  session: Session,
  messageUri: string,
  inboxUri: string,
) {
  console.log(`Removing message ${messageUri} from inbox ${inboxUri}`);
  const response = await session.fetch(messageUri, {
    method: "DELETE",
  });

  if (response.status === 404) {
    // Already deleted (e.g. duplicate processing) — treat as success
    return;
  }

  if (!response.ok) {
    console.error(
      `Failed to delete message at ${messageUri}: ${response.statusText}`,
    );
    throw new Error(
      `Failed to delete message at ${messageUri}: ${response.statusText}`,
    );
  }

  console.log(`Successfully deleted message at ${messageUri}`);
}

/**
 * Resolve a *recipient's* LDP inbox from their WebID profile (for posting a
 * sharing notification to someone else). Unlike {@link getInboxUri} for the
 * logged-in user, this fetches an arbitrary WebID document, so it can't use the
 * session-cached profile store. Shared by the share / revoke flows.
 */

/**
 * Find an inbox in an HTTP `Link` header (LDN): `Link: <uri>; rel="…#inbox"`.
 * Some Pods advertise the inbox only via the header, not the profile body. A
 * relative URI resolves against `base`.
 */
export function inboxFromLinkHeader(
  header: string | null,
  base: string,
): string | null {
  if (!header) return null;
  for (const m of header.matchAll(/<([^>]+)>\s*;\s*([^,]*)/g)) {
    const [, uri, params] = m;
    const rel = /rel\s*=\s*"?([^";]+)"?/i.exec(params)?.[1] ?? "";
    if (rel.split(/\s+/).some((r) => r === LDP_INBOX || r === "inbox")) {
      return new URL(uri, base).toString();
    }
  }
  return null;
}

/**
 * The granergize inbox for an app-root container (`<storageRoot>/granergize/`).
 * The location is DISCOVERABLE — read `ldp:inbox` from the granergize root (body or
 * Link header) so the inbox can live anywhere — with the `inbox/` convention as the
 * fallback (and what we provision). This is APP-scoped (granergize→granergize
 * sharing), NOT the agent-global WebID inbox, so it doesn't mix with other apps.
 * @operation query
 */
async function granergizeInboxUri(
  appRoot: string,
  session: Session,
): Promise<string> {
  const res = await session.fetch(appRoot, { headers: { Accept: "text/turtle" } })
    .catch((err) => {
      logError("fetch app root for inbox discovery", err);
      return null;
    });
  if (res?.ok) {
    const linkHeader = res.headers.get("Link");
    const store = new Store(new Parser({ baseIRI: appRoot }).parse(await res.text()));
    const triple = store.getObjects(
      DataFactory.namedNode(appRoot),
      DataFactory.namedNode(LDP_INBOX),
      null,
    )[0]?.value;
    if (triple) return triple;
    const fromHeader = inboxFromLinkHeader(linkHeader, appRoot);
    if (fromHeader) return fromHeader;
  } else {
    await res?.body?.cancel();
  }
  return `${appRoot}inbox/`; // convention default
}

/**
 * A share recipient's granergize inbox: resolve their storage root (the robust
 * discovery in solidUtils), then discover the inbox under their granergize space.
 * @operation query
 */
export async function getRecipientInboxUri(
  webId: string,
  session: Session,
): Promise<string> {
  const root = await resolveStorageRootForWebId(webId, session);
  return granergizeInboxUri(`${root}${APP_DIR}/`, session);
}

/**
 * POST a sharing event (a grant or a revocation) to a recipient's granergize
 * inbox — the notification they fold into their `shared-in/` log on the next
 * {@link drainInbox}. Shared by the building/view grant flows and the revocation
 * notice: the transport (LDP POST of the event Turtle) and the failure mode are
 * identical across all three; only the event payload differs.
 * @operation mutation
 */
export async function postSharingEventToInbox(
  webId: string,
  session: Session,
  event: SharingEvent,
): Promise<void> {
  const inboxUri = await getRecipientInboxUri(webId, session);
  await appendToContainer(inboxUri, buildSharingEventTurtle(event), session, {
    describeError: (res) =>
      `Failed to post sharing message to inbox at ${inboxUri}: ${res.statusText}`,
  });
}

/**
 * Provision the logged-in user's granergize inbox on a bare Pod (idempotent,
 * best-effort — never blocks login): create the inbox container and grant
 * AuthenticatedAgent Append so other granergize users can drop grants.
 *
 * We deliberately do NOT advertise the inbox via an `ldp:inbox` pointer on the
 * granergize root: a blind PUT to the container's `.meta` description resource
 * 409s on CSS (its metadata can't be wholesale-replaced that way), and the
 * pointer would be redundant anyway — {@link granergizeInboxUri} falls back to
 * the `inbox/` convention path, which is exactly where we provision. The app
 * never relocates the inbox, so the convention path always resolves it.
 *
 * Returns `true` only when it actually created the inbox this call (it didn't
 * exist yet) — so the caller can show the user a one-time setup notice. When the
 * inbox already exists it's a no-op and returns `false`.
 * @operation mutation
 */
export async function ensureOwnInbox(session: Session): Promise<boolean> {
  const webId = session.info.webId;
  if (!webId) return false;
  const { inbox } = podResources(webId);
  // Provision (and notify) only on a bare Pod: a HEAD that doesn't 404 means the
  // inbox is already set up, so there's nothing to create.
  const existing = await session.fetch(inbox, { method: "HEAD" }).catch((err) => {
    logError("HEAD own inbox to check provisioning", err);
    return null;
  });
  if (existing?.ok) return false;
  await session.fetch(inbox, {
    method: "PUT",
    headers: {
      "Content-Type": "text/turtle",
      Link: '<http://www.w3.org/ns/ldp#BasicContainer>; rel="type"',
    },
    body: "",
  }).catch((err) => logError("provision own inbox container", err));
  const acl = `@prefix acl: <http://www.w3.org/ns/auth/acl#>.
<#owner> a acl:Authorization; acl:agent <${webId}>;
  acl:accessTo <${inbox}>; acl:default <${inbox}>;
  acl:mode acl:Read, acl:Write, acl:Control.
<#append> a acl:Authorization; acl:agentClass acl:AuthenticatedAgent;
  acl:accessTo <${inbox}>; acl:mode acl:Read, acl:Append.
`;
  await putAcl(`${inbox}.acl`, acl, session)
    .catch((err) => logError("provision own inbox ACL", err));
  return true;
}

/**
 * The logged-in user's own granergize inbox (same app-scoped discovery).
 * @operation query
 */
async function getInboxUri(session: Session): Promise<string> {
  const webId = session.info.webId;
  if (!webId) throw new Error("Session has no WebID");
  return granergizeInboxUri(podResources(webId).appRoot, session);
}
