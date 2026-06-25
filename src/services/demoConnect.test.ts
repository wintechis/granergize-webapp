/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import {
  DEMO_AGENT_NAMES,
  seedDemoAgents,
  seedDemoRooms,
} from "./demoConnect.ts";
import { readAgents } from "./savedAgents.ts";
import { getCurrentRoom } from "./interop/dataRoom.ts";
import { _setStorageRootForTesting } from "./pod/solidUtils.ts";
import { withRetry } from "./pod/retryFetch.ts";
import { makeFakeSession } from "./testing/fakeSession.ts";

const ALICE = "https://alice.example/profile/card#me";

_setStorageRootForTesting(ALICE, "https://alice.example/");

const makeSession = () => makeFakeSession({ webId: ALICE, etags: true });

Deno.test("seedDemoAgents writes a resolvable profile per contact and fills the address book", async () => {
  const { session, store } = makeSession();
  const { seeded, total } = await seedDemoAgents(session);
  assert.equal(seeded, DEMO_AGENT_NAMES.length);
  assert.equal(total, DEMO_AGENT_NAMES.length);

  const contacts = await readAgents(session);
  assert.equal(contacts.length, DEMO_AGENT_NAMES.length);
  // Every contact's WebID points at a fixture profile document that carries its
  // name — what AgentLabel's live resolution reads.
  for (const c of contacts) {
    const doc = c.webId.split("#")[0];
    assert.ok(
      store[doc]?.includes(`"${c.name}"`),
      `${doc} holds the foaf:name "${c.name}"`,
    );
  }
});

Deno.test("seedDemoAgents is idempotent — a second run doesn't duplicate", async () => {
  const { session } = makeSession();
  await seedDemoAgents(session);
  await seedDemoAgents(session);
  assert.equal((await readAgents(session)).length, DEMO_AGENT_NAMES.length);
});

Deno.test("seedDemoAgents tallies a partial failure instead of throwing", async () => {
  const { session } = makeFakeSession({
    webId: ALICE,
    etags: true,
    respond: (url, init) =>
      (init?.method ?? "GET").toUpperCase() === "PUT" &&
        url.endsWith("/anna-albers.ttl")
        ? new Response(null, { status: 500 })
        : undefined,
  });
  const { seeded, total } = await seedDemoAgents(session);
  assert.equal(seeded, total - 1);
});

Deno.test("seedDemoAgents: a transient 502 on one write is retried, not tallied as a miss", async () => {
  // The user-reported "Added {n} of {total}" partial: a one-off transient failure
  // on a single write among the ~40 a seed makes. 502/504 are now retryable, so
  // production's withRetry-wrapped gateway.fetch absorbs the blip. Mirror that
  // wrapping here (the fake session is the raw transport) and inject ONE 502.
  let failed502 = false;
  const { session } = makeFakeSession({
    webId: ALICE,
    etags: true,
    respond: (url, init) => {
      if (
        (init?.method ?? "GET").toUpperCase() === "PUT" &&
        url.endsWith("/bruno-becker.ttl") && !failed502
      ) {
        failed502 = true;
        return new Response(null, { status: 502 });
      }
      return undefined;
    },
  });
  const gateway = { ...session, fetch: withRetry(session.fetch, { baseDelayMs: 0 }) };
  const { seeded, total } = await seedDemoAgents(gateway);
  assert.ok(failed502, "the transient 502 path was exercised");
  assert.equal(seeded, total); // retried → full tally, no partial
});

Deno.test("seedDemoRooms creates the requested rooms on the own Pod, none made current", async () => {
  const { session } = makeSession();
  const { rooms, total } = await seedDemoRooms(session, 3);
  assert.equal(rooms.length, 3);
  assert.equal(total, 3);
  for (const r of rooms) {
    assert.ok(
      r.startsWith("https://alice.example/granergize/rooms/"),
      `${r} lives under the user's rooms/ collection`,
    );
  }
  // makeCurrent=false: a bulk seed leaves the single-valued current-room pointer
  // untouched (it would otherwise race the concurrent buildings-seed prefs write).
  assert.equal(await getCurrentRoom(session), null);
});
