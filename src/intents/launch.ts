/**
 * Paste-and-launch — the launcher fed a *pre-filled* invocation
 * (`plan-intent-core.md` §10). NOT an interpreter: there is no language to
 * interpret. The input is a fully-specified intent as JSON `{ name, params }`; the
 * launcher deserialises it, resolves the catalog entry by `name`, and dispatches
 * through the SAME entry the palette uses (`invokeByName`/`queryByName`).
 *
 * The deferred NL parser, when it lands, simply *produces* a `{ name, params }`
 * for this same launcher — there is no interpretation step between them.
 *
 * `effect` is DERIVED from the catalog by `name`, never trusted from the input (an
 * optional `effect` field is accepted only as a sanity check). React-free: a
 * headless caller (a dev paste box, an LLM tool, a macro step) hits this directly.
 */
import { INTENTS, type IntentEffect } from "./catalog.ts";
import { invokeByName, queryByName } from "./registry.ts";
import { goTo } from "./navigate.ts";
import type { PodGateway } from "../services/pod/podGateway.ts";

/** A pasted intent that could not be turned into a dispatchable invocation. */
export class LaunchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LaunchError";
  }
}

/** The resolved, ready-to-dispatch invocation `parseLaunch` produces. */
export interface ParsedLaunch {
  readonly name: string;
  /** Derived from the catalog entry, not from the input. */
  readonly effect: IntentEffect;
  readonly params: Record<string, unknown>;
}

/** Catalog name → entry, for the by-name resolution. */
const BY_NAME = new Map(INTENTS.map((e) => [e.name, e]));

/**
 * Parse + resolve a pasted intent. PURE: validates the JSON shape, resolves the
 * `effect` from the catalog, and returns a {@link ParsedLaunch} — no Pod, no
 * dispatch. Throws {@link LaunchError} with a human-readable reason for every
 * rejection (bad JSON, wrong shape, unknown name, effect mismatch) so the paste
 * box can show it inline.
 */
export function parseLaunch(text: string): ParsedLaunch {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    throw new LaunchError(`Not valid JSON: ${(e as Error).message}`);
  }
  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    throw new LaunchError('Expected a JSON object { "name", "params" }');
  }
  const rec = json as Record<string, unknown>;

  const name = rec.name;
  if (typeof name !== "string" || name === "") {
    throw new LaunchError('Missing string field "name"');
  }
  const entry = BY_NAME.get(name);
  if (!entry) {
    throw new LaunchError(`Unknown intent "${name}"`);
  }

  const rawParams = rec.params ?? {};
  if (
    typeof rawParams !== "object" || rawParams === null ||
    Array.isArray(rawParams)
  ) {
    throw new LaunchError('"params" must be an object');
  }

  // `effect` is derived; if the caller supplied one, it must agree (a typo guard,
  // not a source of truth).
  if (rec.effect !== undefined && rec.effect !== entry.effect) {
    throw new LaunchError(
      `effect "${String(rec.effect)}" does not match catalog effect "${entry.effect}" for "${name}"`,
    );
  }

  return {
    name,
    effect: entry.effect,
    params: rawParams as Record<string, unknown>,
  };
}

/** Injectable dispatch seam (defaults to the real registry; tests pass fakes). */
export interface LaunchDeps {
  invoke: (
    name: string,
    params: unknown,
    gateway: PodGateway,
  ) => Promise<unknown>;
  query: (
    name: string,
    params: unknown,
    gateway: PodGateway,
  ) => Promise<unknown>;
}

const DEFAULT_DEPS: LaunchDeps = { invoke: invokeByName, query: queryByName };

/**
 * Launch a pasted intent: {@link parseLaunch} then dispatch on the derived effect.
 * A `write` routes to `invokeByName` (→ outcome), a `read` to `queryByName`
 * (→ value), a `navigate` to `goTo` (→ the route string to push; the caller
 * navigates). Gateway-less for navigate (no Pod).
 */
export function launch(
  text: string,
  gateway: PodGateway,
  deps: LaunchDeps = DEFAULT_DEPS,
): Promise<unknown> {
  let parsed: ParsedLaunch;
  try {
    parsed = parseLaunch(text);
  } catch (e) {
    // A parse failure becomes a rejection so every caller can `await` one channel.
    return Promise.reject(e);
  }
  const { name, effect, params } = parsed;
  switch (effect) {
    case "write":
      return deps.invoke(name, params, gateway);
    case "read":
      return deps.query(name, params, gateway);
    case "navigate":
      try {
        // → the route to push (a value); navigation itself is the caller's job.
        return Promise.resolve(goTo(name, params));
      } catch (e) {
        return Promise.reject(e);
      }
  }
}
