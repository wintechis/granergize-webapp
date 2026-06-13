import { type Browser, type Page } from "@playwright/test";
import { appendFileSync } from "node:fs";
import { account, type SolidAccount } from "./login.ts";
import { reuseContextOptions } from "./loginReuse.ts";

/**
 * Append a page's console errors/warnings + uncaught page errors to a per-run log
 * file, so the same app instrumentation (`logError` → `[granergize] …`, the
 * `[notify] …` error mirror) is captured for EVERY test — not just the failures
 * Playwright traces. This is what makes a Tier-3-local vs Tier-4-remote run
 * cross-referenceable: both write their console stream to one greppable file.
 *
 * The target file is `E2E_CONSOLE_LOG` (an absolute or cwd-relative path the run
 * sets); no-op when it's unset, so normal runs are unaffected. `tag` labels the
 * source (e.g. the account slot "A"/"B") so interleaved A/B lines stay attributable.
 */
export function captureConsole(page: Page, tag = ""): void {
  const file = process.env.E2E_CONSOLE_LOG;
  if (!file) return;
  const write = (line: string) => {
    try {
      appendFileSync(file, `${new Date().toISOString()} [${tag}] ${line}\n`);
    } catch (err) {
      console.error("[consoleLog] append failed:", err);
    }
  };
  page.on("console", (m) => {
    const t = m.type();
    if (t === "error" || t === "warning") write(`${t}: ${m.text()}`);
  });
  page.on("pageerror", (e) => write(`pageerror: ${e.message}`));
}

/**
 * Emit a harness-side line into the SAME per-run console log the page streams go to
 * (and to stdout), so test-driven notes — clean-slate listings, residue warnings —
 * interleave with the app's `[granergize]`/`[notify]` lines in one cross-referenceable
 * file. No-op file write when E2E_CONSOLE_LOG is unset; always echoes to stdout.
 */
export function logRun(line: string): void {
  const stamped = `${new Date().toISOString()} [harness] ${line}`;
  console.log(stamped);
  const file = process.env.E2E_CONSOLE_LOG;
  if (!file) return;
  try {
    appendFileSync(file, stamped + "\n");
  } catch (err) {
    console.error("[consoleLog] logRun append failed:", err);
  }
}

/**
 * A page + console capture in one call — the solo specs' page factory (they create
 * one page per file in `beforeAll`), mirroring how the duo/trio specs get capture
 * through `twoPod`'s `newSession`. `tag` is the spec name so its console lines are
 * attributable in the shared per-run log.
 *
 * In login-REUSE mode the context is seeded with `acc`'s saved session (default
 * Alice, since solo specs are single-account) so `login()` silently restores instead
 * of driving the OIDC UI. Off mode → a plain `browser.newPage()` (whose context
 * auto-closes with the page). When seeded we own the context, so close it with the
 * page to avoid leaking one per spec file.
 */
export async function newCapturedPage(
  browser: Browser,
  tag = "",
  acc: SolidAccount = account("A"),
): Promise<Page> {
  const opts = reuseContextOptions(acc);
  if (Object.keys(opts).length === 0) {
    const page = await browser.newPage();
    captureConsole(page, tag);
    return page;
  }
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  page.on("close", () => void ctx.close().catch(() => {}));
  captureConsole(page, tag);
  return page;
}
