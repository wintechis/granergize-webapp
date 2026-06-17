/// <reference lib="deno.ns" />
import { type PodGateway, sessionGateway } from "../services/pod/podGateway.ts";
//
// Tier-1 proof that the UploadAttachments core uploads sequentially and returns
// a tally (done/total). Driven headless with a fake offline-fixture Session.
import { strict as assert } from "node:assert";
import type { Session } from "@inrupt/solid-client-authn-browser";
import { uploadAttachmentsCore } from "./UploadAttachments.ts";
import { _setStorageRootForTesting } from "../services/pod/solidUtils.ts";
import type { AttachmentRef } from "../types.ts";

const OWNER = "https://a.example/profile/card#me";
const BUILDING = "https://a.example/granergize/buildings/b-1.ttl";
const SUBJECT = `${BUILDING}#b-1`;

const BUILDING_TTL = `
@prefix rec: <https://w3id.org/rec#> .
<${SUBJECT}> a rec:Building .
`;

/**
 * Fake Pod: every PUT/POST succeeds, the building file reads back as TTL, and a
 * HEAD on a not-yet-existing file 404s (so `uniqueFileUri` picks the first free
 * name). The building store re-serves the latest PUT so the second upload's RMW
 * sees the first attachment.
 */
function pod(): { session: PodGateway; puts: string[] } {
  _setStorageRootForTesting(OWNER, "https://a.example/");
  const store: Record<string, string> = { [BUILDING]: BUILDING_TTL };
  const puts: string[] = [];
  const fetch = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = (typeof input === "string" ? input : input.toString()).split("?")[0];
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "PUT" || method === "POST") {
      if (init?.body != null && typeof init.body === "string") store[url] = init.body;
      puts.push(url);
      return Promise.resolve(new Response("", { status: 201 }));
    }
    if (method === "HEAD") {
      // Containers (trailing slash) exist; files are free until PUT.
      return Promise.resolve(
        new Response("", { status: url.endsWith("/") || url in store ? 200 : 404 }),
      );
    }
    const body = store[url];
    if (body === undefined) return Promise.resolve(new Response("Not found", { status: 404 }));
    return Promise.resolve(
      new Response(body, { status: 200, headers: { "Content-Type": "text/turtle" } }),
    );
  };
  return {
    session: sessionGateway({ info: { isLoggedIn: true, webId: OWNER }, fetch } as unknown as Session),
    puts,
  };
}

function makeFile(name: string): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type: "application/pdf" });
}

Deno.test("uploadAttachmentsCore (headless): N files → tally {done:N,total:N}, onUploaded fires per file", async () => {
  const { session } = pod();
  const uploaded: AttachmentRef[] = [];

  const outcome = await uploadAttachmentsCore(session, {
    fileUri: BUILDING,
    subjectUri: SUBJECT,
    files: [makeFile("a.pdf"), makeFile("b.pdf")],
    onUploaded: (ref) => uploaded.push(ref),
  });

  assert.deepEqual(outcome, { done: 2, total: 2 }, "tally counts both uploads");
  assert.equal(uploaded.length, 2, "onUploaded fired once per landed file");
});

Deno.test("uploadAttachmentsCore (headless): no files → tally {done:0,total:0}", async () => {
  const { session, puts } = pod();

  const outcome = await uploadAttachmentsCore(session, {
    fileUri: BUILDING,
    subjectUri: SUBJECT,
    files: [],
  });

  assert.deepEqual(outcome, { done: 0, total: 0 });
  assert.equal(puts.length, 0, "no writes for an empty batch");
});
