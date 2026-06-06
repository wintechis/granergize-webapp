/// <reference lib="deno.ns" />
/**
 * Playwright-managed local CSS for the browser "local" tier (E2E_LOCAL=1). Boots a
 * throwaway CSS via startLocalCss() (the same one the headless tier uses) and stays
 * alive until Playwright stops the webServer, then runs stop() — which kills the CSS
 * process group (setsid) and wipes its temp dir. Because the browser logs in
 * interactively, it uses the SAME seeded accounts the headless tier authenticates
 * to with client-credentials.
 *
 * Playwright's `webServer` runs this command and sends SIGTERM on teardown; the
 * signal handler does the orderly stop(). It blocks forever in between so the
 * process (and thus the server) stays up for the test run.
 */
import { startLocalCss } from "../headless/localCss.ts";
import { LOCAL_CSS_PORT } from "../config/localSeed.ts";

const css = await startLocalCss(LOCAL_CSS_PORT);
console.log(`local CSS up at ${css.baseUrl} (A=${css.A.webId}, B=${css.B.webId})`);

let stopping = false;
const shutdown = async () => {
  if (stopping) return;
  stopping = true;
  await css.stop();
  Deno.exit(0);
};
for (const sig of ["SIGTERM", "SIGINT"] as const) {
  Deno.addSignalListener(sig, shutdown);
}

// Fail-fast: if CSS exits on its own (crash/hang-kill), abort with a non-zero code
// instead of leaving a dead server up — otherwise every spec would burn its full
// timeout against it. A `stopping` flag distinguishes this from our own teardown.
css.status.then((s) => {
  if (stopping) return;
  console.error(`local CSS exited unexpectedly (code ${s.code}) — aborting the run`);
  Deno.exit(1);
});

await new Promise(() => {}); // block until Playwright stops the webServer
