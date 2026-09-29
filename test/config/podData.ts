/**
 * Where the local Pod server keeps its data — the one opt-in that makes the
 * hand-driven dev stack (`deno task dev:local`) persist across restarts.
 *
 * Default: a fresh temp dir per boot, wiped on stop (every automated lane relies
 * on a pristine Pod per spec — CSS's default config even keeps resources in
 * memory). Setting `LOCAL_POD_DATA=<dir>` boots CSS with its file-backed config
 * (`@css:config/file.json`) rooted at that directory and leaves it in place on
 * stop, so the seeded accounts and whatever you saved come back on the next boot
 * (CSS's account seeder only warns when an account already exists). CSS only — the JSS
 * backend keeps accounts outside its data dir and 409s on re-seed, so it
 * refuses the option rather than silently losing the accounts.
 *
 * Guard: the browser lane (`E2E_LOCAL=1`) NEVER persists, whatever the shell
 * carries — a stray `LOCAL_POD_DATA` in the environment must not make the
 * hermetic specs share state. The headless/bench lanes don't read it at all.
 * Runtime-agnostic (via `getEnv`) like the rest of `test/config/`.
 */
import { getEnv } from "./env.ts";

/** Pure rule: the persistent data dir to use, or `undefined` for a throwaway one. */
export function resolvePodDataDir(
  env: { LOCAL_POD_DATA?: string; E2E_LOCAL?: string },
): string | undefined {
  const dir = env.LOCAL_POD_DATA?.trim();
  if (!dir) return undefined;
  if (env.E2E_LOCAL === "1") return undefined;
  return dir;
}

/** {@link resolvePodDataDir} over the live environment. */
export function podDataDir(): string | undefined {
  return resolvePodDataDir({
    LOCAL_POD_DATA: getEnv("LOCAL_POD_DATA"),
    E2E_LOCAL: getEnv("E2E_LOCAL"),
  });
}
