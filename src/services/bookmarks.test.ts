/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import { _setStorageRootForTesting } from "./pod/solidUtils.ts";
import {
  addBookmark,
  bookmarksUri,
  readBookmarks,
  removeBookmark,
} from "./bookmarks.ts";
import { makeFakeSession } from "./testing/fakeSession.ts";

const WEBID = "https://pod.example/profile/card#me";
_setStorageRootForTesting(WEBID, "https://pod.example/");
const BOOKMARKS = bookmarksUri(WEBID);
const A = "https://pod.example/granergize/rooms/aaaa/";
const B = "https://carol.example/granergize/rooms/bbbb/";

/** Stateful fake Session (GET in-memory; PUT writes back; no ETag → plain PUT). */
const makeSession = () => makeFakeSession({ webId: WEBID });

Deno.test("readBookmarks on a missing file yields []", async () => {
  const { session } = makeSession();
  assert.deepEqual(await readBookmarks(session), []);
});

Deno.test("addBookmark adds, and is idempotent (deduped, no second write)", async () => {
  const { session, store } = makeSession();
  await addBookmark(session, A);
  await addBookmark(session, B);
  assert.deepEqual((await readBookmarks(session)).sort(), [A, B].sort());

  const before = store[BOOKMARKS];
  await addBookmark(session, A); // already present → skip
  assert.equal(store[BOOKMARKS], before, "a duplicate add does not rewrite");
  assert.equal((await readBookmarks(session)).length, 2);
});

Deno.test("removeBookmark drops one and leaves the rest", async () => {
  const { session } = makeSession();
  await addBookmark(session, A);
  await addBookmark(session, B);
  await removeBookmark(session, A);
  assert.deepEqual(await readBookmarks(session), [B]);
});

Deno.test("removeBookmark of an absent room is a no-op (no write)", async () => {
  const { session, store } = makeSession();
  await removeBookmark(session, A);
  assert.equal(store[BOOKMARKS], undefined, "no file is created for a no-op");
});
