/// <reference lib="deno.ns" />
import "./test-dom-setup.ts"; // must precede React / Testing Library
import { strict as assert } from "node:assert";
import * as React from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Session } from "@inrupt/solid-client-authn-browser";
import {
  useCreateRoom,
  useDeleteBuilding,
  useDeleteView,
  useExitRoom,
  useRefreshView,
  useRemoveBookmark,
} from "./mutations.ts";
import { queryKeys } from "./queries.ts";
import { _setSessionForTesting } from "./session.ts";
import { _setStorageRootForTesting } from "../services/pod/solidUtils.ts";
import { resetActiveRoom } from "../services/interop/dataRoom.ts";
import type { BuildingType } from "../types.ts";

/**
 * The room-registry mutations don't invalidate the `["rooms", webId]` query —
 * they patch it authoritatively via `setQueryData` so a slow/stale read-back on a
 * throttled Pod can't revert a switch (see mutations.ts). These tests assert that
 * cache-patch reducer wiring (the part the data-layer tests can't reach), driving
 * the real service functions against an in-memory Pod.
 */

const WEBID = "https://alice.example/profile/card#me";
const ORIGIN = "https://alice.example/";
type RoomRegistry = { known: string[]; current: string | null };

/**
 * Minimal in-memory LDP Pod — GET resource/container listing, PUT create, POST
 * append (server mints the child URL), DELETE. Mirrors the FakePod in
 * dataRoom.test.ts; enough for createRoom / enterRoom / exitRoom / removeKnownRoom.
 */
class FakePod {
  readonly containers = new Set<string>();
  readonly resources = new Map<string, string>();
  private counter = 0;

  fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = input.toString().split("?")[0];
    const method = init?.method ?? "GET";
    const turtle = { "Content-Type": "text/turtle" };
    const res = (body: string, status: number, headers?: HeadersInit) =>
      Promise.resolve(new Response(body || null, { status, headers }));

    if (method === "GET") {
      if (url.endsWith("/")) {
        if (!this.containers.has(url)) return res("", 404);
        const isChild = (k: string) => {
          if (!k.startsWith(url) || k === url || k.endsWith(".acl")) return false;
          const rest = k.slice(url.length).replace(/\/$/, "");
          return rest.length > 0 && !rest.includes("/");
        };
        const children = [
          ...new Set([...this.resources.keys(), ...this.containers].filter(isChild)),
        ];
        return res(
          children.map((c) => `<${url}> <http://www.w3.org/ns/ldp#contains> <${c}> .`).join("\n"),
          200,
          turtle,
        );
      }
      const body = this.resources.get(url);
      return body === undefined ? res("", 404) : res(body, 200, turtle);
    }
    if (method === "PUT") {
      if (url.endsWith("/")) this.containers.add(url);
      else this.resources.set(url, String(init?.body ?? ""));
      this.addAncestors(url);
      return res("", 201);
    }
    if (method === "POST") {
      this.containers.add(url);
      this.addAncestors(url);
      const child = `${url}evt-${++this.counter}`;
      this.resources.set(child, String(init?.body ?? ""));
      return res("", 201, { Location: child });
    }
    if (method === "DELETE") {
      if (url.endsWith("/")) this.containers.delete(url);
      else this.resources.delete(url);
      return res("", 205);
    }
    return res("", 405);
  };

  private addAncestors(url: string): void {
    for (
      let i = url.indexOf("/", url.indexOf("://") + 3);
      i !== -1;
      i = url.indexOf("/", i + 1)
    ) {
      if (i + 1 < url.length) this.containers.add(url.slice(0, i + 1));
    }
  }
}

function sessionFor(pod: FakePod): Session {
  _setStorageRootForTesting(WEBID, ORIGIN);
  return { info: { isLoggedIn: true, webId: WEBID }, fetch: pod.fetch } as unknown as Session;
}

