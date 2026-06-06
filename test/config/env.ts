/**
 * The ONE place that branches on runtime. Deno scripts (Tier 2) read `Deno.env`;
 * Playwright specs (Tiers 3–4, Node) read `process.env`. Everything else in
 * `test/config/` imports `getEnv` so the registry is shared by both runtimes.
 *
 * Accessed via `globalThis` (not the `Deno`/`process` globals directly) so the
 * file type-checks under both `deno check` and Playwright's TS loader without
 * needing `@types/node` or `deno.ns` in scope.
 */
// deno-lint-ignore no-explicit-any
type AnyGlobal = any;

export function getEnv(key: string): string | undefined {
  const g = globalThis as AnyGlobal;
  if (typeof g.Deno !== "undefined" && g.Deno?.env?.get) {
    return g.Deno.env.get(key);
  }
  return g.process?.env?.[key];
}
