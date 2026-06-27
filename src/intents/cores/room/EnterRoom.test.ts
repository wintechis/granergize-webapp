/// <reference lib="deno.ns" />
import { type PodGateway, sessionGateway } from "../../../services/pod/podGateway.ts";
//
// Tier-1 proof that the EnterRoom core is callable HEADLESS, and — the rooms
// silent-break-mode guard — that it returns EXACTLY `{ room }` (the normalized
// container URI) the adapter's `patchRooms(qc, reg => …)` `onSuccess({ room })`
// patch consumes. A core returning a bare string (or a non-normalized URI) would
// corrupt the registry cache with NO Tier-1 catching it (the query cache is
// browser-only) — so this asserts the exact shape.
import { strict as assert } from "node:assert";
import type { Session } from "@inrupt/solid-client-authn-browser";
import { enterRoomCore } from "./EnterRoom.ts";
import { resetActiveRoom } from "../../../services/interop/dataRoom.ts";
import { _setStorageRootForTesting } from "../../../services/pod/solidUtils.ts";

const OWNER = "https://a.example/profile/card#me";
const ROOM = "https://a.example/granergize/rooms/r-1/";
const UNREACHABLE = "https://a.example/granergize/rooms/nope/";

/**
 * Permissive fake one-Pod world: every container-like GET (trailing "/") and
 * stored resource resolves 200; PUT/POST succeed; `unreachable` is forced 404 so
 * the reachability check fails. Mirrors the shareBuilding fixture shape.
 */
function roomPod(opts: { reachable: boolean } = { reachable: true }): {
  session: PodGateway;
  calls: { url: string; method: string }[];
} {
  _setStorageRootForTesting(OWNER, "https://a.example/");
  resetActiveRoom();
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
    if (method === "DELETE") return Promise.resolve(new Response("", { status: 205 }));
    // The unreachable room container 404s — the reachability check fails.
    if (!opts.reachable && url === UNREACHABLE) {
      return Promise.resolve(new Response("Not found", { status: 404 }));
    }
    const body = store[url];
    if (body !== undefined) {
      return Promise.resolve(
        new Response(body, { status: 200, headers: { "Content-Type": "text/turtle" } }),
      );
    }
    // Container-like / unknown reads resolve empty-200 (a bare/empty Pod).
    if (url.endsWith("/")) {
      return Promise.resolve(
        new Response("", { status: 200, headers: { "Content-Type": "text/turtle" } }),
      );
    }
    return Promise.resolve(
      new Response("", { status: 200, headers: { "Content-Type": "text/turtle" } }),
    );
  };
  return { session: sessionGateway({ info: { isLoggedIn: true, webId: OWNER }, fetch } as unknown as Session), calls };
}

Deno.test("enterRoomCore (headless): reachable → returns { room } = the normalized container URI", async () => {
  const { session } = roomPod({ reachable: true });

  const outcome = await enterRoomCore(session, { roomUri: ROOM });

  // EXACT shape the adapter's onSuccess({ room }) patch consumes: { room } with
  // the normalized (trailing-slash) container URI — never a bare string.
  assert.deepEqual(outcome, { room: ROOM });
  assert.equal(typeof outcome.room, "string");
});

Deno.test("enterRoomCore (headless): normalizes a slash-less invite URI to { room }", async () => {
  const { session } = roomPod({ reachable: true });

  // An invite link wrapping the slash-less room URI resolves to the normalized
  // container — the reachability + normalization stay IN the core.
  const outcome = await enterRoomCore(session, {
    roomUri: `https://a.example/granergize/room?uri=${encodeURIComponent(ROOM.slice(0, -1))}`,
  });

  assert.deepEqual(outcome, { room: ROOM });
});

Deno.test("enterRoomCore (headless): unreachable → the core throws (no patch reaches the adapter)", async () => {
  const { session } = roomPod({ reachable: false });

  await assert.rejects(
    () => enterRoomCore(session, { roomUri: UNREACHABLE }),
    /not reachable/i,
  );
});
