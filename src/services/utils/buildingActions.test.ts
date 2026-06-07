/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import type { Session } from "@inrupt/solid-client-authn-browser";
import type { BuildingType } from "../../types.ts";
import { buildBuildingDeletionPreview } from "./buildingActions.ts";
import { _setStorageRootForTesting } from "./solidUtils.ts";

const WEBID = "https://me.example/profile/card#me";
const ROOT = "https://me.example/";
const FILE = "https://me.example/granergize/buildings/b1.ttl";
const CONTAINER = "https://me.example/granergize/buildings/b1/";
_setStorageRootForTesting(WEBID, ROOT);

const building = {
  id: "b1",
  uri: `${FILE}#b1`,
  streetAddress: "Hauptstr 1",
} as unknown as BuildingType;

/** Fake session; serves the energy-subtree container listing (or 404 if `empty`). */
function session(opts: { empty?: boolean } = {}): Session {
  const listing = `@prefix ldp: <http://www.w3.org/ns/ldp#> .
<${CONTAINER}> ldp:contains <${CONTAINER}energy/2024-P1Y.ttl> ,
                              <${CONTAINER}energy/2023-P1Y.ttl> .
`;
  return {
    info: { isLoggedIn: true, webId: WEBID },
    fetch: (input: string | URL | Request) => {
      const url = (typeof input === "string" ? input : input.toString())
        .split("?")[0];
      if (url === CONTAINER && !opts.empty) {
        return Promise.resolve(
          new Response(listing, {
            status: 200,
            headers: { "Content-Type": "text/turtle" },
          }),
        );
      }
      return Promise.resolve(new Response("Not found", { status: 404 }));
    },
  } as unknown as Session;
}

Deno.test("buildBuildingDeletionPreview lists the file + energy subtree", async () => {
  const { fileUri, message } = await buildBuildingDeletionPreview(
    session(),
    building,
  );
  assert.equal(fileUri, FILE);
  assert.match(message, /Delete "Hauptstr 1"\?/);
  // The file itself + two energy files = 3 resources.
  assert.match(message, /permanently deletes 3 resource\(s\)/);
  // Paths are shown relative to the storage root.
  assert.match(message, /granergize\/buildings\/b1\.ttl/);
  assert.ok(!message.includes(ROOT), "absolute root is stripped from the preview");
});

Deno.test("buildBuildingDeletionPreview degrades to the file alone when listing fails", async () => {
  const { message } = await buildBuildingDeletionPreview(
    session({ empty: true }),
    building,
  );
  assert.match(message, /permanently deletes 1 resource\(s\)/);
});

Deno.test("buildBuildingDeletionPreview falls back to an id label without a street address", async () => {
  const { message } = await buildBuildingDeletionPreview(session({ empty: true }), {
    id: "b9",
    uri: `${FILE}#b9`,
  } as unknown as BuildingType);
  assert.match(message, /Delete "Building b9"\?/);
});
