/// <reference lib="deno.ns" />
/**
 * Boot a throwaway local Community Solid Server (CSS v7) with two seeded accounts
 * (A and B), for the headless cross-Pod interop integration test. Fast, isolated,
 * no network / Cloudflare; supports the CSS account API + client-credentials grant
 * that `getLiveSession` (test/headless/liveSession.ts) speaks.
 *
 * CSS is a Node app; we spawn it via `npx @solid/community-server` and poll until
 * ready. Data lives in a temp dir wiped on stop(). Credentials are fixed local
 * throwaways — nothing committed, nothing sensitive — and come from the shared
 * `test/config/localSeed.ts` so the browser "local" tier logs into the SAME ones.
 */
import { LOCAL_CSS_PORT, LOCAL_SEED } from "../config/localSeed.ts";
import { discoverWebId, getLiveSession } from "./liveSession.ts";
import { verifyWebId } from "./webid.ts";
import type { LocalAccount, LocalPod } from "./localPod.ts";

const CSS_VERSION = "^7";

/** Start a local CSS on `port`, seeded with accounts A and B; resolves when ready.
 *  The CSS backend of {@link startLocalPod} (test/headless/localPod.ts). */
export async function startCss(port = LOCAL_CSS_PORT): Promise<LocalPod> {
  const baseUrl = `http://localhost:${port}/`;
  const issuer = baseUrl.replace(/\/$/, "");

  const dataDir = await Deno.makeTempDir({ prefix: "css-it-" });
  const seedFile = `${dataDir}/seed.json`;
  await Deno.writeTextFile(
    seedFile,
    JSON.stringify(
      [LOCAL_SEED.A, LOCAL_SEED.B].map((a) => ({
        email: a.email,
        password: a.password,
        pods: [{ name: a.pod }],
      })),
    ),
  );

  // Diagnostic opt-in: `LOCAL_POD_LOG=<path>` tees CSS's FULL log (at `-l debug`) to
  // that file, appended across per-spec `/reset` restarts. Off by default — CSS runs
  // at `-l warn` and its log is drained-but-discarded, so a swallowed auth 401 ("no
  // applicable key found in JWKS", a 401/403 on a resource read) is otherwise
  // invisible. Set it to attribute Tier-3 read/write flakiness to the substrate.
  const logPath = Deno.env.get("LOCAL_POD_LOG");
  const logFile = logPath
    ? await Deno.open(logPath, { write: true, create: true, append: true })
    : null;

  // Default config includes the account API + client-credentials; -f points data
  // at our temp dir; -b fixes the base URL so seeded WebIDs use the right host.
  // `setsid` puts CSS in its own process group so stop() can kill the WHOLE tree
  // (npx → node) at once — killing just the npx child orphans the node server.
  const child = new Deno.Command("setsid", {
    args: [
      "npx",
      "--yes",
      `@solid/community-server@${CSS_VERSION}`,
      "-p",
      String(port),
      "-b",
      baseUrl,
      "-f",
      dataDir,
      "-l",
      logPath ? "debug" : "warn",
      "--seedConfig",
      seedFile,
    ],
    stdout: "piped",
    stderr: "piped",
  }).spawn();

  // CONTINUOUSLY drain CSS's stdout/stderr. If we leave them piped-but-unread, the
  // OS pipe buffer (~64 KB) fills under a real test run's request volume and CSS
  // BLOCKS on its own log writes — it hangs and every later request fails (a hard-
  // to-spot cascade). Keep only a rolling tail of stderr for the readiness error,
  // plus the full tee to logFile when LOCAL_POD_LOG is set.
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

  const stop = async () => {
    // setsid makes child.pid the process-group leader, so -pid targets the group.
    await new Deno.Command("kill", { args: ["-TERM", `-${child.pid}`] })
      .output().catch(() => {});
    try {
      child.kill("SIGTERM");
    } catch { /* already gone */ }
    await child.status.catch(() => {});
    try {
      logFile?.close();
    } catch { /* already closed */ }
    await Deno.remove(dataDir, { recursive: true }).catch(() => {});
  };

  // Poll readiness: OIDC discovery is served once CSS is up, and the account API
  // yields each seeded account's WebID once seeding is done. DISCOVER the WebID here
  // (CSS account API → `webIdLinks`) — the spec way — instead of constructing it.
  const deadline = Date.now() + 60_000;
  let discovered: { A: LocalAccount; B: LocalAccount } | undefined;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${baseUrl}.well-known/openid-configuration`);
      await r.body?.cancel();
      if (r.ok) {
        discovered = {
          A: {
            ...LOCAL_SEED.A,
            webId: await discoverWebId(issuer, LOCAL_SEED.A.email, LOCAL_SEED.A.password),
          },
          B: {
            ...LOCAL_SEED.B,
            webId: await discoverWebId(issuer, LOCAL_SEED.B.email, LOCAL_SEED.B.password),
          },
        };
        break;
      }
    } catch { /* not up / not seeded yet */ }
    await new Promise((res) => setTimeout(res, 500));
  }

  if (!discovered) {
    await stop();
    throw new Error(`local CSS did not become ready on ${baseUrl}\n${errTail.slice(-1500)}`);
  }
  const { A, B } = discovered;

  // Warm token verification before returning, as a hard readiness gate. Just after
  // boot the OIDC resource server transiently 401s ("no applicable key found in the
  // JSON Web Key Set") until it has cached its complete JWKS — which makes the FIRST
  // real (browser) request after login fail. We force the JWKS warm by driving one
  // authenticated round-trip to a 200.
  //
  // Crucially we retry the WHOLE client-credentials acquisition, not just the final
  // GET. Right after boot getLiveSession() ITSELF can throw — account login / mint /
  // token endpoint aren't all ready yet — and that throw used to be caught-and-
  // ignored, so warming was silently skipped and the JWKS race survived (the ~residual
  // Tier-3 write flakes were warmup never running, not warmup not helping). Loop the
  // entire flow until an authenticated GET 200s, or warn at the deadline (never wedge
  // boot — a warning that authed specs may flake beats a hung CSS).
  const cardDoc = A.webId.split("#")[0];
  const warmDeadline = Date.now() + 30_000;
  let warmed = false;
  while (!warmed && Date.now() < warmDeadline) {
    try {
      const s = await getLiveSession(issuer, A.email, A.password, A.webId);
      try {
        const r = await s.fetch(cardDoc);
        await r.body?.cancel();
        warmed = r.ok;
      } finally {
        await s.dispose();
      }
    } catch { /* not ready yet — retry the whole acquisition, not just the GET */ }
    if (!warmed) await new Promise((res) => setTimeout(res, 400));
  }
  if (!warmed) {
    console.error(
      `local CSS token-verification warmup never reached a 200 within 30s on ${baseUrl} ` +
        `— authenticated specs may flake on the JWKS boot race`,
    );
  }

  // Headless session via the CSS account API + client-credentials + DPoP.
  const liveSession = (slot: "A" | "B") => {
    const a = slot === "B" ? B : A;
    return getLiveSession(issuer, a.email, a.password, a.webId);
  };

  // Solid-OIDC: confirm each seeded WebID authorizes this issuer (the anti-spoofing
  // check the browser auth library does; the headless cc-flow otherwise skips it).
  await verifyWebId(A.webId, issuer);
  await verifyWebId(B.webId, issuer);

  return { baseUrl, A, B, stop, status: child.status, liveSession };
}
