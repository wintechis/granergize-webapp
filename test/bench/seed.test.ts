/// <reference lib="deno.ns" />
/**
 * Tier-1 unit test for the room-seeding helper (offline, no CSS/network). The
 * benchmark's D4 dimension scales the data-room read fold + delete against the
 * number of members in the log; `seedRoomMembers` is what fabricates that axis by
 * POSTing synthetic `as:Join` events (the room's own mutations only ever act as a
 * single WebID, so they can't grow a multi-member room). This pins the round-trip:
 * what the helper writes must be exactly what the real fold (`getMembers`) reads
 * back — N distinct events ⇒ N members — so the benchmark times a faithful log.
 */
import { strict as assert } from "node:assert";
import type { Session } from "@inrupt/solid-client-authn-browser";
import { seedRoomMembers, seedRoomRoleChurn } from "./seed.ts";
import { getMembers } from "../../src/services/interop/dataRoom.ts";

const ROOM = "https://alice.example/granergize/rooms/r1/";

/**
 * Minimal in-memory LDP Pod covering exactly what the seed→fold round-trip needs:
 * GET a container (ldp:contains listing), GET a resource, PUT to create a
 * container, and POST to append a child (server mints the URL). Query strings are
 * stripped so a cache-busting read hits the same key.
 */
class FakePod {
  readonly containers = new Set<string>();
  readonly resources = new Map<string, string>();
  private counter = 0;

  fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = input.toString().split("?")[0];
    const method = init?.method ?? "GET";
    const turtle = { "Content-Type": "text/turtle" };

    if (method === "GET") {
      if (url.endsWith("/")) {
        if (!this.containers.has(url)) return this.res("", 404);
        const children = [...this.resources.keys()].filter((k) =>
          k.startsWith(url) && k !== url && !k.slice(url.length).includes("/")
        );
        const body = children
          .map((c) => `<${url}> <http://www.w3.org/ns/ldp#contains> <${c}> .`)
          .join("\n");
        return this.res(body, 200, turtle);
      }
      const body = this.resources.get(url);
      return body === undefined ? this.res("", 404) : this.res(body, 200, turtle);
    }
    if (method === "PUT") {
      this.containers.add(url);
      return this.res("", 201);
    }
    if (method === "POST") {
      const child = `${url}evt-${++this.counter}`;
      this.resources.set(child, String(init?.body ?? ""));
      return this.res("", 201, { Location: child });
    }
    return this.res("", 405);
  };

  private res(body: string, status: number, headers?: HeadersInit): Promise<Response> {
    return Promise.resolve(new Response(body || null, { status, headers }));
  }
}

function sessionFor(pod: FakePod): Session {
  return {
    info: { isLoggedIn: true, webId: "https://alice.example/profile/card#me" },
    fetch: pod.fetch,
  } as unknown as Session;
}

Deno.test("seedRoomMembers writes N folds-to-N-members join events", async () => {
  const pod = new FakePod();
  const session = sessionFor(pod);

  await seedRoomMembers(session, ROOM, 7);

  // One immutable event resource per seeded member.
  assert.equal(pod.resources.size, 7);
  // The real fold reads them back as exactly 7 distinct members, each joined.
  const members = await getMembers(ROOM, session);
  assert.equal(members.length, 7);
  assert.equal(new Set(members.map((m) => m.webId)).size, 7);
  assert.ok(members.every((m) => m.webId.startsWith("https://bench.example/member-")));
});

Deno.test("seedRoomMembers with n=0 writes nothing (empty-room baseline)", async () => {
  const pod = new FakePod();
  const session = sessionFor(pod);

  await seedRoomMembers(session, ROOM, 0);

  assert.equal(pod.resources.size, 0);
  assert.equal((await getMembers(ROOM, session)).length, 0);
});

Deno.test("seedRoomRoleChurn grows history without changing membership", async () => {
  const pod = new FakePod();
  const session = sessionFor(pod);

  await seedRoomMembers(session, ROOM, 3); // 3 membership events
  await seedRoomRoleChurn(session, ROOM, 3, 12); // 12 role events over the 3 members

  // Every event is retained in the append-only log (3 join + 12 role).
  assert.equal(pod.resources.size, 15);
  // Membership is the isolating invariant: still exactly the 3 seeded members,
  // unchanged by the role churn.
  const members = await getMembers(ROOM, session);
  assert.equal(members.length, 3);
  // The churn folds to a (latest) role per member — valid IRIs, not filtered out.
  assert.ok(members.every((m) => m.roles.length >= 1));
});

Deno.test("seedRoomRoleChurn is a no-op without members to attribute to", async () => {
  const pod = new FakePod();
  const session = sessionFor(pod);

  await seedRoomRoleChurn(session, ROOM, 0, 10); // no members → nothing written
  assert.equal(pod.resources.size, 0);
});
