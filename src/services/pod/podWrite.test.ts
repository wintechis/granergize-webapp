/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import { DataFactory } from "n3";
import type { Session } from "@inrupt/solid-client-authn-browser";
import {
  appendToContainer,
  ConflictError,
  ensureContainer,
  readModifyWrite,
} from "./podWrite.ts";
import { setNotificationSink } from "../../lib/notificationSink.ts";

const { namedNode } = DataFactory;
const URL_ = "https://pod.example/granergize/dataSources.ttl";
const S = namedNode("https://pod.example/s");
const P = namedNode("https://pod.example/p");
const O = namedNode("https://pod.example/o");

interface PutCall {
  ifMatch: string | null;
  ifNoneMatch: string | null;
  body: string;
}

/**
 * A fake CSS-like resource with ETag + If-Match semantics. GET returns the body
 * and an ETag; PUT honours If-Match / If-None-Match and returns 412 on mismatch.
 * `failNextPuts` forces N leading PUTs to 412 (to simulate a concurrent writer).
 */
function makeServer(
  initial: { body: string; etag: string } | null,
  opts: { withEtag?: boolean; failNextPuts?: number } = {},
) {
  const withEtag = opts.withEtag ?? true;
  let state = initial ? { ...initial } : null;
  let fail = opts.failNextPuts ?? 0;
  let version = initial ? parseInt(initial.etag.replace(/\D/g, "")) || 0 : 0;
  const puts: PutCall[] = [];
  let gets = 0;

  const fetch = (_input: string | URL, init?: RequestInit): Promise<Response> => {
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "GET" || method === "HEAD") {
      gets++;
      if (!state) return Promise.resolve(new Response("Not found", { status: 404 }));
      const headers: Record<string, string> = {
        "Content-Type": "text/turtle",
      };
      if (withEtag) headers.ETag = state.etag;
      return Promise.resolve(
        new Response(method === "HEAD" ? null : state.body, {
          status: 200,
          headers,
        }),
      );
    }
    if (method === "PUT") {
      const h = new Headers(init?.headers);
      puts.push({
        ifMatch: h.get("If-Match"),
        ifNoneMatch: h.get("If-None-Match"),
        body: String(init?.body ?? ""),
      });
      if (fail > 0) {
        fail--;
        return Promise.resolve(new Response(null, { status: 412 }));
      }
      if (h.get("If-None-Match") === "*" && state) {
        return Promise.resolve(new Response(null, { status: 412 }));
      }
      if (
        withEtag && h.get("If-Match") &&
        (!state || state.etag !== h.get("If-Match"))
      ) {
        return Promise.resolve(new Response(null, { status: 412 }));
      }
      version++;
      state = { body: String(init?.body ?? ""), etag: `"v${version}"` };
      return Promise.resolve(new Response(null, { status: 205 }));
    }
    return Promise.resolve(new Response(null, { status: 405 }));
  };

  return {
    session: { info: { webId: "x", isLoggedIn: true }, fetch } as unknown as
      Session,
    puts,
    get gets() {
      return gets;
    },
    get body() {
      return state?.body ?? null;
    },
  };
}

const TTL = (triples: string) =>
  `@prefix : <https://pod.example/> .\n${triples}\n`;

Deno.test("readModifyWrite creates a missing resource with If-None-Match: *", async () => {
  const srv = makeServer(null);
  await readModifyWrite(URL_, srv.session, (store, { created }) => {
    assert.equal(created, true);
    store.addQuad(S, P, O);
  });
  assert.equal(srv.puts.length, 1);
  assert.equal(srv.puts[0].ifNoneMatch, "*");
  assert.equal(srv.puts[0].ifMatch, null);
  assert.ok(srv.body?.includes("/o"));
});

Deno.test("readModifyWrite guards an update with If-Match from the GET ETag", async () => {
  const srv = makeServer({ body: TTL(":s :p :existing ."), etag: '"v1"' });
  await readModifyWrite(URL_, srv.session, (store) => store.addQuad(S, P, O));
  assert.equal(srv.puts.length, 1);
  assert.equal(srv.puts[0].ifMatch, '"v1"');
});

Deno.test("readModifyWrite retries on 412 then succeeds (re-reads each attempt)", async () => {
  const srv = makeServer({ body: TTL(":s :p :existing ."), etag: '"v1"' }, {
    failNextPuts: 1,
  });
  let mutations = 0;
  await readModifyWrite(URL_, srv.session, (store) => {
    mutations++;
    store.addQuad(S, P, O);
  });
  assert.equal(mutations, 2, "mutate re-applied after the 412");
  assert.equal(srv.puts.length, 2);
  assert.equal(srv.gets, 2, "re-read before retry");
});

Deno.test("readModifyWrite throws ConflictError after exhausting retries", async () => {
  const srv = makeServer({ body: TTL(":s :p :existing ."), etag: '"v1"' }, {
    failNextPuts: 99,
  });
  await assert.rejects(
    () => readModifyWrite(URL_, srv.session, (store) => store.addQuad(S, P, O)),
    ConflictError,
  );
});

