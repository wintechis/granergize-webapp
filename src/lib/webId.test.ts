/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import { invalidWebIds, webIdsError } from "./webId.ts";

Deno.test("invalidWebIds: flags only non-absolute-URI entries", () => {
  assert.deepEqual(
    invalidWebIds([
      "https://alice.example/profile/card#me",
      "not-a-webid",
      "http://bob.example/#me",
      "",
    ]),
    ["not-a-webid", ""],
  );
});

Deno.test("webIdsError: null when all valid", () => {
  assert.equal(
    webIdsError(["https://a.example/#me", "https://b.example/#me"]),
    null,
  );
});

Deno.test("webIdsError: singular vs plural message", () => {
  assert.equal(webIdsError(["bad"]), "Invalid WebID: bad");
  assert.equal(
    webIdsError(["https://a.example/#me", "bad", "worse"]),
    "Invalid WebIDs: bad, worse",
  );
});
