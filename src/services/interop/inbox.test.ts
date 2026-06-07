/// <reference lib="deno.ns" />
import assert from "node:assert";
import type { Session } from "@inrupt/solid-client-authn-browser";
import {
  ensureOwnInbox,
  getRecipientInboxUrl,
  inboxFromLinkHeader,
  isMessageResource,
} from "./inbox.ts";
import { _setStorageRootForTesting } from "../utils/solidUtils.ts";

const WEBID = "https://b.example/profile/card#me";

/**
 * Fake session that answers HEAD by whether the inbox "exists" and records every
 * write, so we can assert ensureOwnInbox provisions exactly once on a bare Pod.
 */
function recordingSession(
  inboxExists: boolean,
): { session: Session; writes: { url: string; method: string }[] } {
  const writes: { url: string; method: string }[] = [];
  const session = {
    info: { isLoggedIn: true, webId: WEBID },
    fetch: (input: string | URL | Request, init?: RequestInit) => {
      const url = (typeof input === "string" ? input : input.toString())
        .split("?")[0];
      const method = init?.method ?? "GET";
      if (method === "HEAD") {
        return Promise.resolve(new Response(null, { status: inboxExists ? 200 : 404 }));
      }
      writes.push({ url, method });
      return Promise.resolve(new Response("", { status: 201 }));
    },
  } as unknown as Session;
  return { session, writes };
}

/** Fake session serving canned Turtle bodies by URL (query stripped). */
function session(map: Record<string, string>): Session {
  return {
    info: { isLoggedIn: true, webId: WEBID },
    fetch: (input: string | URL | Request) => {
      const url = (typeof input === "string" ? input : input.toString())
        .split("?")[0];
      const body = map[url];
      if (body === undefined) {
        return Promise.resolve(new Response("Not found", { status: 404 }));
      }
      return Promise.resolve(
        new Response(body, {
          status: 200,
          headers: { "Content-Type": "text/turtle" },
        }),
      );
    },
  } as unknown as Session;
}

Deno.test("getRecipientInboxUrl: convention path when granergize root has no ldp:inbox", async () => {
  const s = session({
    "https://b.example/profile/card":
      `<${WEBID}> <http://www.w3.org/ns/pim/space#storage> <https://b.example/> .`,
    "https://b.example/granergize/":
      `<https://b.example/granergize/> a <http://www.w3.org/ns/ldp#Container> .`,
  });
  assert.equal(
    await getRecipientInboxUrl(WEBID, s),
    "https://b.example/granergize/inbox/",
  );
});

Deno.test("getRecipientInboxUrl: discovers a relocated inbox via ldp:inbox on the granergize root", async () => {
  const s = session({
    "https://b.example/profile/card":
      `<${WEBID}> <http://www.w3.org/ns/pim/space#storage> <https://b.example/> .`,
    "https://b.example/granergize/":
      `<https://b.example/granergize/> <http://www.w3.org/ns/ldp#inbox> <https://b.example/granergize/box/> .`,
  });
  assert.equal(
    await getRecipientInboxUrl(WEBID, s),
    "https://b.example/granergize/box/",
  );
});

Deno.test("inboxFromLinkHeader resolves a relative inbox URI", () => {
  assert.equal(
    inboxFromLinkHeader('</granergize/inbox/>; rel="http://www.w3.org/ns/ldp#inbox"', WEBID),
    "https://b.example/granergize/inbox/",
  );
});

Deno.test("inboxFromLinkHeader ignores unrelated Link relations", () => {
  assert.equal(
    inboxFromLinkHeader('<https://x/acl>; rel="acl", <https://y/>; rel="type"', WEBID),
    null,
  );
});

Deno.test("isMessageResource: real inbox messages are processed", () => {
  const inbox = "https://b.example/granergize/inbox/";
  for (
    const u of [
      `${inbox}d5653358-2c8f-4224-bbdc-8bb01923e887`, // server-minted POST name
      `${inbox}grant-2026.ttl`,
    ]
  ) {
    assert.equal(isMessageResource(u), true, u);
  }
});

Deno.test("isMessageResource: auxiliary sidecars (.acl/.meta) are excluded", () => {
  // Some servers (JSS) list a container's own auxiliaries in ldp:contains.
  // Draining GETs + DELETEs each entry, so a stray `.acl` would delete the
  // inbox's own access-control resource and silently revoke every sender's
  // append grant — these must never be treated as messages.
  const inbox = "https://b.example/granergize/inbox/";
  for (const u of [`${inbox}.acl`, `${inbox}.meta`]) {
    assert.equal(isMessageResource(u), false, u);
  }
});

Deno.test("ensureOwnInbox: provisions inbox + ACL on a bare Pod and reports creation", async () => {
  _setStorageRootForTesting(WEBID, "https://b.example/");
  const { session, writes } = recordingSession(false);
  const created = await ensureOwnInbox(session);
  assert.equal(created, true);
  // No `.meta` advertisement PUT: it 409s on CSS and the convention path makes
  // it redundant — see ensureOwnInbox / granergizeInboxUrl.
  assert.deepEqual(
    writes.filter((w) => w.method === "PUT").map((w) => w.url),
    [
      "https://b.example/granergize/inbox/",
      "https://b.example/granergize/inbox/.acl",
    ],
  );
});

Deno.test("ensureOwnInbox: no writes and no creation notice when the inbox already exists", async () => {
  _setStorageRootForTesting(WEBID, "https://b.example/");
  const { session, writes } = recordingSession(true);
  const created = await ensureOwnInbox(session);
  assert.equal(created, false);
  assert.deepEqual(writes, []);
});

// Keep the storage-root cache clean for other suites (resolveStorageRootForWebId
// doesn't cache, but be tidy in case a future test relies on it).
_setStorageRootForTesting(WEBID, "https://b.example/");
