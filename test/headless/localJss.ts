/// <reference lib="deno.ns" />
/**
 * JavaScript Solid Server (JSS) backend of {@link startLocalPod} — an alternative
 * throwaway local Pod for the test tiers, selected by `LOCAL_POD_SERVER=jss`. JSS
 * generates its IdP signing keys BEFORE it listens (no JWKS boot-race, unlike CSS)
 * and boots in ~1s. See notes/jss-evaluation.md.
 *
 * Differences from the CSS backend (test/headless/localCss.ts):
 * - Boot: `jss start --idp --conneg -p PORT -r DATADIR` (Turtle conneg on; data in
 *   a temp dir, wiped on stop). `TOKEN_SECRET` is pinned to a throwaway so JSS
 *   doesn't read/persist `~/.jss/token.secret`.
 * - Seed + auth: `POST /.pods {name,email,password}` returns the account's WebID
 *   AND a bearer token in one call, so `liveSession(slot)` just adds
 *   `Authorization: Bearer <token>` — no client-credentials / DPoP dance.
 * - WebIDs carry the `.jsonld` extension (`…/profile/card.jsonld#me`).
 */
import { LOCAL_CSS_PORT, LOCAL_SEED } from "../config/localSeed.ts";
import type { LiveSessionLike } from "./liveSession.ts";
import { verifyWebId } from "./webid.ts";
import type { LocalAccount, LocalPod } from "./localPod.ts";

const JSS_VERSION = "0.0.205";

/** PIDs with a LISTEN socket on `port`, via `ss`. Empty if none (or `ss` absent). */
async function listenersOnPort(port: number): Promise<number[]> {
  const out = await new Deno.Command("ss", {
    args: ["-ltnpH", `sport = :${port}`],
    stdout: "piped",
    stderr: "null",
  }).output().catch(() => null);
  if (!out?.success) return [];
  const pids = new Set<number>();
  for (const m of new TextDecoder().decode(out.stdout).matchAll(/pid=(\d+)/g)) {
    pids.add(Number(m[1]));
  }
  return [...pids];
}

/** SIGKILL anything still listening on `port`. A throwaway test port, so an
 * indiscriminate kill is fine — it's the backstop for a server that escaped the
 * process-group kill (e.g. JSS hung in `server.close()` on a keep-alive conn). */
async function killPortListeners(port: number): Promise<void> {
  for (const pid of await listenersOnPort(port)) {
    try {
      Deno.kill(pid, "SIGKILL");
    } catch { /* already gone */ }
  }
}

/** Reclaim `port` before boot: kill any stray listener, then wait until the port
 * is actually bindable again (the socket releases a beat after the process dies).
 * Stops a leftover server from a crashed/killed prior run from 409-ing the next
 * boot ("Pod already exists"), since JSS persists accounts outside the temp dir. */
async function freePort(port: number, deadlineMs = 5000): Promise<void> {
  await killPortListeners(port);
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

/** A session-like object whose fetch carries JSS's bearer token (no DPoP). */
function bearerSession(webId: string, token: string): LiveSessionLike {
  return {
    info: { webId, isLoggedIn: true },
    fetch: (input: string | URL, init: RequestInit = {}) => {
      const headers = new Headers(init.headers);
      headers.set("Authorization", `Bearer ${token}`);
      return fetch(input, { ...init, headers });
    },
    dispose: () => Promise.resolve(),
  };
}

/** Create a pod on the running JSS and capture its server-issued WebID + token. */
async function seedPod(
  baseUrl: string,
  seed: { email: string; password: string; pod: string },
): Promise<{ webId: string; token: string }> {
  const res = await fetch(`${baseUrl}.pods`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: seed.pod,
      email: seed.email,
      password: seed.password,
    }),
  });
  if (!res.ok) {
    throw new Error(`JSS POST /.pods (${seed.pod}) failed: HTTP ${res.status} ${await res.text()}`);
  }
  const body = await res.json() as { webId?: string; token?: string };
  if (!body.webId || !body.token) {
    throw new Error(`JSS POST /.pods (${seed.pod}) returned no webId/token`);
  }
  return { webId: body.webId, token: body.token };
}