/** A QueryClient pre-seeded with the room registry the mutations patch. */
function makeWrapper(initial: RoomRegistry) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  client.setQueryData<RoomRegistry>([...queryKeys.rooms, WEBID], initial);
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children);
  return { client, wrapper };
}

const rooms = (client: QueryClient): RoomRegistry =>
  client.getQueryData<RoomRegistry>([...queryKeys.rooms, WEBID])!;

Deno.test("useCreateRoom adds the new room to the registry and makes it current", async () => {
  resetActiveRoom();
  _setSessionForTesting(sessionFor(new FakePod()));
  const { client, wrapper } = makeWrapper({ known: [], current: null });
  try {
    const { result } = renderHook(() => useCreateRoom(), { wrapper });
    const room = await result.current.mutateAsync();
    await waitFor(() => assert.equal(rooms(client).current, room));
    assert.deepEqual(rooms(client).known, [room]);
    assert.ok(room.startsWith(`${ORIGIN}granergize/rooms/`));
    assert.ok(room.endsWith("/"), "room URL is normalized with a trailing slash");
  } finally {
    _setSessionForTesting(null);
  }
});

Deno.test("useDeleteBuilding drops the deleted building from the list cache on success (no refetch needed)", async () => {
  // Regression: a burst of rapid deletes left the Manage list showing a phantom
  // row because the onSettled invalidation didn't refetch within the poll window
  // (the just-emptied container was never re-read). The fix patches the
  // `["buildings", webId]` cache authoritatively in onSuccess, so the list
  // converges the instant the delete is confirmed — independent of any refetch.
  // This hook renders no `useBuildings` observer, so invalidateQueries can't
  // refetch; the assertion therefore isolates the cache patch.
  const B1 = `${ORIGIN}granergize/buildings/b1.ttl`;
  const B2 = `${ORIGIN}granergize/buildings/b2.ttl`;
  const pod = new FakePod();
  pod.containers.add(`${ORIGIN}granergize/buildings/`);
  pod.resources.set(B1, "<#it> a <urn:Building> .");
  pod.resources.set(B2, "<#it> a <urn:Building> .");
  _setSessionForTesting(sessionFor(pod));
  const b1 = { id: "1", uri: B1 } as unknown as BuildingType;
  const b2 = { id: "2", uri: B2 } as unknown as BuildingType;
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  client.setQueryData<{ buildings: BuildingType[] }>(
    [...queryKeys.buildings, WEBID],
    { buildings: [b1, b2] },
  );
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children);
  try {
    const { result } = renderHook(() => useDeleteBuilding(), { wrapper });
    await result.current.mutateAsync(b1);
    await waitFor(() => {
      const data = client.getQueryData<{ buildings: BuildingType[] }>(
        [...queryKeys.buildings, WEBID],
      )!;
      assert.deepEqual(
        data.buildings.map((b) => b.uri),
        [B2],
        "the deleted building is removed; the other survives",
      );
    });
    // The building file is actually gone server-side too.
    assert.equal(pod.resources.has(B1), false);
    assert.equal(pod.resources.has(B2), true);
  } finally {
    _setSessionForTesting(null);
  }
});

Deno.test("useExitRoom clears the current pointer but keeps the bookmark", async () => {
  resetActiveRoom();
  const ROOM = `${ORIGIN}granergize/rooms/r1/`;
  _setSessionForTesting(sessionFor(new FakePod()));
  const { client, wrapper } = makeWrapper({ known: [ROOM], current: ROOM });
  try {
    const { result } = renderHook(() => useExitRoom(), { wrapper });
    await result.current.mutateAsync(ROOM);
    await waitFor(() => assert.equal(rooms(client).current, null));
    assert.deepEqual(rooms(client).known, [ROOM], "bookmark is kept on exit");
  } finally {
    _setSessionForTesting(null);
  }
});

