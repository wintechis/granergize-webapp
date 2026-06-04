import { Session } from "@inrupt/solid-client-authn-browser";
import { DataFactory, Parser, Store } from "n3";
import { fetchFresh } from "../utils/podFetch.ts";
import { loadProfileStore } from "../utils/profileDocument.ts";
import {
  appendSharingEvent,
  parseSharingEvents,
  sharedInUrl,
} from "./sharingLog.ts";

/**
 * Drain the logged-in user's LDP inbox. Each message is a sharing event (a grant
 * or revocation in the shared `interop:`/`prov:` shape — see {@link sharingLog}).
 * We copy each into the user's append-only `shared-in/` log and delete the
 * message. "Shared with me, now" is the fold of that log; enforcement stays in
 * the sharer's `.acl` (a building whose grant was revoked 403s on load and is
 * pruned, so a missed revocation self-heals).
 */
export async function readInbox(session: Session) {
  if (!session.info.isLoggedIn || !session.info.webId) {
    throw new Error("User is not logged in");
  }
  const myWebId = session.info.webId;
  const sharedIn = sharedInUrl(myWebId);

  const podInbox = await getInboxUrl(session);
  const response = await fetchFresh(podInbox, session);
  if (response.status !== 200) return;

  const store = new Store(
    new Parser({ baseIRI: podInbox }).parse(await response.text()),
  );
  const messageUrls = store.getQuads(
    null,
    DataFactory.namedNode("http://www.w3.org/ns/ldp#contains"),
    null,
    null,
  ).map((q) => q.object.value);

  // Process each message fully (fetch → record in shared-in/ → delete) so a
  // re-read doesn't reprocess it. Distinct event resources, so appends are safe
  // to do concurrently.
  await Promise.all(messageUrls.map(async (messageUrl) => {
    const msgResponse = await session.fetch(messageUrl, { method: "GET" });
    if (msgResponse.status !== 200) {
      console.error(
        `Failed to fetch message at ${messageUrl}: ${msgResponse.statusText}`,
      );
      return;
    }
    const msgStore = new Store(
      new Parser({ baseIRI: messageUrl }).parse(await msgResponse.text()),
    );
    for (const event of parseSharingEvents(msgStore)) {
      await appendSharingEvent(sharedIn, session, event);
    }
    await removeMessageFromInbox(session, messageUrl, podInbox);
  }));
}

async function removeMessageFromInbox(
  session: Session,
  messageUrl: string,
  inboxUrl: string,
) {
  console.log(`Removing message ${messageUrl} from inbox ${inboxUrl}`);
  const response = await session.fetch(messageUrl, {
    method: "DELETE",
  });

  if (response.status === 404) {
    // Already deleted (e.g. duplicate processing) — treat as success
    return;
  }

  if (!response.ok) {
    console.error(
      `Failed to delete message at ${messageUrl}: ${response.statusText}`,
    );
    throw new Error(
      `Failed to delete message at ${messageUrl}: ${response.statusText}`,
    );
  }

  console.log(`Successfully deleted message at ${messageUrl}`);
}

/**
 * Resolve a *recipient's* LDP inbox from their WebID profile (for posting a
 * sharing notification to someone else). Unlike {@link getInboxUrl} for the
 * logged-in user, this fetches an arbitrary WebID document, so it can't use the
 * session-cached profile store. Shared by the share / revoke flows.
 */
export async function getRecipientInboxUrl(
  webId: string,
  session: Session,
): Promise<string> {
  const res = await session.fetch(webId, { method: "GET" });
  if (!res.ok) {
    throw new Error(
      `Failed to fetch WebID profile at ${webId}: ${res.statusText}`,
    );
  }
  const store = new Store(
    new Parser({ format: "text/turtle", baseIRI: webId }).parse(
      await res.text(),
    ),
  );
  const inboxQuads = store.getQuads(
    DataFactory.namedNode(webId),
    DataFactory.namedNode("http://www.w3.org/ns/ldp#inbox"),
    null,
    null,
  );
  if (inboxQuads.length === 0) {
    throw new Error(`No inbox found for WebID ${webId}`);
  }
  return inboxQuads[0].object.value;
}

async function getInboxUrl(session: Session): Promise<string> {
  const webId = session.info.webId;
  if (!webId) throw new Error("Session has no WebID");

  // Reuse the session-cached profile (loadProfileStore) instead of a bespoke
  // global `fetch(webId)` — so the WebID document is read once per session and
  // shared with storage-root / org / avatar reads, not re-downloaded here.
  const store = await loadProfileStore(session);
  if (!store) {
    console.error("Failed to load WebID profile");
    throw new Error("Failed to load WebID profile");
  }

  const inboxPredicate = DataFactory.namedNode(
    "http://www.w3.org/ns/ldp#inbox",
  );
  const webIdSubject = DataFactory.namedNode(webId);
  const inboxQuads = store.getQuads(webIdSubject, inboxPredicate, null, null);

  if (inboxQuads.length === 0) {
    console.error("Inbox URL not found in WebID profile");
    throw new Error("Inbox URL not found in WebID profile");
  }

  const inboxUrl = inboxQuads[0].object.value;
  return inboxUrl;
}
