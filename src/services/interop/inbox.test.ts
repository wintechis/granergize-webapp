/// <reference lib="deno.ns" />
import assert from "node:assert";
import type { Session } from "@inrupt/solid-client-authn-browser";
import { getRecipientInboxUrl, inboxFromLinkHeader } from "./inbox.ts";
import { _setStorageRootForTesting } from "../utils/solidUtils.ts";

const WEBID = "https://b.example/profile/card#me";

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

// Keep the storage-root cache clean for other suites (resolveStorageRootForWebId
// doesn't cache, but be tidy in case a future test relies on it).
_setStorageRootForTesting(WEBID, "https://b.example/");
