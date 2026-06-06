/// <reference lib="deno.ns" />
/**
 * Playwright-managed local CSS for Tier 3 (E2E_LOCAL=1). Boots a throwaway CSS via
 * startLocalCss() (the same one the headless tier uses) and keeps it up for the
 * run. Also runs a tiny control server on LOCAL_CSS_CONTROL_PORT whose `POST /reset`
 * RESTARTS CSS from scratch — giving each spec pristine, freshly-seeded pods so
 * specs never share mutable pod state. `login()` hits it once per spec file (see
 * helpers/login.ts).
 *
 * Playwright's `webServer` runs this command and sends SIGTERM on teardown; the
 * signal handler does the orderly stop(). It blocks forever in between.
 */
import { type LocalCss, startLocalCss } from "../headless/localCss.ts";
import { LOCAL_CSS_CONTROL_PORT, LOCAL_CSS_PORT } from "../config/localSeed.ts";

/**
 * Resolve once `port` is actually bindable again — i.e. the previous CSS has fully
 * released its socket. A blind `setTimeout` is a guess: under full-suite load the
 * old node can still hold the port past it, so the next CSS fails to bind and exits
 * code 1 (then startLocalCss burns its 60s readiness poll before throwing). Probing
 * with a throwaway listen is precise. Bind 127.0.0.1: while CSS holds 0.0.0.0:port
 * this still fails with AddrInUse, so a success genuinely means free.
 */
async function waitForPortFree(port: number, deadlineMs = 10_000): Promise<void> {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    try {
      Deno.listen({ hostname: "127.0.0.1", port }).close();
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
}

/**
 * Boot CSS robustly: wait for the port to be free, then start — retrying a couple
 * times if we lose the tiny TOCTOU window between the probe and CSS's own bind.
 * This is what makes the per-spec `/reset` reliable instead of a coin-flip.
 */
async function bootCss(): Promise<LocalCss> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    await waitForPortFree(LOCAL_CSS_PORT);
    try {
      return await startLocalCss(LOCAL_CSS_PORT);
    } catch (e) {
      lastErr = e;
      console.error(`CSS boot attempt ${attempt}/3 failed: ${e}`);
    }
  }
  throw lastErr;
}

let css = await bootCss();
console.log(`local CSS up at ${css.baseUrl} (A=${css.A.webId}, B=${css.B.webId})`);

let stopping = false;
let restarting = false;

// Fail-fast: if CSS exits on its own (crash/hang-kill) — NOT our restart/stop —
// abort with a non-zero code instead of leaving a dead server that every spec
// times out against.
function watchExit(c: LocalCss) {
  c.status.then((s) => {
    if (stopping || restarting) return;
    console.error(`local CSS exited unexpectedly (code ${s.code}) — aborting the run`);
    Deno.exit(1);
  });
}
watchExit(css);

// Control server (separate port): POST /reset restarts CSS and replies once the
// fresh instance is ready, so the caller can await a clean slate.
Deno.serve({ port: LOCAL_CSS_CONTROL_PORT }, async (req) => {
  if (req.method === "POST" && new URL(req.url).pathname === "/reset") {
    restarting = true;
    await css.stop();
    try {
      css = await bootCss(); // waits for port release + retries; no blind delay
    } catch (e) {
      restarting = false;
      console.error(`/reset failed to reboot CSS: ${e}`);
      return new Response("reset failed\n", { status: 500 });
    }
    restarting = false;
    watchExit(css);
    return new Response("ok\n");
  }
  // Any GET is a health check. Playwright's webServer waits on this — and the
  // control server only starts listening AFTER the first startLocalCss() resolves
  // (CSS booted + seeded), so a 200 here guarantees CSS is ready too.
  return new Response("ok\n");
});

const shutdown = async () => {
  if (stopping) return;
  stopping = true;
  await css.stop();
  Deno.exit(0);
};
for (const sig of ["SIGTERM", "SIGINT"] as const) {
  Deno.addSignalListener(sig, shutdown);
}

await new Promise(() => {}); // block until Playwright stops the webServer
