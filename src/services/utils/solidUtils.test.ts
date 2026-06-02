/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import type { Session } from "@inrupt/solid-client-authn-browser";
import {
  getPodBaseUrl,
  podResources,
  resolveStorageRoot,
} from "./solidUtils.ts";

const WEBID = "https://pod.example/profile/card#me";
const PROFILE_DOC = "https://pod.example/profile/card";

/** Fake Session serving one profile doc for GET. */
function makeSession(profileTtl: string | null): Session {
  const fetchImpl = (input: string | URL | Request): Promise<Response> => {
    const url = (typeof input === "string" ? input : input.toString())
      .split("?")[0];
    if (url === PROFILE_DOC && profileTtl !== null) {
      return Promise.resolve(
        new Response(profileTtl, {
          status: 200,
          headers: { "Content-Type": "text/turtle" },
        }),
      );
    }
    return Promise.resolve(new Response("Not found", { status: 404 }));
  };
  return {
    info: { isLoggedIn: true, webId: WEBID },
    fetch: fetchImpl as unknown as Session["fetch"],
  } as unknown as Session;
}

Deno.test("resolveStorageRoot reads pim:storage from the profile", async () => {
  const session = makeSession(`
    @prefix pim: <http://www.w3.org/ns/pim/space#> .
    <${WEBID}> pim:storage <https://pod.example/> .
  `);
  assert.deepEqual(await resolveStorageRoot(session), "https://pod.example/");
  // …and it's now cached for synchronous podResources() use.
  assert.deepEqual(
    podResources(WEBID).registry,
    "https://pod.example/granergize/dataSources.ttl",
  );
});

Deno.test("resolveStorageRoot adds a trailing slash if missing", async () => {
  const session = makeSession(`
    @prefix pim: <http://www.w3.org/ns/pim/space#> .
    <${WEBID}> pim:storage <https://pod.example/store> .
  `);
  assert.deepEqual(await resolveStorageRoot(session), "https://pod.example/store/");
});

Deno.test("resolveStorageRoot throws when the profile declares no pim:storage", async () => {
  const session = makeSession(`
    @prefix foaf: <http://xmlns.com/foaf/0.1/> .
    <${WEBID}> foaf:name "Homer" .
  `);
  await assert.rejects(() => resolveStorageRoot(session), /no pim:storage/);
});

Deno.test("resolveStorageRoot throws when the profile is unreachable", async () => {
  const session = makeSession(null);
  await assert.rejects(() => resolveStorageRoot(session), /Cannot read WebID profile/);
});

Deno.test("getPodBaseUrl returns the WebID document's directory", () => {
  assert.deepEqual(getPodBaseUrl(WEBID), "https://pod.example/profile/");
});
