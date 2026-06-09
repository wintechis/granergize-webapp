/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import type { Session } from "@inrupt/solid-client-authn-browser";
import { exportArchive, importArchive } from "./podArchive.ts";
import { _setStorageRootForTesting } from "./solidUtils.ts";
import { readZip } from "../../lib/zip.ts";

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
  contentType?: string;
}

/**
 * A byte-preserving fake Pod: GET serves stored bytes with their content type,
 * PUT records bytes + the request's Content-Type, HEAD/GET 404s for absent URLs
 * (so `ensureContainer` self-provisions). Container listings are just stored
 * Turtle resources whose body carries `ldp:contains`.
 */
function makePod(
  initial: Record<string, Stored> = {},
): { session: Session; store: Record<string, Stored>; calls: Call[] } {
  const store: Record<string, Stored> = { ...initial };
  const calls: Call[] = [];
  const fetch = (input: string | URL, init?: RequestInit): Promise<Response> => {
    const url = (typeof input === "string" ? input : input.toString()).split("?")[0];
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = new Headers(init?.headers);
    calls.push({ url, method, contentType: headers.get("content-type") ?? undefined });

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
    if (method === "HEAD") {
      return Promise.resolve(new Response("", { status: 200 }));
    }
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

/** Container listing Turtle with `ldp:contains` pointing at `children`. */
function listing(container: string, children: string[]): Stored {
  const lines = children.map((c) => `  <${c}>`).join(",\n");
  return ttl(
    `@prefix ldp: <http://www.w3.org/ns/ldp#> .\n<${container}> ldp:contains\n${lines} .`,
  );
}

// A small Pod: prefs.ttl, one building TTL, and a binary attachment under files/.
const PHOTO = new Uint8Array([0, 1, 2, 254, 255, 137, 80]);
function seedPod() {
  const G = `${ROOT}granergize/`;
  return makePod({
    [G]: listing(G, [`${G}prefs.ttl`, `${G}buildings/`]),
    [`${G}prefs.ttl`]: ttl("# prefs"),
    [`${G}buildings/`]: listing(`${G}buildings/`, [
      `${G}buildings/b1.ttl`,
      `${G}buildings/files/`,
    ]),
    [`${G}buildings/b1.ttl`]: ttl(
      `<${G}buildings/b1.ttl#b1> <http://schema.org/name> "B1" ;\n` +
        `  <http://www.w3.org/ns/prov#agent> <${WEBID}> .`,
    ),
    [`${G}buildings/files/`]: listing(`${G}buildings/files/`, [
      `${G}buildings/files/photo.bin`,
    ]),
    [`${G}buildings/files/photo.bin`]: {
      bytes: PHOTO,
      contentType: "application/octet-stream",
    },
  });
}

Deno.test("exportArchive packs every non-container resource plus a manifest", async () => {
  const { session } = seedPod();
  const { bytes, count } = await exportArchive(session);
  assert.equal(count, 3, "three files (containers excluded)");

  const entries = readZip(bytes);
  const paths = entries.map((e) => e.path).sort();
  assert.deepEqual(paths, [
    "granergize/buildings/b1.ttl",
    "granergize/buildings/files/photo.bin",
    "granergize/prefs.ttl",
    "manifest.json",
  ]);

  // Manifest records the content type per entry.
  const manifest = JSON.parse(
    new TextDecoder().decode(entries.find((e) => e.path === "manifest.json")!.data),
  );
  assert.equal(manifest.entries["granergize/prefs.ttl"], "text/turtle");
  assert.equal(
    manifest.entries["granergize/buildings/files/photo.bin"],
    "application/octet-stream",
  );

  // Binary bytes survive verbatim.
  const photo = entries.find((e) => e.path.endsWith("photo.bin"))!;
  assert.deepEqual([...photo.data], [...PHOTO]);
});

Deno.test("importArchive restores files with their content types into a fresh Pod", async () => {
  const { bytes } = await exportArchive(seedPod().session);

  const fresh = makePod();
  const { restored } = await importArchive(fresh.session, bytes);
  assert.equal(restored, 3);

  // Containers were provisioned (empty-PUT) before their files.
  const G = `${ROOT}granergize/`;
  for (const c of [G, `${G}buildings/`, `${G}buildings/files/`]) {
    assert.ok(fresh.store[c], `container ${c} created`);
  }

  // Turtle restored as text/turtle, binary as octet-stream with exact bytes.
  assert.equal(fresh.store[`${G}prefs.ttl`].contentType, "text/turtle");
  const photo = fresh.store[`${G}buildings/files/photo.bin`];
  assert.equal(photo.contentType, "application/octet-stream");
  assert.deepEqual([...photo.bytes], [...PHOTO]);

  // The manifest itself is not written to the Pod.
  assert.ok(!(`${ROOT}manifest.json` in fresh.store));
  assert.ok(!(`${G}manifest.json` in fresh.store));
});

Deno.test("importArchive rebases textual bodies onto a different target root", async () => {
  const { bytes } = await exportArchive(seedPod().session);
  const fresh = makePod();
  const TARGET = "https://new.example/";

  const res = await importArchive(fresh.session, bytes, { targetBase: TARGET });
  assert.equal(res.rebasedFrom, ROOT);
  assert.equal(res.rebasedTo, TARGET);

  const G = `${TARGET}granergize/`;
  // The building TTL is written under the target root with its own IRIs rebased.
  const b1 = fresh.store[`${G}buildings/b1.ttl`];
  assert.ok(b1, "building written under target root");
  const body = new TextDecoder().decode(b1.bytes);
  assert.ok(body.includes(`${G}buildings/b1.ttl#b1`), "building IRI rebased to target");
  assert.ok(!body.includes(`${ROOT}granergize/`), "no source app-collection IRI remains");
  // Term-precise: the (unchanged) owner WebID is a distinct identity — it keeps
  // its own host rather than being dragged onto the new storage root.
  assert.ok(body.includes(WEBID), "unchanged WebID keeps its real location");

  // Binary attachment is byte-identical (never rebased).
  assert.deepEqual([...fresh.store[`${G}buildings/files/photo.bin`].bytes], [...PHOTO]);
});

Deno.test("importArchive leaves a literal containing the WebID string untouched", async () => {
  // The headline win over string substitution: a literal that merely *contains*
  // the WebID is not rewritten — only IRI terms are.
  const pod = makePod();
  const G = `${ROOT}granergize/`;
  pod.store[G] = listing(G, [`${G}note.ttl`]);
  pod.store[`${G}note.ttl`] = ttl(
    `<${G}note.ttl#n> <http://schema.org/description> "see ${WEBID} for details" ;\n` +
      `  <http://www.w3.org/ns/prov#agent> <${WEBID}> .`,
  );
  const { bytes } = await exportArchive(pod.session);

  const fresh = makePod();
  const NEW_WEBID = "https://other.example/card#me";
  await importArchive(fresh.session, bytes, { targetWebId: NEW_WEBID });
  const body = new TextDecoder().decode(fresh.store[`${G}note.ttl`].bytes);

  assert.ok(body.includes(`<${NEW_WEBID}>`), "the IRI term was rewritten");
  assert.ok(
    body.includes(`see ${WEBID} for details`),
    "the literal mentioning the WebID was left intact",
  );
});

Deno.test("importArchive rewrites the owner WebID onto the target identity", async () => {
  const { bytes } = await exportArchive(seedPod().session);
  const fresh = makePod();
  const NEW_WEBID = "https://other.example/card#me";

  // Same storage root, different WebID: only the WebID is rewritten.
  const res = await importArchive(fresh.session, bytes, { targetWebId: NEW_WEBID });
  assert.equal(res.rebasedWebId, NEW_WEBID);
  assert.equal(res.rebasedFrom, null, "base unchanged");

  const body = new TextDecoder().decode(
    fresh.store[`${ROOT}granergize/buildings/b1.ttl`].bytes,
  );
  assert.ok(body.includes(`prov#agent> <${NEW_WEBID}>`), "owner WebID rewritten");
  assert.ok(!body.includes(WEBID), "old WebID gone");
  // The building's own IRI (root-based, not the WebID) is untouched.
  assert.ok(body.includes(`${ROOT}granergize/buildings/b1.ttl#b1`));
});

Deno.test("importArchive rewrites WebID before root so a root-prefixed WebID survives", async () => {
  // WEBID starts with ROOT; rebasing both to a new Pod must keep the WebID intact
  // (WebID rewrite runs first), not leave it half-rebased.
  const { bytes } = await exportArchive(seedPod().session);
  const fresh = makePod();
  const TARGET = "https://new.example/";
  const NEW_WEBID = "https://new.example/profile/card#me";

  await importArchive(fresh.session, bytes, {
    targetBase: TARGET,
    targetWebId: NEW_WEBID,
  });
  const body = new TextDecoder().decode(
    fresh.store[`${TARGET}granergize/buildings/b1.ttl`].bytes,
  );
  assert.ok(body.includes(`prov#agent> <${NEW_WEBID}>`), "WebID fully rewritten");
  assert.ok(!body.includes("pod.example"), "no source Pod reference remains");
});

Deno.test("importArchive does not rebase when target equals source root", async () => {
  const { bytes } = await exportArchive(seedPod().session);
  const fresh = makePod();
  const res = await importArchive(fresh.session, bytes); // target = ROOT (same)
  assert.equal(res.rebasedFrom, null);
  assert.equal(res.rebasedTo, null);
  const body = new TextDecoder().decode(
    fresh.store[`${ROOT}granergize/buildings/b1.ttl`].bytes,
  );
  assert.ok(body.includes(`${ROOT}granergize/buildings/b1.ttl#b1`));
});

Deno.test("importArchive resolves a relative <> subject against the source URL, then rebases it", async () => {
  // The sharing-log event shape uses `<>` (the resource itself) as subject. It
  // must resolve against the resource's source URL and rebase to the target.
  const pod = makePod();
  const G = `${ROOT}granergize/`;
  pod.store[G] = listing(G, [`${G}shared-out/`]);
  pod.store[`${G}shared-out/`] = listing(`${G}shared-out/`, [`${G}shared-out/e1`]);
  pod.store[`${G}shared-out/e1`] = ttl(
    `<> <http://www.w3.org/ns/solid/interop#forResource> <${G}buildings/b.ttl> .`,
  );
  const { bytes } = await exportArchive(pod.session);

  const fresh = makePod();
  const TARGET = "https://new.example/";
  await importArchive(fresh.session, bytes, { targetBase: TARGET });
  const body = new TextDecoder().decode(fresh.store[`${TARGET}granergize/shared-out/e1`].bytes);

  // The `<>` subject became the absolute event URL, rebased onto the new root...
  assert.ok(body.includes(`${TARGET}granergize/shared-out/e1`), "subject rebased absolute");
  // ...and the forResource object rebased too.
  assert.ok(body.includes(`${TARGET}granergize/buildings/b.ttl`), "object rebased");
  assert.ok(!body.includes("pod.example"), "no source-Pod reference remains");
});

Deno.test("exportArchive throws when not logged in", async () => {
  const session = { info: { webId: undefined } } as unknown as Session;
  await assert.rejects(() => exportArchive(session), /Not logged in/);
});
