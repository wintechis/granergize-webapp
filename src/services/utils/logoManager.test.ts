/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import type { Session } from "@inrupt/solid-client-authn-browser";
import { getAvatarUrl } from "./logoManager.ts";
import { _resetProfileCacheForTesting } from "./profileDocument.ts";

const WEBID = "https://pod.example/profile/card#me";
const PROFILE_DOC = "https://pod.example/profile/card";

// getAvatarUrl reads through the shared profile cache; each case calls
// _resetProfileCacheForTesting() first so it sees its own fixture, not a prior
// case's cached profile.

/** A fake Session that serves in-memory docs for GET. */
function makeSession(files: Record<string, string>): Session {
  const fetchImpl = (input: string | URL | Request): Promise<Response> => {
    const url = (typeof input === "string" ? input : input.toString())
      .split("?")[0];
    const body = files[url];
    return Promise.resolve(
      body === undefined
        ? new Response("Not found", { status: 404 })
        : new Response(body, {
          status: 200,
          headers: { "Content-Type": "text/turtle" },
        }),
    );
  };
  return {
    info: { isLoggedIn: true, webId: WEBID },
    fetch: fetchImpl as unknown as Session["fetch"],
  } as unknown as Session;
}

Deno.test("getAvatarUrl prefers foaf:img over vcard:hasPhoto", async () => {
  _resetProfileCacheForTesting();
  const session = makeSession({
    [PROFILE_DOC]: `
      @prefix foaf: <http://xmlns.com/foaf/0.1/> .
      @prefix vcard: <http://www.w3.org/2006/vcard/ns#> .
      <${WEBID}> foaf:img <https://pod.example/profile/logo.png> ;
                 vcard:hasPhoto <https://pod.example/profile/photo.jpg> .
    `,
  });
  assert.deepEqual(
    await getAvatarUrl(session),
    "https://pod.example/profile/logo.png",
  );
});

Deno.test("getAvatarUrl falls back to vcard:hasPhoto when no foaf:img", async () => {
  _resetProfileCacheForTesting();
  const session = makeSession({
    [PROFILE_DOC]: `
      @prefix vcard: <http://www.w3.org/2006/vcard/ns#> .
      <${WEBID}> vcard:hasPhoto <https://pod.example/profile/photo.jpg> .
    `,
  });
  assert.deepEqual(
    await getAvatarUrl(session),
    "https://pod.example/profile/photo.jpg",
  );
});

Deno.test("getAvatarUrl returns null when the profile has no depiction", async () => {
  _resetProfileCacheForTesting();
  const session = makeSession({
    [PROFILE_DOC]: `
      @prefix foaf: <http://xmlns.com/foaf/0.1/> .
      <${WEBID}> foaf:name "Homer" .
    `,
  });
  assert.deepEqual(await getAvatarUrl(session), null);
});
