/// <reference lib="deno.ns" />
import { assert, assertEquals, assertRejects } from "jsr:@std/assert";
import { FakeTime } from "jsr:@std/testing/time";
import { Session } from "@inrupt/solid-client-authn-browser";
import {
  addKnownRoom,
  createRoom,
  deleteRoom,
  enterRoom,
  exitRoom,
  extractRoomUrl,
  getCurrentRoom,
  getKnownRooms,
  getMembers,
  getMembersByRole,
  getMyMembership,
  getMyRole,
  joinRoom,
  leaveRoom,
  normalizeRoomUrl,
  openRoom,
  ownsRoom,
  removeKnownRoom,
  roomExists,
  setMyRole,
} from "./dataRoom.ts";
import { _setStorageRootForTesting } from "../utils/solidUtils.ts";

const ALICE = "https://alice.example/profile/card#me";
/** A room URL all the room-scoped tests operate on. */
const ROOM = "https://room.example/granergize/rooms/r1/";
const BOB = "https://bob.example/profile/card#me";

/**
 * Minimal in-memory stand-in for a Solid Pod's LDP behavior, exercising the
 * exact operations dataRoom.ts relies on: GET a resource, GET a container
 * (ldp:contains listing), PUT to create a container, and POST to append a child
 * resource (server mints the URL). No network.
 */
class FakePod {
  readonly containers = new Set<string>();
  readonly resources = new Map<string, string>();
  private counter = 0;
  /** ETag per resource (bumped on every PUT) — lets readModifyWrite use If-Match. */
  private etags = new Map<string, string>();
  private etagSeq = 0;
  /** Conditional headers seen on each PUT, for asserting optimistic locking. */
  readonly puts: { url: string; ifMatch: string | null }[] = [];

  private etagFor(url: string): string {
    let e = this.etags.get(url);
    if (!e) {
      e = `etag-${++this.etagSeq}`;
      this.etags.set(url, e);
    }
    return e;
  }

  fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = input.toString().split("?")[0];
    const method = init?.method ?? "GET";
    const turtle = { "Content-Type": "text/turtle" };

    if (method === "GET") {
      if (url.endsWith("/")) {
        if (!this.containers.has(url)) return this.res("", 404);
        // Direct children: resources and sub-containers one level down, minus
        // auxiliary .acl resources (Solid doesn't ldp:contains those).
        const isChild = (k: string) => {
          if (!k.startsWith(url) || k === url || k.endsWith(".acl")) return false;
          const rest = k.slice(url.length).replace(/\/$/, "");
          return rest.length > 0 && !rest.includes("/");
        };
        const children = [
          ...new Set(
            [...this.resources.keys(), ...this.containers].filter(isChild),
          ),
        ];
        const body = children
          .map((c) => `<${url}> <http://www.w3.org/ns/ldp#contains> <${c}> .`)
          .join("\n");
        return this.res(body, 200, turtle);
      }
      const body = this.resources.get(url);
      return body === undefined
        ? this.res("", 404)
        : this.res(body, 200, { ...turtle, ETag: this.etagFor(url) });
    }

    if (method === "PUT") {
      if (url.endsWith("/")) {
        this.containers.add(url);
      } else {
        this.resources.set(url, String(init?.body ?? ""));
        this.etags.set(url, `etag-${++this.etagSeq}`); // bump on every write
      }
      this.puts.push({
        url,
        ifMatch: new Headers(init?.headers).get("If-Match"),
      });
      this.addAncestors(url);
      return this.res("", 201);
    }

    if (method === "POST") {
      // Append a child; the server assigns its URL (as Solid does).
      this.containers.add(url);
      this.addAncestors(url);
      const child = `${url}evt-${++this.counter}`;
      this.resources.set(child, String(init?.body ?? ""));
      return this.res("", 201, { Location: child });
    }

    if (method === "DELETE") {
      if (url.endsWith("/")) this.containers.delete(url);
      else this.resources.delete(url);
      return this.res("", 205);
    }

    return this.res("", 405);
  };

  /** Register every ancestor container (Solid auto-creates parents on write). */
  private addAncestors(url: string): void {
    for (
      let i = url.indexOf("/", url.indexOf("://") + 3);
      i !== -1;
      i = url.indexOf("/", i + 1)
    ) {
      if (i + 1 < url.length) this.containers.add(url.slice(0, i + 1));
    }
  }

  private res(body: string, status: number, headers?: HeadersInit): Promise<Response> {
    return Promise.resolve(new Response(body || null, { status, headers }));
  }
}

