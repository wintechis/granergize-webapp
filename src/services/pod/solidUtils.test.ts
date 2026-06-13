/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import type { Session } from "@inrupt/solid-client-authn-browser";
import {
  APP_DIR,
  appRoot,
  getPodBaseUri,
  podResources,
  resolveStorageRoot,
  _setStorageRootForTesting,
} from "./solidUtils.ts";
import { makeFakeSession } from "../testing/fakeSession.ts";

const WEBID = "https://pod.example/profile/card#me";

/**
 * Fake Session serving one profile doc for GET. Each test passes a distinct
 * `webId` so the module-global storage-root cache (resolveStorageRoot is now
 * idempotent) doesn't carry over between cases.
 */
function makeSession(webId: string, profileTtl: string | null): Session {
  const profileDoc = webId.split("#")[0];
  return makeFakeSession({
    webId,
    resources: profileTtl === null ? {} : { [profileDoc]: profileTtl },
  }).session;
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

Deno.test("resolveStorageRoot falls back to the pim:Storage-typed container", async () => {
  // No pim:storage on the card (e.g. a fresh CSS Pod); the pod root container is
  // typed pim:Storage. Walk up from the WebID doc and discover it.
  const webId = "https://disco.example/alice/profile/card#me";
  const root = "https://disco.example/alice/";
  const { session } = makeFakeSession({
    webId,
    resources: {
      [webId.split("#")[0]]: `<${webId}> <http://xmlns.com/foaf/0.1/name> "A" .`,
      [root]: `<${root}> a <http://www.w3.org/ns/pim/space#Storage> .`,
    },
  });
  assert.deepEqual(await resolveStorageRoot(session), root);
});

Deno.test("resolveStorageRoot throws when the profile is unreachable", async () => {
  const session = makeSession("https://unreachable.example/profile/card#me", null);
  await assert.rejects(() => resolveStorageRoot(session), /Cannot read WebID profile/);
});

Deno.test("getPodBaseUri returns the WebID document's directory", () => {
  assert.deepEqual(getPodBaseUri(WEBID), "https://pod.example/profile/");
});

Deno.test("APP_DIR defaults to 'granergize' (no VITE override under deno test)", () => {
  // Tier 4 overrides this to 'granergize-e2e' via VITE_POD_APP_DIR at build time;
  // import.meta.env is absent here, so the production default holds.
  assert.equal(APP_DIR, "granergize");
});

Deno.test("appRoot is <storageRoot><APP_DIR>/ and anchors every podResources path", () => {
  const webId = "https://approot.example/profile/card#me";
  _setStorageRootForTesting(webId, "https://approot.example/");
  assert.equal(appRoot(webId), `https://approot.example/${APP_DIR}/`);
  // The whole app collection hangs off appRoot, so an override moves all of it.
  const r = podResources(webId);
  assert.equal(r.appRoot, appRoot(webId));
  assert.equal(r.buildings, `${appRoot(webId)}buildings/`);
  assert.equal(r.prefs, `${appRoot(webId)}prefs.ttl`);
  assert.equal(r.bookmarks, `${appRoot(webId)}bookmarks.ttl`);
  assert.equal(r.sharedIn, `${appRoot(webId)}shared-in/`);
});
