/// <reference lib="deno.ns" />
//
// Tier-1 proof of the NL→intent-JSON translator (plan-intent-core.md §10, front
// half). The chat API is faked: we assert the request shape (endpoint, bearer key,
// model, the catalog-derived system prompt) and that the model's JSON content is
// returned verbatim for the launcher to validate downstream. No network.
import { strict as assert } from "node:assert";
import {
  buildIntentCatalogSpec,
  buildSystemPrompt,
  translateToIntentJson,
  TranslateError,
} from "./intentTranslate.ts";

// A fake chat-completions endpoint that records the request and returns `content`.
function fakeApi(content: string, status = 200) {
  const seen: { uri: string; init?: RequestInit } = { uri: "" };
  const fetchImpl = (input: string | URL | Request, init?: RequestInit) => {
    seen.uri = String(input);
    seen.init = init;
    const body = JSON.stringify({ choices: [{ message: { content } }] });
    return Promise.resolve(
      new Response(status === 200 ? body : "err", { status }),
    );
  };
  return { seen, fetchImpl };
}

Deno.test("buildIntentCatalogSpec: lists real catalog verbs with their effect", () => {
  const spec = buildIntentCatalogSpec();
  assert.match(spec, /ShareBuilding \[write/);
  assert.match(spec, /AuditGrants \[read/);
  // params are surfaced from INTENT_PARAMS
  assert.match(spec, /buildingUri/);
});

Deno.test("buildSystemPrompt: instructs single-JSON output and embeds the catalog", () => {
  const p = buildSystemPrompt();
  assert.match(p, /single JSON object/i);
  assert.match(p, /ShareBuilding/);
});

Deno.test("translateToIntentJson: POSTs to the chat endpoint with bearer + model and returns the content", async () => {
  const json = '{"name":"ShareBuilding","params":{"buildingUri":"b1"}}';
  const { seen, fetchImpl } = fakeApi(json);

  const out = await translateToIntentJson("share my building b1 with bob", { fetchImpl });
  assert.equal(out, json);

  assert.match(seen.uri, /\/chat\/completions$/);
  const headers = seen.init?.headers as Record<string, string>;
  assert.match(headers.Authorization, /^Bearer /);
  const sent = JSON.parse(String(seen.init?.body));
  assert.equal(typeof sent.model, "string");
  assert.equal(sent.messages[0].role, "system");
  assert.match(sent.messages[0].content, /ShareBuilding/); // catalog-derived prompt
  assert.equal(sent.messages[1].content, "share my building b1 with bob");
});

Deno.test("translateToIntentJson: a non-OK response throws TranslateError", async () => {
  const { fetchImpl } = fakeApi("", 500);
  await assert.rejects(
    () => translateToIntentJson("anything", { fetchImpl }),
    TranslateError,
    "Model request failed",
  );
});

Deno.test("translateToIntentJson: an empty completion throws TranslateError", async () => {
  const { fetchImpl } = fakeApi("   ");
  await assert.rejects(
    () => translateToIntentJson("anything", { fetchImpl }),
    TranslateError,
    "empty completion",
  );
});

// A fetch that times out on the abort signal (never resolves on its own).
const hangingFetch: typeof fetch = (_i, init) =>
  new Promise<Response>((_resolve, reject) => {
    (init as RequestInit)?.signal?.addEventListener("abort", () =>
      reject(new DOMException("timed out", "TimeoutError")));
  });

Deno.test("translateToIntentJson: a stalled request times out (no retry → never hangs)", async () => {
  await assert.rejects(
    () => translateToIntentJson("anything", { fetchImpl: hangingFetch, timeoutMs: 20, retries: 0 }),
    TranslateError,
    "timed out",
  );
});

Deno.test("translateToIntentJson: retries once on timeout, then succeeds; onRetry is notified", async () => {
  const json = '{"name":"CreateRoom","params":{}}';
  let calls = 0;
  const retries: Array<[number, number]> = [];
  // Attempt 0 hangs (→ timeout); attempt 1 returns the JSON.
  const flaky: typeof fetch = (i, init) => {
    calls++;
    return calls === 1
      ? hangingFetch(i, init)
      : Promise.resolve(new Response(JSON.stringify({ choices: [{ message: { content: json } }] })));
  };
  const out = await translateToIntentJson("create a data room", {
    fetchImpl: flaky,
    timeoutMs: 20,
    retries: 1,
    onRetry: (a, of) => retries.push([a, of]),
  });
  assert.equal(out, json);
  assert.equal(calls, 2); // first attempt + one retry
  assert.deepEqual(retries, [[1, 1]]); // onRetry fired once as "retry 1/1"
});

Deno.test("translateToIntentJson: a non-OK status is NOT retried", async () => {
  let calls = 0;
  const five00: typeof fetch = () => {
    calls++;
    return Promise.resolve(new Response("err", { status: 500 }));
  };
  await assert.rejects(
    () => translateToIntentJson("anything", { fetchImpl: five00, retries: 1 }),
    TranslateError,
    "Model request failed",
  );
  assert.equal(calls, 1); // not retriable → single attempt
});
