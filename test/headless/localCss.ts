/// <reference lib="deno.ns" />
/**
 * Boot a throwaway local Community Solid Server (CSS v7) with two seeded accounts
 * (A and B), for the headless cross-Pod interop integration test. Fast, isolated,
 * no network / Cloudflare; supports the CSS account API + client-credentials grant
 * that `getLiveSession` (scripts/liveSession.ts) speaks.
 *
 * CSS is a Node app; we spawn it via `npx @solid/community-server` and poll until
 * ready. Data lives in a temp dir wiped on stop(). Credentials are fixed local
 * throwaways — nothing committed, nothing sensitive — and come from the shared
 * `test/config/localSeed.ts` so the browser "local" tier logs into the SAME ones.
 */
import { LOCAL_CSS_PORT, LOCAL_SEED } from "../config/localSeed.ts";

const CSS_VERSION = "^7";

export interface LocalAccount {
  email: string;
  password: string;
  pod: string;
  webId: string;
}

export interface LocalCss {
  baseUrl: string;
  A: LocalAccount;
  B: LocalAccount;
  stop: () => Promise<void>;
  /** Resolves when the CSS process exits — watch it to fail-fast if it dies. */
  status: Promise<Deno.CommandStatus>;
}

/** Start a local CSS on `port`, seeded with accounts A and B; resolves when ready. */
export async function startLocalCss(port = LOCAL_CSS_PORT): Promise<LocalCss> {
  const baseUrl = `http://localhost:${port}/`;
  const mk = (email: string, password: string, pod: string): LocalAccount => ({
    email,
    password,
    pod,
    webId: `${baseUrl}${pod}/profile/card#me`,
  });
  const A = mk(LOCAL_SEED.A.email, LOCAL_SEED.A.password, LOCAL_SEED.A.pod);
  const B = mk(LOCAL_SEED.B.email, LOCAL_SEED.B.password, LOCAL_SEED.B.pod);

  const dataDir = await Deno.makeTempDir({ prefix: "css-it-" });
  const seedFile = `${dataDir}/seed.json`;
  await Deno.writeTextFile(
    seedFile,
    JSON.stringify(
      [A, B].map((a) => ({
        email: a.email,
        password: a.password,
        pods: [{ name: a.pod }],
      })),
    ),
  );

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
      "warn",
      "--seedConfig",
      seedFile,
    ],
    stdout: "piped",
    stderr: "piped",
  }).spawn();

  // CONTINUOUSLY drain CSS's stdout/stderr. If we leave them piped-but-unread, the
  // OS pipe buffer (~64 KB) fills under a real test run's request volume and CSS
  // BLOCKS on its own log writes — it hangs and every later request fails (a hard-
  // to-spot cascade). Keep only a rolling tail of stderr for the readiness error.
  let errTail = "";
  const dec = new TextDecoder();
  const pump = async (stream: ReadableStream<Uint8Array>, keep: boolean) => {
    for await (const chunk of stream) {
      if (keep) errTail = (errTail + dec.decode(chunk)).slice(-4000);
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
    await Deno.remove(dataDir, { recursive: true }).catch(() => {});
  };

  // Poll readiness: the OIDC discovery doc is served once CSS is up + seeded.
  const deadline = Date.now() + 60_000;
  let ready = false;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${baseUrl}.well-known/openid-configuration`);
      if (r.ok) {
        await r.body?.cancel();
        // Confirm a seeded WebID profile is actually readable (seeding done).
        const p = await fetch(A.webId);
        if (p.ok) {
          await p.body?.cancel();
          ready = true;
          break;
        }
        await p.body?.cancel();
      } else {
        await r.body?.cancel();
      }
    } catch { /* not up yet */ }
    await new Promise((res) => setTimeout(res, 500));
  }

  if (!ready) {
    await stop();
    throw new Error(`local CSS did not become ready on ${baseUrl}\n${errTail.slice(-1500)}`);
  }

  return { baseUrl, A, B, stop, status: child.status };
}
