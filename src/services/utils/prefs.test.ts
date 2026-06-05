/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import type { Session } from "@inrupt/solid-client-authn-browser";
import { Parser, Store } from "n3";
import { _setStorageRootForTesting } from "./solidUtils.ts";
import {
  prefsUrl,
  readPrefs,
  setCurrentRoom,
  setDemoSeedDeclined,
  toggleHiddenBuilding,
} from "./prefs.ts";
import { GRAN_NS } from "./vocabularies.ts";

const WEBID = "https://pod.example/profile/card#me";
_setStorageRootForTesting(WEBID, "https://pod.example/");
const PREFS = prefsUrl(WEBID);
const ROOM = "https://pod.example/granergize/rooms/aaaa/";
const B1 = "https://other.example/granergize/buildings/x.ttl#x";
const B2 = "https://other.example/granergize/buildings/y.ttl#y";

/**
 * A stateful fake Session: GET reads the in-memory store (404 when absent),
 * PUT writes back — so the read-modify-write paths run with no Pod or network.
 * No ETag header is served, so writes degrade to plain PUTs (which is fine).
 */
function makeSession(
  store: Record<string, string> = {},
): { session: Session; store: Record<string, string> } {
  const fetch = (input: string | URL, init?: RequestInit): Promise<Response> => {
    const url = (typeof input === "string" ? input : input.toString())
      .split("?")[0];
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "PUT") {
      store[url] = String(init?.body ?? "");
      return Promise.resolve(new Response(null, { status: 201 }));
    }
    const body = store[url];
    if (body === undefined) {
      return Promise.resolve(new Response("Not found", { status: 404 }));
    }
    return Promise.resolve(
      new Response(body, {
        status: 200,
        headers: { "Content-Type": "text/turtle" },
      }),
    );
  };
  return {
    session: {
      info: { webId: WEBID, isLoggedIn: true },
      fetch,
    } as unknown as Session,
    store,
  };
}

Deno.test("readPrefs on a missing file yields empty prefs", async () => {
  const { session } = makeSession();
  const prefs = await readPrefs(session);
  assert.equal(prefs.currentRoom, null);
  assert.equal(prefs.hiddenBuildings.size, 0);
  assert.equal(prefs.demoSeedDeclined, false);
});

Deno.test("setDemoSeedDeclined remembers the choice and coexists with room + hidden", async () => {
  const { session } = makeSession();
  await setCurrentRoom(session, ROOM);
  await toggleHiddenBuilding(session, B1);
  await setDemoSeedDeclined(session, true);

  let prefs = await readPrefs(session);
  assert.equal(prefs.demoSeedDeclined, true);
  assert.equal(prefs.currentRoom, ROOM, "room kept");
  assert.ok(prefs.hiddenBuildings.has(B1), "hidden kept");

  await setDemoSeedDeclined(session, false); // clears it
  prefs = await readPrefs(session);
  assert.equal(prefs.demoSeedDeclined, false);
  assert.equal(prefs.currentRoom, ROOM, "room still kept after clearing");
});

Deno.test("setCurrentRoom persists and reads back", async () => {
  const { session } = makeSession();
  await setCurrentRoom(session, ROOM);
  assert.equal((await readPrefs(session)).currentRoom, ROOM);
});

Deno.test("setCurrentRoom(null) clears the pointer", async () => {
  const { session } = makeSession();
  await setCurrentRoom(session, ROOM);
  await setCurrentRoom(session, null);
  assert.equal((await readPrefs(session)).currentRoom, null);
});

Deno.test("toggleHiddenBuilding hides then unhides", async () => {
  const { session } = makeSession();
  await toggleHiddenBuilding(session, B1);
  assert.ok((await readPrefs(session)).hiddenBuildings.has(B1));
  await toggleHiddenBuilding(session, B1);
  assert.ok(!(await readPrefs(session)).hiddenBuildings.has(B1));
});

Deno.test("the room pointer and the hidden list coexist in one prefs file", async () => {
  const { session, store } = makeSession();
  await setCurrentRoom(session, ROOM);
  await toggleHiddenBuilding(session, B1);
  await toggleHiddenBuilding(session, B2);

  const prefs = await readPrefs(session);
  assert.equal(prefs.currentRoom, ROOM, "setting the hidden list kept the room");
  assert.deepEqual([...prefs.hiddenBuildings].sort(), [B1, B2].sort());

  // The file self-describes as gran:Preferences.
  const out = new Store(new Parser().parse(store[PREFS]));
  assert.equal(
    out.getQuads(
      null,
      "http://www.w3.org/1999/02/22-rdf-syntax-ns#type",
      `${GRAN_NS}Preferences`,
      null,
    ).length,
    1,
  );
});