/** A fake authenticated Session backed by the in-memory Pod. */
function sessionFor(pod: FakePod, webId: string): Session {
  // Storage root is normally resolved from pim:storage at login; prime it from the
  // WebID origin (matches these fixtures' `<origin>/granergize/…` paths).
  _setStorageRootForTesting(webId, new URL(webId).origin + "/");
  return {
    info: { isLoggedIn: true, webId },
    fetch: pod.fetch,
  } as unknown as Session;
}

Deno.test("setMyRole persists, getMyRole reads it back (regression)", async () => {
  const time = new FakeTime(new Date("2026-05-29T10:00:00Z"));
  try {
    const pod = new FakePod();
    const session = sessionFor(pod, ALICE);

    await setMyRole(ROOM, ["investor"], session);

    // The assignment is recorded as a child resource in the container.
    assertEquals(pod.resources.size, 1);
    assertEquals(await getMyRole(ROOM, session), ["investor"]);
  } finally {
    time.restore();
  }
});

Deno.test("concurrent saves by different members don't clobber (race fix)", async () => {
  const time = new FakeTime(new Date("2026-05-29T10:00:00Z"));
  try {
    const pod = new FakePod();
    await joinRoom(ROOM, sessionFor(pod, ALICE));
    await setMyRole(ROOM, ["investor"], sessionFor(pod, ALICE));
    time.tick(1000);
    await joinRoom(ROOM, sessionFor(pod, BOB));
    await setMyRole(ROOM, ["user"], sessionFor(pod, BOB));

    const members = await getMembers(ROOM, sessionFor(pod, ALICE));
    const byWebId = Object.fromEntries(members.map((m) => [m.webId, m.roles]));
    assertEquals(byWebId[ALICE], ["investor"]);
    assertEquals(byWebId[BOB], ["user"]);
    assertEquals(members.length, 2);
  } finally {
    time.restore();
  }
});

Deno.test("reassigning replaces roles; log keeps every event (append-only)", async () => {
  const time = new FakeTime(new Date("2026-05-29T10:00:00Z"));
  try {
    const pod = new FakePod();
    const session = sessionFor(pod, ALICE);

    await setMyRole(ROOM, ["investor"], session);
    time.tick(1000);
    await setMyRole(ROOM, ["user"], session);

    assertEquals(await getMyRole(ROOM, session), ["user"]); // latest event wins
    assertEquals(pod.resources.size, 2); // both events retained
  } finally {
    time.restore();
  }
});

Deno.test("clearing roles keeps membership (independent axes)", async () => {
  const time = new FakeTime(new Date("2026-05-29T10:00:00Z"));
  try {
    const pod = new FakePod();
    const session = sessionFor(pod, ALICE);

    await joinRoom(ROOM, session);
    await setMyRole(ROOM, ["investor", "user"], session);
    time.tick(1000);
    assertEquals(
      (await getMyRole(ROOM, session)).slice().sort(),
      ["investor", "user"],
    );

    await setMyRole(ROOM, [], session); // clear roles — but DON'T leave
    assertEquals(await getMyRole(ROOM, session), []);
    // Still a member, now with no role.
    assertEquals(await getMyMembership(ROOM, session), true);
    assertEquals(await getMembers(ROOM, session), [{ webId: ALICE, roles: [] }]);
  } finally {
    time.restore();
  }
});

Deno.test("join then leave toggles membership", async () => {
  const time = new FakeTime(new Date("2026-05-29T10:00:00Z"));
  try {
    const pod = new FakePod();
    const session = sessionFor(pod, ALICE);

    await joinRoom(ROOM, session);
    assertEquals(await getMyMembership(ROOM, session), true);
    assertEquals(await getMembers(ROOM, session), [{ webId: ALICE, roles: [] }]);

    time.tick(1000);
    await leaveRoom(ROOM, session);
    assertEquals(await getMyMembership(ROOM, session), false);
    assertEquals(await getMembers(ROOM, session), []);
  } finally {
    time.restore();
  }
});

Deno.test("assigning a role without joining does not make you a member", async () => {
  const pod = new FakePod();
  const session = sessionFor(pod, ALICE);

  await setMyRole(ROOM, ["investor"], session); // role only, never joined
  assertEquals(await getMyRole(ROOM, session), ["investor"]); // role recorded
  assertEquals(await getMyMembership(ROOM, session), false); // but not a member
  assertEquals(await getMembers(ROOM, session), []); // explicit re-join required
});

