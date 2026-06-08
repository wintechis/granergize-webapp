/// <reference lib="deno.ns" />
import assert from "node:assert";
import type { Session } from "@inrupt/solid-client-authn-browser";
import {
  ensureOwnInbox,
  drainInbox,
  getRecipientInboxUrl,
  inboxFromLinkHeader,
  isMessageResource,
} from "./inbox.ts";
import { _setStorageRootForTesting } from "../utils/solidUtils.ts";
import { ACL_NS, INTEROP_NS, LDP_CONTAINS } from "../utils/vocabularies.ts";

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

Deno.test("drainInbox creates shared-in/ once when draining multiple messages (no per-append create race)", async () => {
  // Regression guard: the drain fans out over messages with Promise.all, and each
  // appendSharingEvent ensures shared-in/. Without an up-front ensure, every
  // message races to create the container (all GET 404, all PUT) — a duplicate
  // create a strict server (JSS) rejects with 409. drainInbox must create it ONCE.
  _setStorageRootForTesting(WEBID, "https://b.example/");
  const appRoot = "https://b.example/granergize/";
  const inbox = `${appRoot}inbox/`;
  const sharedIn = `${appRoot}shared-in/`;
  const msgs = [`${inbox}m1`, `${inbox}m2`, `${inbox}m3`];
  const grant = (resource: string) =>
    `@prefix interop: <${INTEROP_NS}> .\n@prefix acl: <${ACL_NS}> .\n` +
    `@prefix prov: <http://www.w3.org/ns/prov#> .\n` +
    `@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .\n` +
    `<> a interop:AccessGrant ; interop:grantee <https://a.example/card#me> ; ` +
    `interop:forResource <${resource}> ; interop:accessMode acl:Read ; ` +
    `prov:generatedAtTime "2026-06-08T00:00:00Z"^^xsd:dateTime .`;
  const ttl = (body: string, status = 200) =>
    Promise.resolve(
      new Response(body, { status, headers: { "Content-Type": "text/turtle" } }),
    );

  let sharedInExists = false;
  const calls: { method: string; url: string }[] = [];
  const session = {
    info: { isLoggedIn: true, webId: WEBID },
    fetch: (input: string | URL | Request, init?: RequestInit) => {
      const url = (typeof input === "string" ? input : input.toString()).split("?")[0];
      const method = (init?.method ?? "GET").toUpperCase();
      calls.push({ method, url });
      // inbox discovery: app root carries no ldp:inbox → convention inbox/
      if (url === appRoot && method === "GET") return ttl("");
      // inbox listing
      if (url === inbox && method === "GET") {
        return ttl(`<${inbox}> <${LDP_CONTAINS}> ${msgs.map((m) => `<${m}>`).join(", ")} .`);
      }
      // message bodies + their deletion
      const mi = msgs.indexOf(url);
      if (mi >= 0 && method === "GET") return ttl(grant(`https://a.example/b${mi}.ttl`));
      if (mi >= 0 && method === "DELETE") return ttl("");
      // shared-in/ ensure: 404 until created, PUT creates, POST appends
      if (url === sharedIn && method === "GET") {
        return sharedInExists ? ttl("") : ttl("Not found", 404);
      }
      if (url === sharedIn && method === "PUT") {
        sharedInExists = true;
        return ttl("", 201);
      }
      if (url === sharedIn && method === "POST") return ttl("", 201);
      return ttl("Not found", 404);
    },
  } as unknown as Session;

  await drainInbox(session);

  const sharedInPuts = calls.filter((c) => c.method === "PUT" && c.url === sharedIn);
  assert.equal(sharedInPuts.length, 1, "shared-in/ created exactly once, not once per message");
  const posts = calls.filter((c) => c.method === "POST" && c.url === sharedIn);
  assert.equal(posts.length, msgs.length, "one event appended per drained message");
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