Deno.test("readModifyWrite skips the PUT when mutate returns false", async () => {
  const srv = makeServer({ body: TTL(":s :p :existing ."), etag: '"v1"' });
  await readModifyWrite(
    URL_,
    srv.session,
    (_store, { created }) => (created ? undefined : false),
  );
  assert.equal(srv.puts.length, 0, "no write performed");
});

Deno.test("readModifyWrite degrades to a plain PUT when the server sends no ETag", async () => {
  const srv = makeServer({ body: TTL(":s :p :existing ."), etag: '"v1"' }, {
    withEtag: false,
  });
  await readModifyWrite(URL_, srv.session, (store) => store.addQuad(S, P, O));
  assert.equal(srv.puts.length, 1);
  assert.equal(srv.puts[0].ifMatch, null, "no If-Match without an ETag");
});

Deno.test("ensureContainer creates a missing container, reports it, and announces it once when opted in", async () => {
  const srv = makeServer(null);
  const notices: string[] = [];
  setNotificationSink((m) => notices.push(m));
  try {
    const created = await ensureContainer(
      "https://pod.example/granergize/shared-out/",
      srv.session,
      { announce: true },
    );
    assert.equal(created, true);
    assert.equal(srv.puts.length, 1, "PUT created the container");
    assert.deepEqual(notices, ['Set up the "shared-out" folder on this Pod']);
  } finally {
    setNotificationSink(null);
  }
});

Deno.test("ensureContainer is silent by default, even for a depth-1 app folder", async () => {
  const srv = makeServer(null);
  const notices: string[] = [];
  setNotificationSink((m) => notices.push(m));
  try {
    const created = await ensureContainer(
      "https://pod.example/granergize/views/",
      srv.session,
    );
    assert.equal(created, true);
    assert.equal(srv.puts.length, 1, "PUT created the container");
    assert.deepEqual(notices, [], "announcing is opt-in");
  } finally {
    setNotificationSink(null);
  }
});

Deno.test("ensureContainer creates a deep per-content container without announcing it", async () => {
  const srv = makeServer(null);
  const notices: string[] = [];
  setNotificationSink((m) => notices.push(m));
  try {
    const created = await ensureContainer(
      "https://pod.example/granergize/rooms/3f9c-uuid/",
      srv.session,
      { announce: true },
    );
    assert.equal(created, true);
    assert.equal(srv.puts.length, 1, "still created");
    assert.deepEqual(notices, [], "nested container creation stays quiet");
  } finally {
    setNotificationSink(null);
  }
});

Deno.test("ensureContainer is a silent no-op when the container already exists", async () => {
  const srv = makeServer({ body: "", etag: '"v1"' });
  const notices: string[] = [];
  setNotificationSink((m) => notices.push(m));
  try {
    const created = await ensureContainer(
      "https://pod.example/granergize/shared-out/",
      srv.session,
    );
    assert.equal(created, false);
    assert.equal(srv.puts.length, 0, "no write when it exists");
    assert.deepEqual(notices, [], "no notice when it exists");
  } finally {
    setNotificationSink(null);
  }
});

Deno.test("appendToContainer POSTs Turtle to the container", async () => {
  const posts: Array<{ url: string; contentType: string | null; body: string }> =
    [];
  const fetch = (input: string | URL, init?: RequestInit): Promise<Response> => {
    posts.push({
      url: String(input),
      contentType: new Headers(init?.headers).get("Content-Type"),
      body: String(init?.body ?? ""),
    });
    return Promise.resolve(new Response(null, { status: 201 }));
  };
  const session = { info: { webId: "x", isLoggedIn: true }, fetch } as unknown as
    Session;
  await appendToContainer(
    "https://pod.example/granergize/shared-out/",
    TTL(":s :p :o ."),
    session,
  );
  assert.equal(posts.length, 1);
  assert.equal(posts[0].url, "https://pod.example/granergize/shared-out/");
  assert.equal(posts[0].contentType, "text/turtle");
  assert.ok(posts[0].body.includes(":s :p :o ."));
});

Deno.test("appendToContainer throws on a non-ok response, honouring describeError", async () => {
  const fetch = (): Promise<Response> =>
    Promise.resolve(new Response(null, { status: 403 }));
  const session = { info: { webId: "x", isLoggedIn: true }, fetch } as unknown as
    Session;
  await assert.rejects(
    () =>
      appendToContainer("https://pod.example/x/", "", session, {
        describeError: (res) => `no permission (HTTP ${res.status})`,
      }),
    /no permission \(HTTP 403\)/,
  );
  await assert.rejects(
    () => appendToContainer("https://pod.example/x/", "", session),
    /Failed to append to https:\/\/pod\.example\/x\/ \(HTTP 403\)/,
  );
});

Deno.test("readModifyWrite supports a custom serializer", async () => {
  const srv = makeServer(null);
  await readModifyWrite(
    URL_,
    srv.session,
    (store) => store.addQuad(S, P, O),
    { serialize: () => "# custom\n" },
  );
  assert.equal(srv.body, "# custom\n");
});