Deno.test("useRemoveBookmark drops the bookmark and clears current if it was current", async () => {
  resetActiveRoom();
  const R1 = `${ORIGIN}granergize/rooms/r1/`;
  const R2 = `${ORIGIN}granergize/rooms/r2/`;
  _setSessionForTesting(sessionFor(new FakePod()));
  const { client, wrapper } = makeWrapper({ known: [R1, R2], current: R1 });
  try {
    const { result } = renderHook(() => useRemoveBookmark(), { wrapper });
    await result.current.mutateAsync(R1);
    await waitFor(() => assert.deepEqual(rooms(client).known, [R2]));
    assert.equal(rooms(client).current, null, "removing the current room clears the pointer");
  } finally {
    _setSessionForTesting(null);
  }
});

// ── Dialog write hooks (invalidation contracts + central error wiring) ───────

import { MutationCache } from "@tanstack/react-query";
import {
  useCreateView,
  useSaveOrganization,
  useShareBuilding,
  useUpdateBuilding,
  useUploadBuildings,
  useWriteEnergyYear,
} from "./mutations.ts";
import { classifyMutationError } from "./queryErrors.ts";
import { makeFakeSession } from "../services/testing/fakeSession.ts";
import { GRAN_NS, REC_BUILDING } from "../services/rdf/vocabularies.ts";

/** A wrapper whose client records every invalidated key prefix. */
function makeSpyWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidated: string[] = [];
  const orig = client.invalidateQueries.bind(client);
  client.invalidateQueries = ((arg: Parameters<typeof orig>[0]) => {
    const key = (arg as { queryKey?: unknown[] } | undefined)?.queryKey;
    if (Array.isArray(key)) invalidated.push(String(key[0]));
    return orig(arg);
  }) as typeof client.invalidateQueries;
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children);
  return { wrapper, invalidated };
}

Deno.test("useWriteEnergyYear writes the dataset and invalidates the building-data keys", async () => {
  const fake = makeFakeSession({ webId: WEBID });
  _setStorageRootForTesting(WEBID, "https://pod.example/");
  _setSessionForTesting(fake.session);
  const { wrapper, invalidated } = makeSpyWrapper();
  const B = "https://pod.example/granergize/buildings/b1.ttl";
  try {
    const { result } = renderHook(() => useWriteEnergyYear(), { wrapper });
    await result.current.mutateAsync({
      fileUri: B,
      subjectUri: `${B}#b1`,
      dataset: {
        building: `${B}#b1`,
        year: 2024,
        granularity: "P1Y",
        scenario: "actual",
        metrics: { electricityConsumption: 1000 },
      },
    });
    const datasetPut = fake.calls.find(
      (c) => c.method === "PUT" && c.url.includes("2024-P1Y"),
    );
    assert.ok(datasetPut, "the dataset resource was PUT");
    for (
      const key of [
        "buildings",
        "energy",
        "annualEnergy",
        "seriesDays",
        "dayReadings",
        "monthReadings",
      ]
    ) {
      assert.ok(invalidated.includes(key), `${key} was invalidated`);
    }
  } finally {
    _setSessionForTesting(null);
  }
});

