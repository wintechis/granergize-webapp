/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import { INTENTS } from "./catalog.ts";

/**
 * Drift guard: the in-code intent catalog must stay in lockstep with the actual
 * mutation hooks. Reads `mutations.ts` as TEXT (no import — these are React
 * hooks) and checks three invariants against simple regex over the source.
 */

const mutationsSrc = Deno.readTextFileSync(
  new URL("../hooks/mutations.ts", import.meta.url),
);

/** All `export function use*()` names declared in mutations.ts. */
function exportedHooks(src: string): string[] {
  const names: string[] = [];
  const re = /export\s+function\s+(use[A-Za-z0-9_]*)\s*\(/g;
  for (const m of src.matchAll(re)) names.push(m[1]);
  return names;
}

/**
 * For each exported hook, the `meta.action` literal it declares (if any).
 * Locates the hook body, then the first `action: "..."` within it. Bounded by
 * the next `export function` so an action never bleeds in from the next hook.
 */
function hookActions(src: string): Map<string, string | null> {
  const out = new Map<string, string | null>();
  const heads = [...src.matchAll(/export\s+function\s+(use[A-Za-z0-9_]*)\s*\(/g)];
  for (let i = 0; i < heads.length; i++) {
    const name = heads[i][1];
    const start = heads[i].index ?? 0;
    const end = i + 1 < heads.length ? (heads[i + 1].index ?? src.length) : src.length;
    const body = src.slice(start, end);
    const am = body.match(/action:\s*"([^"]*)"/);
    out.set(name, am ? am[1] : null);
  }
  return out;
}

const hooks = exportedHooks(mutationsSrc);
const actions = hookActions(mutationsSrc);

Deno.test("every catalog entry's hook exists as an export in mutations.ts", () => {
  const hookSet = new Set(hooks);
  // navigate intents have no hook (pure route builder) — check only where set.
  const missing = INTENTS.filter((e) => e.hook && !hookSet.has(e.hook)).map((e) => e.hook);
  assert.deepEqual(
    missing,
    [],
    `catalog references hooks not exported from mutations.ts: ${missing.join(", ")}`,
  );
});

Deno.test("catalog action matches the hook's meta.action verbatim", () => {
  for (const e of INTENTS) {
    if (!e.hook) continue; // navigate intents have no hook
    const declared = actions.get(e.hook);
    if (declared == null) continue; // hook declares no meta.action
    assert.equal(
      e.action,
      declared,
      `${e.hook}: catalog action "${e.action}" != meta.action "${declared}"`,
    );
  }
});

Deno.test("every mutation hook with a meta.action has a catalog entry", () => {
  const cataloged = new Set(INTENTS.map((e) => e.hook));
  const missing = hooks.filter((h) => actions.get(h) != null && !cataloged.has(h));
  assert.deepEqual(
    missing,
    [],
    `mutation hooks with meta.action but no catalog entry: ${missing.join(", ")}`,
  );
});