/** Start a local JSS on `port`, seeded with accounts A and B; resolves when ready. */
export async function startJss(port = LOCAL_CSS_PORT): Promise<LocalPod> {
  const baseUrl = `http://localhost:${port}/`;
  // Reclaim the port before booting: a stray JSS from a crashed/force-killed prior
  // run would otherwise still answer the readiness probe AND already own accounts A/B,
  // so seeding 409s ("Pod already exists"). JSS keeps accounts outside `-r`, so a
  // fresh temp dir alone wouldn't save us — the old *process* has to go.
  await freePort(port);
  const dataDir = await Deno.makeTempDir({ prefix: "jss-it-" });

  const logPath = Deno.env.get("LOCAL_POD_LOG");
  const logFile = logPath
    ? await Deno.open(logPath, { write: true, create: true, append: true })
    : null;

  // Default: run the pinned npm release via npx. `JSS_BIN=<path to bin/jss.js>`
  // overrides it to run a LOCAL checkout instead (`node <bin> start …`) — used to
  // develop/verify JSS fixes against `deno task it:jss` before they're published.
  const jssBin = Deno.env.get("JSS_BIN");
  const jssArgs = ["start", "--idp", "--conneg", "-p", String(port), "-r", dataDir];
  const cmdArgs = jssBin
    ? ["node", jssBin, ...jssArgs]
    : ["npx", "--yes", "-p", `javascript-solid-server@${JSS_VERSION}`, "jss", ...jssArgs];

  // `setsid` puts JSS in its own process group so stop() kills the whole tree
  // (npx → node) at once. TOKEN_SECRET is pinned per-run so the throwaway server
  // never touches the user's persisted ~/.jss secret.
  const child = new Deno.Command("setsid", {
    args: cmdArgs,
    env: { TOKEN_SECRET: `jss-throwaway-${port}-0123456789abcdef` },
    stdout: "piped",
    stderr: "piped",
  }).spawn();

  // Continuously drain stdout/stderr (a full ~64 KB pipe buffer would block JSS).
  let errTail = "";
  const dec = new TextDecoder();
  const writeAll = async (f: Deno.FsFile, data: Uint8Array) => {
    for (let n = 0; n < data.length;) n += await f.write(data.subarray(n));
  };
  const pump = async (stream: ReadableStream<Uint8Array>, keep: boolean) => {
    for await (const chunk of stream) {
      if (keep) errTail = (errTail + dec.decode(chunk)).slice(-4000);
      if (logFile) await writeAll(logFile, chunk);
    }
  };
  pump(child.stdout, false).catch(() => {});
  pump(child.stderr, true).catch(() => {});

  // setsid exec'd into node, so child.pid IS the process-group leader → `-pid`
  // targets the whole npx→node tree at once.
  const killGroup = (sig: "TERM" | "KILL") =>
    new Deno.Command("kill", { args: [`-${sig}`, `-${child.pid}`] })
      .output().catch(() => {});

  const stop = async () => {
    // Graceful first: SIGTERM the group. But JSS's SIGTERM handler does
    // `await server.close()`, which hangs as long as a keep-alive connection (the
    // test browser's) stays open — so NEVER wait on exit unboundedly, or a hung
    // shutdown orphans node (the parent dies, node keeps the port, next boot 409s).
    // Give it a short grace period, then SIGKILL the group.
    await killGroup("TERM");
    try {
      child.kill("SIGTERM");
    } catch { /* already gone */ }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const exited = await Promise.race([
      child.status.then(() => true).catch(() => true),
      new Promise<false>((r) => {
        timer = setTimeout(() => r(false), 3000);
      }),
    ]);
    if (timer !== undefined) clearTimeout(timer);
    if (!exited) {
      await killGroup("KILL");
      try {
        child.kill("SIGKILL");
      } catch { /* already gone */ }
      await child.status.catch(() => {});
    }
    // Backstop: force-free the port in case a grandchild escaped the group kill.
    await killPortListeners(port);
    try {
      logFile?.close();
    } catch { /* already closed */ }
    await Deno.remove(dataDir, { recursive: true }).catch(() => {});
  };

  // Readiness: OIDC discovery is served once JSS is up (keys are ready at boot).
  const deadline = Date.now() + 60_000;
  let ready = false;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${baseUrl}.well-known/openid-configuration`);
      await r.body?.cancel();
      if (r.ok) {
        ready = true;
        break;
      }
    } catch { /* not up yet */ }
    await new Promise((res) => setTimeout(res, 250));
  }
  if (!ready) {
    await stop();
    throw new Error(`local JSS did not become ready on ${baseUrl}\n${errTail.slice(-1500)}`);
  }

  // Seed both accounts; JSS returns each WebID (`…/card.jsonld#me`) + a bearer token.
  // JSS serves OIDC discovery a beat before the `/.pods` route finishes mounting, so
  // on a warm (fast) boot the first POST can 404 — retry each seed briefly until it
  // lands (a 201 returns immediately, so a real conflict never loops).
  const seedWithRetry = async (
    seed: { email: string; password: string; pod: string },
  ): Promise<{ webId: string; token: string }> => {
    const deadline = Date.now() + 20_000;
    let lastErr: unknown;
    while (Date.now() < deadline) {
      try {
        return await seedPod(baseUrl, seed);
      } catch (e) {
        lastErr = e;
        await new Promise((r) => setTimeout(r, 300));
      }
    }
    throw lastErr;
  };
  let aSeed, bSeed;
  try {
    aSeed = await seedWithRetry(LOCAL_SEED.A);
    bSeed = await seedWithRetry(LOCAL_SEED.B);
  } catch (e) {
    await stop();
    throw e;
  }
  const mk = (
    seed: { email: string; password: string; pod: string },
    webId: string,
  ): LocalAccount => ({ email: seed.email, password: seed.password, pod: seed.pod, webId });
  const A = mk(LOCAL_SEED.A, aSeed.webId);
  const B = mk(LOCAL_SEED.B, bSeed.webId);

  const tokens: Record<"A" | "B", string> = { A: aSeed.token, B: bSeed.token };
  const liveSession = (slot: "A" | "B") =>
    Promise.resolve(bearerSession(slot === "B" ? B.webId : A.webId, tokens[slot]));

  // Solid-OIDC: confirm each WebID JSS issued authorizes this issuer. JSS hands the
  // WebID back from /.pods (the `webid` claim, not a constructed string), so this is
  // the spec's WebID-provider confirmation, not a sanity check on a template.
  const issuer = baseUrl.replace(/\/$/, "");
  await verifyWebId(A.webId, issuer);
  await verifyWebId(B.webId, issuer);

  return { baseUrl, A, B, stop, status: child.status, liveSession };
}
