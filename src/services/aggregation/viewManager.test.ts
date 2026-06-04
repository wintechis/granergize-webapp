/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import type { Session } from "@inrupt/solid-client-authn-browser";
import { Parser, Store } from "n3";
import { _setStorageRootForTesting } from "../utils/solidUtils.ts";
import {
  createViewDefinition,
  deleteView,
  getViewDefinition,
  getViewDefinitions,
  getSnapshotUrl,
  storeComputedSnapshot,
} from "./viewManager.ts";

const WEBID = "https://pod.example/profile/card#me";
_setStorageRootForTesting(WEBID, "https://pod.example/");
const VIEWS = "https://pod.example/granergize/views/";
const SNAPSHOTS = "https://pod.example/granergize/views/snapshots/";
const GRAN = "https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#";

/**
 * A stateful fake Pod: PUT/DELETE mutate an in-memory store; a GET of a container
 * (URL ending "/") synthesizes an `ldp:contains` listing of its direct children,
 * so the container-native discovery (list `views/`) runs offline. HEAD on a
 * container is 200 (so ensure-dirs is a no-op).
 */
function makeSession(
  store: Record<string, string> = {},
): { session: Session; store: Record<string, string> } {
  const directChildren = (container: string): string[] => {
    const seen = new Set<string>();
    for (const key of Object.keys(store)) {
      if (!key.startsWith(container) || key === container) continue;
      const rest = key.slice(container.length);
      const slash = rest.indexOf("/");
      seen.add(slash === -1 ? key : `${container}${rest.slice(0, slash)}/`);
    }
    return [...seen];
  };
  const fetch = (input: string | URL, init?: RequestInit): Promise<Response> => {
    const url = (typeof input === "string" ? input : input.toString())
      .split("?")[0];
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "PUT") {
      store[url] = String(init?.body ?? "");
      return Promise.resolve(new Response(null, { status: 201 }));
    }
    if (method === "DELETE") {
      delete store[url];
      return Promise.resolve(new Response(null, { status: 205 }));
    }
    if (method === "HEAD") {
      // Containers always "exist" (skip creation); leaves 404 if absent.
      const ok = url.endsWith("/") || url in store;
      return Promise.resolve(new Response(null, { status: ok ? 200 : 404 }));
    }
    // GET
    if (url.endsWith("/")) {
      const refs = directChildren(url).map((c) => `<${c}>`).join(", ");
      const body = `@prefix ldp: <http://www.w3.org/ns/ldp#> .\n<${url}> a ldp:Container${
        refs ? ` ; ldp:contains ${refs}` : ""
      } .\n`;
      return Promise.resolve(
        new Response(body, {
          status: 200,
          headers: { "Content-Type": "text/turtle" },
        }),
      );
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

function parse(ttl: string): Store {
  return new Store(new Parser().parse(ttl));
}

Deno.test("createViewDefinition writes one views/<id>.ttl resource", async () => {
  const { session, store } = makeSession();
  const view = await createViewDefinition(
    session,
    "My view",
    ["https://pod.example/granergize/buildings/b1.ttl#b1"],
    "average",
    ["electricity"],
  );

  const defUrl = `${VIEWS}${view.id}.ttl`;
  assert.ok(store[defUrl], "the definition resource was PUT under views/");
  const s = parse(store[defUrl]);
  assert.equal(
    s.getQuads(null, "http://www.w3.org/1999/02/22-rdf-syntax-ns#type", `${GRAN}AggregatedViewDefinition`, null).length,
    1,
  );
  assert.equal(s.getObjects(null, `${GRAN}viewName`, null)[0]?.value, "My view");
  assert.equal(s.getObjects(null, `${GRAN}includesMetric`, null)[0]?.value, "electricity");
});

Deno.test("getViewDefinitions lists the container and parses each view", async () => {
  const { session } = makeSession();
  const v1 = await createViewDefinition(session, "A", [], "average", ["heat"]);
  const v2 = await createViewDefinition(session, "B", [], "sum", ["water"]);

  const views = await getViewDefinitions(session);
  assert.equal(views.length, 2);
  const names = views.map((v) => v.name).sort();
  assert.deepEqual(names, ["A", "B"]);
  // Round-trips a single view by id, too.
  const got = await getViewDefinition(session, v1.id);
  assert.equal(got?.name, "A");
  assert.equal(got?.id, v1.id);
  assert.ok(v2.id !== v1.id);
});

Deno.test("getViewDefinitions ignores the snapshots/ subfolder", async () => {
  const { session } = makeSession();
  const v = await createViewDefinition(session, "A", [], "average", ["heat"]);
  await storeComputedSnapshot(session, {
    id: v.id,
    name: "A",
    aggregationType: "average",
    computedAt: "2026-06-04T10:00:00Z",
    buildingCount: 3,
    metrics: ["heat"],
    values: { heat: 1234.5 },
  });

  // Snapshot landed under snapshots/, and the def now records lastComputedAt.
  const views = await getViewDefinitions(session);
  assert.equal(views.length, 1, "the snapshots/ subfolder is not a view");
  assert.equal(views[0].lastComputedAt, "2026-06-04T10:00:00Z");
});

Deno.test("storeComputedSnapshot writes the shareable snapshot under snapshots/", async () => {
  const { session, store } = makeSession();
  const v = await createViewDefinition(session, "A", [], "average", ["heat"]);
  await storeComputedSnapshot(session, {
    id: v.id,
    name: "A",
    aggregationType: "average",
    computedAt: "2026-06-04T10:00:00Z",
    buildingCount: 3,
    metrics: ["heat"],
    values: { heat: 1234.5 },
  });

  const snapUrl = getSnapshotUrl(WEBID, v.id);
  assert.equal(snapUrl, `${SNAPSHOTS}${v.id}.ttl`);
  const s = parse(store[snapUrl]);
  assert.equal(s.getObjects(null, `${GRAN}buildingCount`, null)[0]?.value, "3");
  assert.equal(s.getObjects(null, `${GRAN}heatValue`, null)[0]?.value, "1234.50");
});

Deno.test("deleteView removes the definition and its snapshot", async () => {
  const { session, store } = makeSession();
  const v = await createViewDefinition(session, "A", [], "average", ["heat"]);
  await storeComputedSnapshot(session, {
    id: v.id,
    name: "A",
    aggregationType: "average",
    computedAt: "2026-06-04T10:00:00Z",
    buildingCount: 1,
    metrics: ["heat"],
    values: { heat: 1 },
  });

  await deleteView(session, v.id);

  assert.ok(!(`${VIEWS}${v.id}.ttl` in store), "definition deleted");
  assert.ok(!(`${SNAPSHOTS}${v.id}.ttl` in store), "snapshot deleted");
  assert.deepEqual(await getViewDefinitions(session), []);
});