Deno.test("useWriteEnergyYear reconciles an active all-years grant onto the new dataset", async () => {
  // The QUESTIONS.md gap, closed at the hook: saving a year on a SHARED
  // building re-applies the all-years grant, so its ACL projection covers the
  // dataset that now exists (no manual rebuild needed).
  const BOB = "https://bob.example/profile/card#me";
  const ROOT = "https://pod.example/";
  const SHARED_OUT = `${ROOT}granergize/shared-out/`;
  const B = `${ROOT}granergize/buildings/b1.ttl`;
  const grantEvent = `@prefix interop: <http://www.w3.org/ns/solid/interop#> .
@prefix prov: <http://www.w3.org/ns/prov#> .
@prefix acl: <http://www.w3.org/ns/auth/acl#> .
@prefix gran: <${GRAN_NS}> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
<> a interop:AccessGrant ;
   prov:wasAssociatedWith <${WEBID}> ;
   interop:grantee <${BOB}> ;
   interop:forResource <${B}> ;
   interop:accessMode acl:Read ;
   gran:kind <${REC_BUILDING}> ;
   prov:generatedAtTime "2026-06-04T10:00:00Z"^^xsd:dateTime .
`;
  const fake = makeFakeSession({
    webId: WEBID,
    resources: {
      [B]: `<${B}#b1> a <https://w3id.org/rec#Building> .`,
      [SHARED_OUT]: `@prefix ldp: <http://www.w3.org/ns/ldp#> .
<${SHARED_OUT}> ldp:contains <${SHARED_OUT}e1> .`,
      [`${SHARED_OUT}e1`]: grantEvent,
    },
  });
  _setStorageRootForTesting(WEBID, ROOT);
  _setSessionForTesting(fake.session);
  const { wrapper } = makeSpyWrapper();
  try {
    const { result } = renderHook(() => useWriteEnergyYear(), { wrapper });
    await result.current.mutateAsync({
      fileUri: B,
      subjectUri: `${B}#b1`,
      dataset: {
        building: `${B}#b1`,
        year: 2024,
        granularity: "P1Y",
        scenario: "actual",
        metrics: { electricityConsumption: 1000 },
      },
    });
    const dsAcl = fake.store[`${B.replace(/\.ttl$/, "")}/energy/2024-P1Y.ttl.acl`];
    assert.ok(dsAcl?.includes(BOB), "the new dataset's .acl grants the recipient");
    assert.ok(
      !fake.calls.some((c) => c.method === "POST" && c.url === SHARED_OUT),
      "record-free: no new shared-out/ event",
    );
  } finally {
    _setSessionForTesting(null);
  }
});

Deno.test("useShareBuilding invalidates ONLY the shared-out log (not buildings)", async () => {
  // The invalidation contract fires in onSettled — also on failure, which keeps
  // this test independent of the share flow's many round-trips.
  const fake = makeFakeSession({
    webId: WEBID,
    respond: () => new Response("boom", { status: 500 }),
  });
  _setStorageRootForTesting(WEBID, "https://pod.example/");
  _setSessionForTesting(fake.session);
  const { wrapper, invalidated } = makeSpyWrapper();
  try {
    const { result } = renderHook(() => useShareBuilding(), { wrapper });
    await result.current.mutateAsync({
      buildingUri: "https://pod.example/granergize/buildings/b1.ttl",
      recipients: ["https://bob.example/profile/card#me"],
      includeEnergyData: true,
    }).catch(() => {});
    assert.ok(invalidated.includes("sharedOutLog"), "sharedOutLog invalidated");
    assert.ok(
      !invalidated.includes("buildings"),
      "a share does not reload the buildings",
    );
  } finally {
    _setSessionForTesting(null);
  }
});

Deno.test("useRefreshView and useDeleteView invalidate viewDetail (the standalone page reads through it)", async () => {
  const fake = makeFakeSession({
    webId: WEBID,
    respond: () => new Response("boom", { status: 500 }),
  });
  _setStorageRootForTesting(WEBID, "https://pod.example/");
  _setSessionForTesting(fake.session);
  const refresh = makeSpyWrapper();
  const del = makeSpyWrapper();
  try {
    const { result: refreshView } = renderHook(() => useRefreshView(), {
      wrapper: refresh.wrapper,
    });
    await refreshView.current.mutateAsync("v1").catch(() => {});
    assert.ok(refresh.invalidated.includes("viewDefinitions"));
    assert.ok(refresh.invalidated.includes("viewDetail"));

    const { result: deleteView } = renderHook(() => useDeleteView(), {
      wrapper: del.wrapper,
    });
    await deleteView.current.mutateAsync("v1").catch(() => {});
    assert.ok(del.invalidated.includes("viewDetail"));
    assert.ok(del.invalidated.includes("sharedOutLog"));
  } finally {
    _setSessionForTesting(null);
  }
});