Deno.test("getMembersByRole resolves a role to its holders' WebIDs, excluding yourself", async () => {
  const time = new FakeTime(new Date("2026-05-29T10:00:00Z"));
  try {
    const pod = new FakePod();
    await joinRoom(ROOM, sessionFor(pod, ALICE));
    await setMyRole(ROOM, ["investor"], sessionFor(pod, ALICE));
    time.tick(1000);
    await joinRoom(ROOM, sessionFor(pod, BOB));
    await setMyRole(ROOM, ["user", "investor"], sessionFor(pod, BOB));

    // You can't share a resource to yourself, so the logged-in user is filtered
    // out of role resolution — a self-grant would write a recipient auth carrying
    // the owner's own acl:agent, which a later revoke then strips along with the
    // owner's control block (Tier-4 meisdata owner-lockout). So even though both
    // ALICE and BOB hold "investor", ALICE's session never sees ALICE.
    const alice = sessionFor(pod, ALICE);
    assertEquals(await getMembersByRole(ROOM, "user", alice), [BOB]);
    assertEquals(await getMembersByRole(ROOM, "investor", alice), [BOB]);
    // Symmetric: from BOB's session, "investor" resolves to ALICE (BOB excised).
    assertEquals(
      await getMembersByRole(ROOM, "investor", sessionFor(pod, BOB)),
      [ALICE],
    );
    assertEquals(
      await getMembersByRole(ROOM, "benchmark_service_provider", alice),
      [],
    );
  } finally {
    time.restore();
  }
});

Deno.test("read functions short-circuit when no room is selected", async () => {
  const pod = new FakePod();
  const session = sessionFor(pod, ALICE);
  assertEquals(await getMembers(null, session), []);
  assertEquals(await getMyRole(null, session), []);
  assertEquals(await getMyMembership(null, session), false);
});

Deno.test("empty / missing container yields no members", async () => {
  const pod = new FakePod();
  const session = sessionFor(pod, ALICE);
  assertEquals(await getMembers(ROOM, session), []); // container 404s
  assertEquals(await getMyRole(ROOM, session), []);
});

Deno.test("normalizeRoomUrl guarantees a trailing slash", () => {
  assertEquals(normalizeRoomUrl("https://x.example/room"), "https://x.example/room/");
  assertEquals(normalizeRoomUrl("https://x.example/room/"), "https://x.example/room/");
});

Deno.test("createRoom creates a container on the user's Pod and grants append", async () => {
  const pod = new FakePod();
  const session = sessionFor(pod, ALICE);

  const roomUrl = await createRoom(session);

  // Lives on the creator's own Pod, as an LDP container.
  assertEquals(roomUrl.startsWith("https://alice.example/granergize/rooms/"), true);
  assertEquals(roomUrl.endsWith("/"), true);
  assertEquals(pod.containers.has(roomUrl), true);

  // An ACL was written granting authenticated agents append access (full-IRI
  // triples, matching the app's other ACL writers).
  const acl = pod.resources.get(`${roomUrl}.acl`);
  assertEquals(typeof acl, "string");
  assertEquals(acl!.includes("auth/acl#Append"), true);
  assertEquals(acl!.includes("auth/acl#AuthenticatedAgent"), true);
  assertEquals(acl!.includes(ALICE), true); // owner authorization

  // The creator is auto-joined as a member.
  assertEquals(await getMyMembership(roomUrl, session), true);
});

Deno.test("roomExists reports whether a room URL is reachable", async () => {
  const pod = new FakePod();
  const session = sessionFor(pod, ALICE);

  const roomUrl = await createRoom(session);
  assertEquals(await roomExists(roomUrl, session), true);
  assertEquals(
    await roomExists("https://alice.example/granergize/rooms/nope/", session),
    false,
  );
});

Deno.test("extractRoomUrl parses raw URIs and app invite links", () => {
  const room = "https://alice.example/granergize/rooms/r1/";
  // Raw URI without trailing slash is normalized.
  assertEquals(
    extractRoomUrl("https://alice.example/granergize/rooms/r1"),
    room,
  );
  // An invite link (#/room/<encoded>) yields the decoded container URL.
  const link = `https://app.example/granergize/#/room/${
    encodeURIComponent(room)
  }`;
  assertEquals(extractRoomUrl(link), room);
});

Deno.test("openRoom validates, joins, and reports reachability", async () => {
  const pod = new FakePod();
  const roomUrl = await createRoom(sessionFor(pod, ALICE)); // ALICE auto-joins

  const bob = sessionFor(pod, BOB);
  assertEquals(await getMyMembership(roomUrl, bob), false);
  assertEquals(await openRoom(roomUrl, bob), true); // opening joins
  assertEquals(await getMyMembership(roomUrl, bob), true);

  // Unreachable room → false.
  assertEquals(
    await openRoom("https://alice.example/granergize/rooms/none/", bob),
    false,
  );
});

Deno.test("ownsRoom is true only for rooms under the user's own storage", () => {
  const pod = new FakePod();
  const alice = sessionFor(pod, ALICE);
  assertEquals(ownsRoom("https://alice.example/granergize/rooms/r1/", alice), true);
  assertEquals(ownsRoom("https://bob.example/granergize/rooms/r1/", alice), false);
});

