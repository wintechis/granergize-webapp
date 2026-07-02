/// <reference lib="deno.ns" />
import { type PodGateway, sessionGateway } from "../../../services/pod/podGateway.ts";
//
// Tier-1 proof that the AddBookmark core is callable HEADLESS, and — the rooms
// silent-break-mode guard — that it returns EXACTLY `{ room }` (the normalized
// container URI) the adapter's `patchRooms(qc, reg => …)` `onSuccess({ room })`
// patch consumes. The `roomExists` existence throw stays IN the core.
import { strict as assert } from "node:assert";
import type { Session } from "@inrupt/solid-client-authn-browser";
import { addBookmarkCore } from "./AddBookmark.ts";
import { _setStorageRootForTesting } from "../../../services/pod/solidUtils.ts";

const OWNER = "https://a.example/profile/card#me";
const ROOM = "https://a.example/granergize/rooms/r-1/";
const MISSING = "https://a.example/granergize/rooms/nope/";

/**
 * Permissive fake one-Pod world: every container-like GET resolves 200 and
 * writes succeed; the `existing` room reads 200 (exists), `MISSING` reads 404
 * (does not exist → the core throws).
 */
function roomPod(opts: { exists: boolean }): {
  session: PodGateway;
  calls: { url: string; method: string }[];
} {
  _setStorageRootForTesting(OWNER, "https://a.example/");
  const store: Record<string, string> = {};
  const calls: { url: string; method: string }[] = [];
  const fetch = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = (typeof input === "string" ? input : input.toString()).split("?")[0];
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({ url, method });
    if (method === "PUT" || method === "POST") {
      if (init?.body != null) store[url] = String(init.body);
      return Promise.resolve(new Response("", { status: 201 }));
    }
    if (!opts.exists && url === MISSING) {
      return Promise.resolve(new Response("Not found", { status: 404 }));
    }
    const body = store[url];
    if (body !== undefined) {
      return Promise.resolve(
        new Response(body, { status: 200, headers: { "Content-Type": "text/turtle" } }),
      );
    }
    return Promise.resolve(
      new Response("", { status: 200, headers: { "Content-Type": "text/turtle" } }),
    );
  };
  return { session: sessionGateway({ info: { isLoggedIn: true, webId: OWNER }, fetch } as unknown as Session), calls };
}

Deno.test("addBookmarkCore (headless): existing room → returns { room } = the normalized container URI", async () => {
  const { session, calls } = roomPod({ exists: true });

  const outcome = await addBookmarkCore(session, { input: ROOM });

  // EXACT shape the adapter's onSuccess({ room }) patch consumes.
  assert.deepEqual(outcome, { room: ROOM });
  // The bookmark file was written (addKnownRoom committed).
  assert.ok(calls.some((c) => c.method === "PUT"), "bookmarks.ttl written");
});

Deno.test("addBookmarkCore (headless): roomExists false → the core throws (no patch reaches the adapter)", async () => {
  const { session, calls } = roomPod({ exists: false });

  await assert.rejects(
    () => addBookmarkCore(session, { input: MISSING }),
    /not reachable/i,
  );
  // No bookmark write happened — the throw precedes addKnownRoom.
  assert.ok(!calls.some((c) => c.method === "PUT"), "no bookmark write on a missing room");
});
