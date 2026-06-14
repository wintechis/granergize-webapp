/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import type { Session } from "@inrupt/solid-client-authn-browser";
import { readStoreOrEmpty } from "./podFetch.ts";
import { makeFakeSession } from "../testing/fakeSession.ts";

/** A fake offline session whose fetch serves a canned Response and records the
 *  request init, so we can assert the read is sent with Accept: text/turtle. */
function fakeSession(
  handler: (url: string) => Response,
): { session: Session; lastInit: () => RequestInit | undefined } {
  let init: RequestInit | undefined;
  const { session } = makeFakeSession({
    respond: (url, requestInit) => {
      init = requestInit;
      return handler(url);
    },
  });
  return { session, lastInit: () => init };
}

Deno.test("readStoreOrEmpty: parses Turtle into a Store, baseIRI = url", async () => {
  const url = "http://pod/c/r.ttl";
  const { session, lastInit } = fakeSession(() =>
    new Response("<#a> <http://ex/p> <#b> .", {
      status: 200,
      headers: { "Content-Type": "text/turtle" },
    })
  );
  const store = await readStoreOrEmpty(url, session);

  // The read must carry Accept: text/turtle (the whole point of the chokepoint).
  assert.equal(
    new Headers(lastInit()?.headers).get("Accept"),
    "text/turtle",
  );
  // Relative subjects/objects resolve against the resource URL (baseIRI).
  assert.equal(store.size, 1);
  const q = store.getQuads(null, null, null, null)[0];
  assert.equal(q.subject.value, "http://pod/c/r.ttl#a");
  assert.equal(q.object.value, "http://pod/c/r.ttl#b");
});

Deno.test("readStoreOrEmpty: a non-ok response (404/403/500) → empty Store", async () => {
  const url = "http://pod/c/x.ttl";
  for (const status of [404, 403, 500]) {
    const { session } = fakeSession(() => new Response("nope", { status }));
    const store = await readStoreOrEmpty(url, session);
    assert.equal(store.size, 0, `HTTP ${status} → empty Store`);
  }
});
