/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import type { Session } from "@inrupt/solid-client-authn-browser";
import {
  getPodBaseUrl,
  podResources,
  resolveStorageRoot,
} from "./solidUtils.ts";

const WEBID = "https://pod.example/profile/card#me";

/**
 * Fake Session serving one profile doc for GET. Each test passes a distinct
 * `webId` so the module-global storage-root cache (resolveStorageRoot is now
 * idempotent) doesn't carry over between cases.
 */
function makeSession(webId: string, profileTtl: string | null): Session {
  const profileDoc = webId.split("#")[0];
  const fetchImpl = (input: string | URL | Request): Promise<Response> => {
    const url = (typeof input === "string" ? input : input.toString())
      .split("?")[0];
    if (url === profileDoc && profileTtl !== null) {
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
    info: { isLoggedIn: true, webId },
    fetch: fetchImpl as unknown as Session["fetch"],
  } as unknown as Session;
}

Deno.test("resolveStorageRoot reads pim:storage from the profile", async () => {
  const webId = "https://reads.example/profile/card#me";
  const session = makeSession(
    webId,
    `@prefix pim: <http://www.w3.org/ns/pim/space#> .
    <${webId}> pim:storage <https://reads.example/> .`,
  );
  assert.deepEqual(await resolveStorageRoot(session), "https://reads.example/");
  // …and it's now cached for synchronous podResources() use.
  assert.deepEqual(
    podResources(webId).buildings,
    "https://reads.example/granergize/buildings/",
  );
});

Deno.test("resolveStorageRoot adds a trailing slash if missing", async () => {
  const webId = "https://slash.example/profile/card#me";
  const session = makeSession(
    webId,
    `@prefix pim: <http://www.w3.org/ns/pim/space#> .
    <${webId}> pim:storage <https://slash.example/store> .`,
  );
  assert.deepEqual(
    await resolveStorageRoot(session),
    "https://slash.example/store/",
  );
});

Deno.test("resolveStorageRoot throws when the profile declares no pim:storage", async () => {
  const webId = "https://nostorage.example/profile/card#me";
  const session = makeSession(
    webId,
    `@prefix foaf: <http://xmlns.com/foaf/0.1/> .
    <${webId}> foaf:name "Homer" .`,
  );
  await assert.rejects(() => resolveStorageRoot(session), /no pim:storage/);
});

Deno.test("resolveStorageRoot throws when the profile is unreachable", async () => {
  const session = makeSession("https://unreachable.example/profile/card#me", null);
  await assert.rejects(() => resolveStorageRoot(session), /Cannot read WebID profile/);
});

Deno.test("getPodBaseUrl returns the WebID document's directory", () => {
  assert.deepEqual(getPodBaseUrl(WEBID), "https://pod.example/profile/");
});