Deno.test("useCreateView invalidates viewDefinitions; useSaveOrganization the resolved-agent caches", async () => {
  const fake = makeFakeSession({
    webId: WEBID,
    respond: () => new Response("boom", { status: 500 }),
  });
  _setStorageRootForTesting(WEBID, "https://pod.example/");
  _setSessionForTesting(fake.session);
  const view = makeSpyWrapper();
  const org = makeSpyWrapper();
  try {
    const { result: createView } = renderHook(() => useCreateView(), {
      wrapper: view.wrapper,
    });
    await createView.current.mutateAsync({
      name: "v",
      buildingUris: ["https://pod.example/granergize/buildings/b1.ttl#b1"],
      aggregationType: "average",
      metrics: ["electricityConsumption"],
    }).catch(() => {});
    assert.ok(view.invalidated.includes("viewDefinitions"));

    const { result: saveOrg } = renderHook(() => useSaveOrganization(), {
      wrapper: org.wrapper,
    });
    await saveOrg.current.mutateAsync({ org: { name: "ACME" } }).catch(() => {});
    assert.ok(org.invalidated.includes("agent"), "agent cache invalidated");
    assert.ok(org.invalidated.includes("agentLogo"), "agentLogo cache invalidated");
  } finally {
    _setSessionForTesting(null);
  }
});

Deno.test("useUploadBuildings: a cancelled run resolves as an OUTCOME (aborted, partial adds kept)", async () => {
  const fake = makeFakeSession({ webId: WEBID });
  _setStorageRootForTesting(WEBID, "https://pod.example/");
  _setSessionForTesting(fake.session);
  const { wrapper } = makeSpyWrapper();
  const controller = new AbortController();
  controller.abort();
  try {
    const { result } = renderHook(() => useUploadBuildings(), { wrapper });
    const outcome = await result.current.mutateAsync({
      buildings: [{ streetAddress: "X" }],
      lastgangReadings: null,
      signal: controller.signal,
      onProgress: () => {},
    });
    assert.deepEqual(outcome, { added: [], aborted: true });
  } finally {
    _setSessionForTesting(null);
  }
});

Deno.test("central mutation-error wiring: meta.silent suppresses the toast, meta.action shapes it", async () => {
  // The same MutationCache wiring QueryProvider installs, with the notification
  // sink spied — so the meta declared on the REAL hooks is what's exercised.
  const fake = makeFakeSession({
    webId: WEBID,
    respond: () => new Response("boom", { status: 500 }),
  });
  _setStorageRootForTesting(WEBID, "https://pod.example/");
  _setSessionForTesting(fake.session);
  const notifications: string[] = [];
  const client = new QueryClient({
    mutationCache: new MutationCache({
      onError: (error, _v, _c, mutation) => {
        const note = classifyMutationError(error, mutation.meta);
        if (note) notifications.push(note.message);
      },
    }),
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children);
  try {
    // Silent hook (inline-Alert dialog): no toast despite the failure.
    const { result: share } = renderHook(() => useShareBuilding(), { wrapper });
    await share.current.mutateAsync({
      buildingUri: "https://pod.example/granergize/buildings/b1.ttl",
      recipients: ["https://bob.example/profile/card#me"],
      includeEnergyData: false,
    }).catch(() => {});
    assert.deepEqual(notifications, [], "silent mutation produced no toast");

    // Action-labelled hook: the standard phrasing.
    const { result: update } = renderHook(() => useUpdateBuilding(), { wrapper });
    await update.current.mutateAsync({
      fileUri: "https://pod.example/granergize/buildings/b1.ttl",
      subjectUri: "https://pod.example/granergize/buildings/b1.ttl#b1",
      fields: { streetAddress: "X" },
    }).catch(() => {});
    assert.equal(notifications.length, 1);
    assert.match(notifications[0], /^Failed to update the building: /);
  } finally {
    _setSessionForTesting(null);
  }
});
