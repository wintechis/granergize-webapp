/// <reference lib="deno.ns" />
//
// Tier-1 proof that the RestoreArchive core is callable HEADLESS and COMPOSES its
// two steps: it imports the archive bodies (writing them back to the Pod) AND
// replays the shared-out log to rebuild the ACL projection, returning the combined
// `{...importResult, reissued}` outcome the adapter consumes. Driven with a fake
// offline-fixture Session — no React, no component tree. The archive bytes are
// produced by `exportArchive` so the fixture is a real, round-trippable ZIP.
import { strict as assert } from "node:assert";
import type { Session } from "@inrupt/solid-client-authn-browser";
import { restoreArchiveCore } from "./RestoreArchive.ts";
import { exportArchive } from "../services/pod/podArchive.ts";
import { _setStorageRootForTesting } from "../services/pod/solidUtils.ts";

const WEBID = "https://pod.example/profile/card#me";
const ROOT = "https://pod.example/";
_setStorageRootForTesting(WEBID, ROOT);

const enc = new TextEncoder();

interface Stored {
  bytes: Uint8Array;
  contentType: string;
}
interface Call {
  url: string;
  method: string;
}

/** A byte-preserving fake Pod (mirrors podArchive.test.ts): GET serves stored
 * bytes, PUT/POST records them, HEAD/GET 404 for absent URLs. */
function makePod(
  initial: Record<string, Stored> = {},
): { session: Session; store: Record<string, Stored>; calls: Call[] } {
  const store: Record<string, Stored> = { ...initial };
  const calls: Call[] = [];
  const fetch = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = (typeof input === "string" ? input : input.toString()).split("?")[0];
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = new Headers(init?.headers);
    calls.push({ url, method });
    if (method === "PUT" || method === "POST") {
      const body = init?.body;
      const bytes = body instanceof Uint8Array
        ? new Uint8Array(body)
        : enc.encode(typeof body === "string" ? body : "");
      store[url] = {
        bytes,
        contentType: headers.get("content-type") ?? "application/octet-stream",
      };
      return Promise.resolve(new Response("", { status: 201 }));
    }
    const hit = store[url];
    if (!hit) return Promise.resolve(new Response("Not found", { status: 404 }));
    if (method === "HEAD") return Promise.resolve(new Response("", { status: 200 }));
    return Promise.resolve(
      new Response(hit.bytes as unknown as BodyInit, {
        status: 200,
        headers: { "Content-Type": hit.contentType },
      }),
    );
  };
  return {
    session: { info: { webId: WEBID, isLoggedIn: true }, fetch } as unknown as Session,
    store,
    calls,
  };
}

const ttl = (body: string): Stored => ({ bytes: enc.encode(body), contentType: "text/turtle" });

function listing(container: string, children: string[]): Stored {
  const lines = children.map((c) => `  <${c}>`).join(",\n");
  return ttl(
    `@prefix ldp: <http://www.w3.org/ns/ldp#> .\n<${container}> ldp:contains\n${lines} .`,
  );
}

/** A small source Pod with one building + prefs, exported into an archive. */
function exportablePod() {
  const G = `${ROOT}granergize/`;
  return makePod({
    [G]: listing(G, [`${G}prefs.ttl`, `${G}buildings/`]),
    [`${G}prefs.ttl`]: ttl("# prefs"),
    [`${G}buildings/`]: listing(`${G}buildings/`, [`${G}buildings/b1.ttl`]),
    [`${G}buildings/b1.ttl`]: ttl(`<${G}buildings/b1.ttl#b1> <http://schema.org/name> "B1" .`),
  });
}

Deno.test("restoreArchiveCore (headless): composes import + reissue → combined outcome", async () => {
  // 1. Produce a real archive from a seeded Pod.
  const { bytes, count } = await exportArchive(exportablePod().session);
  assert.ok(count >= 1, "archive carries at least one resource");

  // 2. Restore it onto a fresh Pod (empty shared-out log → 0 grants reissued).
  const target = makePod();
  const outcome = await restoreArchiveCore(target.session, { bytes });

  // The combined outcome the adapter consumes: the import result fields PLUS the
  // reissued count (the second composed step).
  assert.equal(outcome.restored, count, "every archived resource written back");
  assert.equal(outcome.reissued, 0, "no shared-out events → nothing to reissue");
  assert.ok("rebasedFrom" in outcome, "carries the ImportResult fields");

  // The import step actually wrote the building back to the Pod.
  assert.ok(
    target.calls.some((c) => c.method === "PUT" && c.url === `${ROOT}granergize/buildings/b1.ttl`),
    "building resource restored via PUT",
  );
});
