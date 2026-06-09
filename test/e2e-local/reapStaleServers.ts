/// <reference lib="deno.ns" />
/**
 * Pre-flight reaper for the Tier-3 local servers, run by the `e2e:local` task
 * BEFORE Playwright starts. Frees the Pod data port, the control port, and the
 * app-preview port so a server **orphaned by a previous run that never reached
 * Playwright's teardown** (the run killed by a `timeout` wrapper, Ctrl-C, or a
 * SIGKILL) can't be silently adopted via `reuseExistingServer` and left holding the
 * ports indefinitely. With the ports freed, Playwright boots fresh servers it owns
 * and tears them down cleanly on a normal exit.
 *
 * Why this is needed at all: the Pod server is spawned under `setsid` — its own
 * session (see `localCss.ts`/`localJss.ts`), so killing the `npx` wrapper can't
 * orphan `node`. The flip side is it survives the death of the run unless its group
 * is killed, and `reuseExistingServer: true` then adopts that survivor forever. So
 * the reaper does a process-GROUP kill of the listener (catching the detached node +
 * its wrapper), guarded to only touch processes that look like our test servers.
 *
 * Scoped to the dedicated Tier-3 ports — it never touches a dev server on :5173.
 */
import {
  LOCAL_APP_PORT,
  LOCAL_CSS_CONTROL_PORT,
  LOCAL_CSS_PORT,
} from "../config/localSeed.ts";

const PORTS = [LOCAL_CSS_PORT, LOCAL_CSS_CONTROL_PORT, LOCAL_APP_PORT];

/** PIDs parsed from `ss -ltnpH` output (`pid=NNN` tokens). Pure, for testing. */
export function parseListenerPids(ssOutput: string): number[] {
  const pids = new Set<number>();
  for (const m of ssOutput.matchAll(/pid=(\d+)/g)) pids.add(Number(m[1]));
  return [...pids];
}

/**
 * Only reap a listener whose command line looks like one of our throwaway test
 * servers — so an unrelated process that happens to hold the port is left alone.
 * Pure, for testing.
 */
export function isReapableServer(psArgs: string): boolean {
  return /community-solid-server|javascript-solid-server|\bjss\b|\bvite\b|e2e-local\/css\.ts/
    .test(psArgs);
}

async function listenerPids(port: number): Promise<number[]> {
  const out = await new Deno.Command("ss", {
    args: ["-ltnpH", `sport = :${port}`],
    stdout: "piped",
    stderr: "null",
  }).output().catch(() => null);
  return out?.success ? parseListenerPids(new TextDecoder().decode(out.stdout)) : [];
}

/** A process's full command line via `ps`, or "" if it's already gone. */
async function psArgs(pid: number): Promise<string> {
  const out = await new Deno.Command("ps", {
    args: ["-o", "args=", "-p", String(pid)],
    stdout: "piped",
    stderr: "null",
  }).output().catch(() => null);
  return out?.success ? new TextDecoder().decode(out.stdout).trim() : "";
}

/** A process's group id, or null. Used for the group kill of the setsid session. */
async function pgid(pid: number): Promise<number | null> {
  const out = await new Deno.Command("ps", {
    args: ["-o", "pgid=", "-p", String(pid)],
    stdout: "piped",
    stderr: "null",
  }).output().catch(() => null);
  if (!out?.success) return null;
  const n = Number(new TextDecoder().decode(out.stdout).trim());
  return Number.isInteger(n) ? n : null;
}

function portFree(port: number): boolean {
  try {
    Deno.listen({ hostname: "127.0.0.1", port }).close();
    return true;
  } catch {
    return false;
  }
}

async function killGroup(pid: number, sig: "SIGTERM" | "SIGKILL"): Promise<void> {
  const g = await pgid(pid);
  // Group kill (`kill -<sig> -<pgid>`) reaps the setsid-detached node + wrapper.
  // Guard `g > 1`: `-1` would signal every process the user owns.
  if (g && g > 1) {
    await new Deno.Command("kill", {
      args: [`-${sig === "SIGKILL" ? "KILL" : "TERM"}`, `-${g}`],
      stderr: "null",
    }).output().catch(() => {});
  }
  try {
    Deno.kill(pid, sig); // also signal the listener itself (frees the port)
  } catch { /* already gone */ }
}

async function reapPort(port: number): Promise<void> {
  const pids = (await listenerPids(port)).filter(Boolean);
  if (pids.length === 0) return;

  const ours: number[] = [];
  for (const pid of pids) {
    const args = await psArgs(pid);
    if (isReapableServer(args)) ours.push(pid);
    else console.warn(`[reap] :${port} held by an unrecognised process (pid ${pid}): ${args} — leaving it`);
  }
  if (ours.length === 0) return;

  console.log(`[reap] freeing :${port} (stale test server, pid ${ours.join(",")})`);
  for (const sig of ["SIGTERM", "SIGKILL"] as const) {
    for (const pid of ours) await killGroup(pid, sig);
    await new Promise((r) => setTimeout(r, 300));
    if (portFree(port)) return;
  }
  if (!portFree(port)) console.warn(`[reap] :${port} still occupied after TERM+KILL`);
}

if (import.meta.main) {
  for (const port of PORTS) {
    await reapPort(port).catch((e) => console.warn(`[reap] :${port} failed: ${e}`));
  }
}
