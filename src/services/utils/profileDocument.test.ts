/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import type { Session } from "@inrupt/solid-client-authn-browser";
import {
  _resetProfileCacheForTesting,
  invalidateProfile,
  loadProfileStore,
} from "./profileDocument.ts";

const WEBID = "https://pod.example/profile/card#me";
const PROFILE = `@prefix foaf: <http://xmlns.com/foaf/0.1/> .
@prefix pim: <http://www.w3.org/ns/pim/space#> .
<${WEBID}> pim:storage <https://pod.example/> ; foaf:name "Homer" .`;

/** Fake Session whose fetch serves the profile and counts how often it's hit. */
function makeSession(): { session: Session; calls: () => number } {
  let calls = 0;
  const profileDoc = WEBID.split("#")[0];
  const fetchImpl = (input: string | URL | Request): Promise<Response> => {
    const url = (typeof input === "string" ? input : input.toString())
      .split("?")[0];
    if (url === profileDoc) {
      calls++;
      return Promise.resolve(
        new Response(PROFILE, {
          status: 200,
          headers: { "Content-Type": "text/turtle" },
        }),
      );
    }
    return Promise.resolve(new Response("Not found", { status: 404 }));
  };
  return {
    session: {
      info: { isLoggedIn: true, webId: WEBID },
      fetch: fetchImpl as unknown as Session["fetch"],
    } as unknown as Session,
    calls: () => calls,
  };
}

Deno.test("loadProfileStore: second read is served from cache (one fetch)", async () => {
  _resetProfileCacheForTesting();
  const { session, calls } = makeSession();
  const a = await loadProfileStore(session);
  const b = await loadProfileStore(session);
  assert.ok(a && b);
  assert.equal(a, b); // same cached Store instance
  assert.equal(calls(), 1);
});

Deno.test("loadProfileStore: concurrent first reads share one fetch", async () => {
  _resetProfileCacheForTesting();
  const { session, calls } = makeSession();
  const [a, b, c] = await Promise.all([
    loadProfileStore(session),
    loadProfileStore(session),
    loadProfileStore(session),
  ]);
  assert.ok(a && b && c);
  assert.equal(calls(), 1);
});

Deno.test("loadProfileStore: { fresh: true } forces a re-fetch", async () => {
  _resetProfileCacheForTesting();
  const { session, calls } = makeSession();
  await loadProfileStore(session);
  await loadProfileStore(session, { fresh: true });
  assert.equal(calls(), 2);
});

Deno.test("invalidateProfile: next read re-fetches", async () => {
  _resetProfileCacheForTesting();
  const { session, calls } = makeSession();
  await loadProfileStore(session);
  invalidateProfile(WEBID);
  await loadProfileStore(session);
  assert.equal(calls(), 2);
});

Deno.test("loadProfileStore: an unreadable profile returns null and is not cached", async () => {
  _resetProfileCacheForTesting();
  let calls = 0;
  const session = {
    info: { isLoggedIn: true, webId: WEBID },
    fetch: (() => {
      calls++;
      return Promise.resolve(new Response("nope", { status: 404 }));
    }) as unknown as Session["fetch"],
  } as unknown as Session;
  assert.equal(await loadProfileStore(session), null);
  assert.equal(await loadProfileStore(session), null); // retried, not cached
  assert.equal(calls, 2);
});