Deno.test("deleteRoom removes the room's events and container", async () => {
  const pod = new FakePod();
  const session = sessionFor(pod, ALICE);
  const roomUrl = await createRoom(session); // creates container + ACL + a join event

  assertEquals(await roomExists(roomUrl, session), true);
  await deleteRoom(roomUrl, session);

  assertEquals(await roomExists(roomUrl, session), false); // container gone
  assertEquals(pod.containers.has(roomUrl), false);
  // No event children of the room remain.
  assertEquals(
    [...pod.resources.keys()].some((k) => k.startsWith(roomUrl)),
    false,
  );
});

Deno.test("createRoom bookmarks the room and makes it current (single membership)", async () => {
  const time = new FakeTime(new Date("2026-05-29T10:00:00Z"));
  try {
    const pod = new FakePod();
    const session = sessionFor(pod, ALICE);

    const a = await createRoom(session);
    assertEquals(await getCurrentRoom(session), a);
    assertEquals(await getKnownRooms(session), [a]);
    assertEquals(await getMyMembership(a, session), true);

    // Creating a second room enters it and LEAVES the first (single membership),
    // but both stay bookmarked.
    time.tick(1000);
    const b = await createRoom(session);
    assertEquals(await getCurrentRoom(session), b);
    assertEquals((await getKnownRooms(session)).slice().sort(), [a, b].sort());
    assertEquals(await getMyMembership(b, session), true);
    assertEquals(await getMyMembership(a, session), false); // left on entering b
  } finally {
    time.restore();
  }
});

Deno.test("switching the active room rewrites the current-room pointer conditionally (If-Match)", async () => {
  const pod = new FakePod();
  const session = sessionFor(pod, ALICE);
  const prefs = new URL(ALICE).origin + "/granergize/prefs.ttl";

  const a = await createRoom(session); // prefs created, current = a
  const b = await createRoom(session); // hosting b leaves a → current = b
  assertEquals(await getCurrentRoom(session), b);

  pod.puts.length = 0; // watch only the switch
  await enterRoom(a, session); // switch the active room back to a

  assertEquals(await getCurrentRoom(session), a, "the switch took effect");
  const regPuts = pod.puts.filter((p) => p.url === prefs);
  assert(regPuts.length > 0, "the switch rewrote the current-room pointer");
  assert(
    regPuts.every((p) => p.ifMatch !== null),
    "every prefs PUT is guarded by If-Match (optimistic locking), so a " +
      "concurrent enter/leave can't silently revert the switch",
  );
});

Deno.test("addKnownRoom bookmarks without joining; enterRoom joins", async () => {
  const pod = new FakePod();
  const aliceRoom = await createRoom(sessionFor(pod, ALICE));
  const bob = sessionFor(pod, BOB);

  await addKnownRoom(aliceRoom, bob); // bookmark only
  assertEquals(await getKnownRooms(bob), [aliceRoom]);
  assertEquals(await getCurrentRoom(bob), null); // not entered
  assertEquals(await getMyMembership(aliceRoom, bob), false); // not a member

  await enterRoom(aliceRoom, bob); // now join
  assertEquals(await getCurrentRoom(bob), aliceRoom);
  assertEquals(await getMyMembership(aliceRoom, bob), true);
});

Deno.test("leaving keeps the bookmark; removeKnownRoom forgets it", async () => {
  const time = new FakeTime(new Date("2026-05-29T10:00:00Z"));
  try {
    const pod = new FakePod();
    const session = sessionFor(pod, ALICE);
    const a = await createRoom(session);

    time.tick(1000);
    await exitRoom(a, session);
    assertEquals(await getCurrentRoom(session), null); // no longer in a room
    assertEquals(await getMyMembership(a, session), false);
    assertEquals(await getKnownRooms(session), [a]); // bookmark stays

    await removeKnownRoom(a, session);
    assertEquals(await getKnownRooms(session), []);
  } finally {
    time.restore();
  }
});

Deno.test("a forbidden write surfaces a permission error, not a raw 403", async () => {
  // Container reads succeed, but the user lacks append access (POST → 403).
  const session = {
    info: { isLoggedIn: true, webId: ALICE },
    fetch: (_input: RequestInfo | URL, init?: RequestInit) =>
      Promise.resolve(
        new Response("", {
          status: (init?.method ?? "GET") === "POST" ? 403 : 200,
          headers: { "Content-Type": "text/turtle" },
        }),
      ),
  } as unknown as Session;

  await assertRejects(() => joinRoom(ROOM, session), Error, "permission");
});
