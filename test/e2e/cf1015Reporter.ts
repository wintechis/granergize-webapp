import type { Reporter } from "@playwright/test/reporter";
import { CF_1015_SENTINEL } from "./helpers/cloudflare1015.ts";

/**
 * Exit the whole Playwright run the moment a worker reports a Cloudflare Error
 * 1015 (see cloudflareGuard.ts). The watcher writes CF_1015_SENTINEL to the
 * worker's stderr; Playwright forwards worker stdio to reporters live, and this
 * reporter runs in the MAIN process — so calling process.exit here tears down the
 * entire `playwright test` invocation (the "spec runner") at once, instead of
 * letting it grind through every remaining spec's retries and multi-minute
 * timeouts against the rate-limited host.
 */
class Cf1015Reporter implements Reporter {
  private bail(chunk: string | Buffer): void {
    if (!chunk.toString().includes(CF_1015_SENTINEL)) return;
    process.stderr.write(
      "\n✖ Cloudflare Error 1015 detected — host is rate limited. " +
        "Aborting the run (retry later, or against an unthrottled Pod).\n",
    );
    process.exit(2);
  }
  onStdErr(chunk: string | Buffer): void {
    this.bail(chunk);
  }
  onStdOut(chunk: string | Buffer): void {
    this.bail(chunk);
  }
}

export default Cf1015Reporter;
