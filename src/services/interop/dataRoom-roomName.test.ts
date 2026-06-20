/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import { _setStorageRootForTesting } from "../pod/solidUtils.ts";
import { readRoomName, readRoomNames } from "./dataRoom.ts";
import { RDFS_LABEL } from "../rdf/vocabularies.ts";
import { makeFakeSession } from "../testing/fakeSession.ts";

// A room's human name lives in a `<room>name` resource as `<room> rdfs:label "…"`;
// the finder reads it (falling back to the URI) so it never shows the long IRI.
const WEBID = "https://pod.example/profile/card#me";
_setStorageRootForTesting(WEBID, "https://pod.example/");

const ROOM_A = "https://pod.example/granergize/rooms/aaaa/";
const ROOM_B = "https://carol.example/granergize/rooms/bbbb/";

/** Seed a room's name resource (`<room>name`) with its rdfs:label. */
const named = (room: string, label: string): Record<string, string> => ({
  [`${room}name`]: `<${room}> <${RDFS_LABEL}> "${label}" .`,
});

Deno.test("readRoomName returns the room's rdfs:label", async () => {
  const { session } = makeFakeSession({
    webId: WEBID,
    resources: named(ROOM_A, "Project X"),
  });
  assert.equal(await readRoomName(ROOM_A, session), "Project X");
});

Deno.test("readRoomName is null for an unnamed / unreadable room", async () => {
  const { session } = makeFakeSession({ webId: WEBID });
  assert.equal(await readRoomName(ROOM_A, session), null);
});

Deno.test("readRoomNames maps named rooms and omits the unnamed", async () => {
  const { session } = makeFakeSession({
    webId: WEBID,
    resources: named(ROOM_A, "Project X"),
  });
  assert.deepEqual(await readRoomNames([ROOM_A, ROOM_B], session), {
    [ROOM_A]: "Project X",
  });
});

Deno.test("readRoomNames on an empty list does no work", async () => {
  const { session } = makeFakeSession({ webId: WEBID });
  assert.deepEqual(await readRoomNames([], session), {});
});
