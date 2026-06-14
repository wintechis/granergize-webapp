/// <reference lib="deno.ns" />
/**
 * Interactive fully-local dev stack: a throwaway local Pod server that doubles as
 * the OIDC identity provider, plus the Vite dev server pointed at it — so you can
 * click through the real app with credential-free logins and never touch a remote
 * Pod. The automated tiers (`deno task it` / `e2e:local`) cover the same stack for
 * tests; this is the by-hand counterpart, driven by `deno task dev:local`.
 *
 * It spawns two children and ties their lifecycles together:
 *   1. test/e2e-local/css.ts — boots the local Pod+IdP (CSS by default; JSS via
 *      LOCAL_POD_SERVER=jss) and seeds accounts A/B/C, then blocks holding it up
 *      with its control server (the /wipe, /restart, /seed* endpoints stay
 *      available on the control port for manual state resets).
 *   2. vite dev — the app, with VITE_OIDC_CLIENT_ID blanked so it does dynamic
 *      OIDC registration against the LOCAL IdP instead of the production client.
 *
 * Teardown is explicit: a Ctrl+C (SIGINT/SIGTERM) here — or either child exiting
 * on its own — tears down BOTH and waits for them to be gone. css.ts spawns the
 * actual pod under `setsid`, so it only dies via the SIGTERM we send it (its own
 * handler runs `css.stop()` on the detached group); killing this process tree
 * alone would orphan the pod.
 */
// Default to a dedicated port lane so a hand-driven dev:local can coexist with the
// automated Tier-3 lanes that share these Pod ports — e2e:local (offset 0),
// handbuch (offset 40), videos (offset 60). Set BEFORE importing localSeed, which
// reads LOCAL_PORT_OFFSET at module-eval time; an explicit value still wins. The
// dev app port (5173) is unaffected by the offset and never clashes with the
// Playwright preview ports, so only the Pod ports need shifting.
if (!Deno.env.get("LOCAL_PORT_OFFSET")) Deno.env.set("LOCAL_PORT_OFFSET", "80");

const { LOCAL_CSS_BASE, LOCAL_CSS_CONTROL_PORT, LOCAL_SEED } = await import(
  "../config/localSeed.ts"
);

const APP_PORT = Number(Deno.env.get("DEV_LOCAL_APP_PORT") ?? "5173") || 5173;
const APP_DIR = Deno.env.get("VITE_POD_APP_DIR") ?? "granergize-dev";
const BACKEND = (Deno.env.get("LOCAL_POD_SERVER") ?? "css").toLowerCase();

// Block until the control server answers (GET → 200), which css.ts only starts
// AFTER the pod has booted and seeded — so a success here means the IdP is ready
// to log in against. Gives up after the deadline so a wedged boot fails loudly.
async function waitForPodReady(deadlineMs = 90_000): Promise<void> {
  const deadline = Date.now() + deadlineMs;
  const url = `http://localhost:${LOCAL_CSS_CONTROL_PORT}/`;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url);
      if (r.ok) {
        await r.body?.cancel();
        return;
      }
      await r.body?.cancel();
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`local Pod server not ready after ${deadlineMs}ms`);
}

// Spawn children via the SAME deno binary running this script, not a bare "deno"
// on PATH — `deno task` doesn't add deno to PATH, so a name lookup fails when
// deno lives somewhere unusual (e.g. ~/.deno/bin).
const denoBin = Deno.execPath();
const podDir = new URL("./css.ts", import.meta.url).pathname;
const pod = new Deno.Command(denoBin, {
  args: ["run", "-A", podDir],
  stdout: "inherit",
  stderr: "inherit",
  // Inherit LOCAL_POD_SERVER / LOCAL_PORT_OFFSET so this matches a CSS/JSS choice.
  env: { ...Deno.env.toObject() },
}).spawn();

// Boot the Vite dev server in parallel with the Pod: it only compiles + serves,
// and the browser app doesn't contact the Pod until you log in (after the
// "Pod ready" banner below), so it needn't wait for the IdP. Spawning it here —
// rather than after the readiness wait — lets `teardown` close over a `const`.
const vite = new Deno.Command(denoBin, {
  args: ["run", "-A", "npm:vite", "dev", "--port", String(APP_PORT)],
  stdout: "inherit",
  stderr: "inherit",
  env: {
    ...Deno.env.toObject(),
    // Empty client-id → dynamic OIDC registration against the local IdP.
    VITE_OIDC_CLIENT_ID: "",
    VITE_POD_APP_DIR: APP_DIR,
  },
}).spawn();

let tearingDown = false;

// Tear down both children and wait for them gone. SIGTERM to css.ts triggers its
// own shutdown (stops the setsid-detached pod group); vite exits on SIGTERM too.
async function teardown(code = 0): Promise<never> {
  if (tearingDown) await new Promise(() => {}); // a second Ctrl+C: just wait
  tearingDown = true;
  for (const child of [vite, pod]) {
    try {
      child.kill("SIGTERM");
    } catch {
      // already gone
    }
  }
  await Promise.allSettled([vite.status, pod.status]);
  Deno.exit(code);
}

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  Deno.addSignalListener(sig, () => void teardown(0));
}

// If the pod dies unexpectedly, don't leave a dev server pointed at nothing.
pod.status.then((s) => {
  if (!tearingDown) {
    console.error(`local Pod server exited (code ${s.code}) — shutting down`);
    void teardown(s.code || 1);
  }
});

try {
  await waitForPodReady();
} catch (e) {
  console.error(String(e));
  await teardown(1);
}

console.log(
  [
    "",
    `▶ Local ${BACKEND.toUpperCase()} Pod + IdP: ${LOCAL_CSS_BASE}`,
    `▶ App (Vite dev):                http://localhost:${APP_PORT}/`,
    `▶ On the login screen, use IdP:  ${LOCAL_CSS_BASE}`,
    "▶ Seeded logins (email / password):",
    ...(["A", "B", "C"] as const).map(
      (s) => `    ${s}: ${LOCAL_SEED[s].email} / ${LOCAL_SEED[s].password}`,
    ),
    `▶ App data lands under <pod>/${APP_DIR}/ (throwaway; gone on stop).`,
    "▶ Ctrl+C stops both the app and the Pod server.",
    "",
  ].join("\n"),
);

const s = await vite.status;
await teardown(s.code ?? 0);
