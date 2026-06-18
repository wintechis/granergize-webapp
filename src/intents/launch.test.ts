/// <reference lib="deno.ns" />
//
// Tier-1 proof of the paste-and-launch launcher (plan-intent-core.md §10): a
// pasted, fully-specified `{ name, params }` is parsed, resolved against the
// catalog, and dispatched on the DERIVED effect. parseLaunch is pure (no Pod);
// launch routes write→invoke / read→query through an injectable seam so the
// routing is proven without any Pod I/O.
import { strict as assert } from "node:assert";
import type { Session } from "@inrupt/solid-client-authn-browser";
import { type PodGateway, sessionGateway } from "../services/pod/podGateway.ts";
import { launch, LaunchError, parseLaunch } from "./launch.ts";

// A bare gateway — the launcher only forwards it to the dispatcher; the fake
// dispatchers below never touch it, so no fetch is needed.
const GW: PodGateway = sessionGateway(
  {
    info: { isLoggedIn: true, webId: "https://a.example/profile/card#me" },
    fetch: () => Promise.resolve(new Response("", { status: 200 })),
  } as unknown as Session,
);

// ── parseLaunch: the pure resolution ────────────────────────────────────────

Deno.test("parseLaunch: a write name resolves to effect 'write' with params passed through", () => {
  const p = parseLaunch(
    JSON.stringify({ name: "ToggleVisibility", params: { building: "b1" } }),
  );
  assert.equal(p.name, "ToggleVisibility");
  assert.equal(p.effect, "write");
  assert.deepEqual(p.params, { building: "b1" });
});

Deno.test("parseLaunch: a read name resolves to effect 'read'", () => {
  const p = parseLaunch(JSON.stringify({ name: "AuditGrants" }));
  assert.equal(p.effect, "read");
  // Omitted params default to an empty object.
  assert.deepEqual(p.params, {});
});

Deno.test("parseLaunch: a supplied effect that matches the catalog is accepted", () => {
  const p = parseLaunch(
    JSON.stringify({ name: "ExportArchive", effect: "read", params: {} }),
  );
  assert.equal(p.effect, "read");
});

Deno.test("parseLaunch: rejects non-JSON", () => {
  assert.throws(() => parseLaunch("not json {"), LaunchError, "Not valid JSON");
});

Deno.test("parseLaunch: rejects a non-object top level (array/scalar)", () => {
  assert.throws(() => parseLaunch("[1,2,3]"), LaunchError, "JSON object");
  assert.throws(() => parseLaunch("42"), LaunchError, "JSON object");
});

Deno.test("parseLaunch: rejects a missing or empty name", () => {
  assert.throws(() => parseLaunch(JSON.stringify({ params: {} })), LaunchError);
  assert.throws(
    () => parseLaunch(JSON.stringify({ name: "" })),
    LaunchError,
  );
});

Deno.test("parseLaunch: rejects an unknown intent name", () => {
  assert.throws(
    () => parseLaunch(JSON.stringify({ name: "FlyToTheMoon" })),
    LaunchError,
    'Unknown intent "FlyToTheMoon"',
  );
});

Deno.test("parseLaunch: rejects a non-object params", () => {
  assert.throws(
    () => parseLaunch(JSON.stringify({ name: "ToggleVisibility", params: 7 })),
    LaunchError,
    '"params" must be an object',
  );
});

Deno.test("parseLaunch: rejects an effect that disagrees with the catalog", () => {
  assert.throws(
    () =>
      parseLaunch(
        JSON.stringify({ name: "ToggleVisibility", effect: "read" }),
      ),
    LaunchError,
    "does not match catalog effect",
  );
});

// ── launch: dispatch routing (injected fakes, no Pod) ───────────────────────

function spyDeps() {
  const calls: { channel: "invoke" | "query"; name: string; params: unknown }[] =
    [];
  return {
    calls,
    deps: {
      invoke: (name: string, params: unknown) => {
        calls.push({ channel: "invoke", name, params });
        return Promise.resolve({ outcome: "ok" });
      },
      query: (name: string, params: unknown) => {
        calls.push({ channel: "query", name, params });
        return Promise.resolve({ value: 42 });
      },
    },
  };
}

Deno.test("launch: a write intent routes to invoke and returns its outcome", async () => {
  const { calls, deps } = spyDeps();
  const out = await launch(
    JSON.stringify({ name: "ToggleVisibility", params: { building: "b1" } }),
    GW,
    deps,
  );
  assert.deepEqual(calls, [{
    channel: "invoke",
    name: "ToggleVisibility",
    params: { building: "b1" },
  }]);
  assert.deepEqual(out, { outcome: "ok" });
});

Deno.test("launch: a read intent routes to query and returns its value", async () => {
  const { calls, deps } = spyDeps();
  const out = await launch(JSON.stringify({ name: "AuditGrants" }), GW, deps);
  assert.deepEqual(calls, [{ channel: "query", name: "AuditGrants", params: {} }]);
  assert.deepEqual(out, { value: 42 });
});

Deno.test("launch: a parse failure rejects (never throws synchronously)", async () => {
  const { calls, deps } = spyDeps();
  await assert.rejects(() => launch("garbage", GW, deps), LaunchError);
  assert.equal(calls.length, 0); // nothing dispatched
});
