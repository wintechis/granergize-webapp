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
  useExitRoom,
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
  const b1 = { id: 1, uri: B1 } as unknown as BuildingType;
  const b2 = { id: 2, uri: B2 } as unknown as BuildingType;
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
