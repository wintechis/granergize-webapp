/// <reference lib="deno.ns" />
import "./test-dom-setup.ts"; // must precede React / Testing Library
import { strict as assert } from "node:assert";
import * as React from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Session } from "@inrupt/solid-client-authn-browser";
import { useRoomState } from "./queries.ts";
import { useEnterRoom } from "./mutations.ts";
import { _setSessionForTesting } from "./session.ts";
import { _setStorageRootForTesting } from "../services/pod/solidUtils.ts";

const GRAN = "https://solid.ti.rw.fau.de/gra/vocab.ttl#";
const WEBID = "https://pod.example/profile/card#me";
const ROOT = "https://pod.example/";
const PREFS = "https://pod.example/granergize/prefs.ttl";
const BOOKMARKS = "https://pod.example/granergize/bookmarks.ttl";
const A = "https://pod.example/granergize/rooms/aaaa/";
const B = "https://pod.example/granergize/rooms/bbbb/";

/**
 * A session whose `prefs.ttl` GET ALWAYS reports `currentRoom=B` — i.e. the
 * read is permanently stale (it never reflects writes). This is the
 * solidcommunity.net read-after-write failure mode in the extreme. If the room
 * state depended on reading `current` back, a switch to A would revert to B.
 * Room containers return an empty event log; writes (PUT/POST) are accepted but
 * ignored (so the GET stays stale).
 */
function staleSession(): Session {
  const prefs = (current: string) =>
    `<${PREFS}> <${GRAN}currentRoom> <${current}> .`;
  const bookmarks = `<${BOOKMARKS}> <${GRAN}knownRoom> <${A}>, <${B}> .`;
  const fetch = (input: string | URL, init?: RequestInit): Promise<Response> => {
    const url = (typeof input === "string" ? input : input.toString())
      .split("?")[0];
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "POST") {
      return Promise.resolve(
        new Response(null, { status: 201, headers: { Location: `${url}e1` } }),
      );
    }
    if (method === "PUT" || method === "DELETE") {
      return Promise.resolve(new Response(null, { status: 201 }));
    }
    // GET
    if (url === PREFS) {
      return Promise.resolve(
        new Response(prefs(B), {
          status: 200,
          headers: { "Content-Type": "text/turtle" },
        }),
      );
    }
    if (url === BOOKMARKS) {
      return Promise.resolve(
        new Response(bookmarks, {
          status: 200,
          headers: { "Content-Type": "text/turtle" },
        }),
      );
    }
    // Room containers (and anything else) → reachable, empty event log.
    return Promise.resolve(
      new Response("", {
        status: 200,
        headers: { "Content-Type": "text/turtle" },
      }),
    );
  };
  return { info: { webId: WEBID, isLoggedIn: true }, fetch } as unknown as Session;
}

function wrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children);
}

Deno.test("entering a room sets current optimistically and a stale registry read can't revert it", async () => {
  _setStorageRootForTesting(WEBID, ROOT);
  _setSessionForTesting(staleSession());

  const { result } = renderHook(
    () => ({ state: useRoomState(), enter: useEnterRoom() }),
    { wrapper: wrapper() },
  );

  // Initial load reflects the (stale) server pointer: current = B.
  await waitFor(() => assert.equal(result.current.state.data?.current, B));

  // Switch to A. enterRoom writes current=A, but every GET still reports B.
  await act(async () => {
    await result.current.enter.mutateAsync(A);
  });

  // The UI must show A as current — proving it came from the authoritative
  // optimistic cache update, NOT a read-back (which would have reverted to B).
  await waitFor(() => assert.equal(result.current.state.data?.current, A));
  assert.equal(result.current.state.data?.current, A);
});

/**
 * A session with NO active room: prefs declares no currentRoom, so the room log
 * query is disabled and `log.data` stays undefined.
 */
function emptyRoomSession(): Session {
  const fetch = (_input: string | URL, init?: RequestInit): Promise<Response> => {
    const method = (init?.method ?? "GET").toUpperCase();
    if (method !== "GET") return Promise.resolve(new Response(null, { status: 201 }));
    // prefs / bookmarks / everything → empty: no current room, no known rooms.
    return Promise.resolve(
      new Response("", { status: 200, headers: { "Content-Type": "text/turtle" } }),
    );
  };
  return { info: { webId: WEBID, isLoggedIn: true }, fetch } as unknown as Session;
}

Deno.test("useRoomState: with no active room, myRoles keeps a STABLE reference across renders", async () => {
  // Regression: a fresh `[]` per render made ConnectPage's role-sync effect (which
  // lists `myRoles` as a dependency) re-run every render → "Maximum update depth
  // exceeded" on a brand-new / no-room login. The fallback must be one shared ref.
  _setStorageRootForTesting(WEBID, ROOT);
  _setSessionForTesting(emptyRoomSession());

  const { result, rerender } = renderHook(() => useRoomState(), {
    wrapper: wrapper(),
  });

  // No current room, but data is present (the registry resolved).
  await waitFor(() => assert.equal(result.current.data?.current, null));
  const first = result.current.data?.myRoles;
  assert.deepEqual(first, []);

  rerender();
  rerender();
  assert.strictEqual(
    result.current.data?.myRoles,
    first,
    "myRoles must be the SAME reference across renders, else ConnectPage's effect loops",
  );
});
