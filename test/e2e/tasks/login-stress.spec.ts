import { expect, test } from "@playwright/test";
import { account } from "../helpers/login.ts";
import { resolveAccounts } from "../../config/resolve.ts";
import { freshPagesParallel } from "../helpers/twoPod.ts";
import { T } from "../helpers/timeouts.ts";

/**
 * DEBUG-ONLY stress harness for the intermittent JSS consent-stall flake.
 *
 * Two browsers logging into one JSS IdP at the same time can occasionally have one
 * login's consent step reject inside `provider.interactionFinished` — surfaced (post
 * PR-4, see ../../../javascript-solid-server/jss-upstream-prs.md) as a fast "Consent
 * failed" 500 page instead of the old 90 s hang. It hit once in a full suite and did
 * NOT recur in a single re-run, so this loops ONLY the concurrent-login path
 * (`freshPagesParallel([A, B])`) many times to raise the odds of catching it, with
 * the JSS log captured so the thrown error + stack is recoverable.
 *
 * It is GATED behind LOGIN_STRESS so it never runs in the normal sharing suite
 * (it's a diagnostic, not a regression gate). Run on JSS with the server log on:
 *
 *   LOGIN_STRESS=1 LOGIN_STRESS_N=20 \
 *   LOCAL_POD_LOG="$PWD/test-results/jss-login-stress.log" \
 *     deno task e2e:local:jss test/e2e/tasks/login-stress.spec.ts
 *
 * On failure: the iteration that broke is logged, and the JSS log holds the
 * matching "Consent error (post-hijack)" / "Login redirect error (post-hijack)"
 * entry with the real rejection.
 */

// Reuse the env helper shape the other tests use (process is the Playwright/Node host).
const ENV = (globalThis as { process?: { env: Record<string, string | undefined> } })
  .process?.env;
const STRESS = !!ENV?.LOGIN_STRESS;
const ITERATIONS = Number(ENV?.LOGIN_STRESS_N ?? "20");

const A = account("A");
const B = account("B");
// Only needs two logged-in accounts (no cross-Pod data handshake), so a plain
// two-account resolution — not an interoperating pair.
const pair = resolveAccounts({ count: 2 });

test.describe("login stress (concurrent two-pod login)", () => {
  test.skip(
    !STRESS,
    "Diagnostic only — set LOGIN_STRESS=1 (and run on JSS) to hammer the concurrent-login path.",
  );
  test.skip(!pair.ok, pair.ok ? "" : pair.reason);

  test("concurrent A+B logins all complete", async ({ browser }) => {
    // N parallel-login rounds, sequential between rounds. Budget generously: each
    // round is two ~OIDC logins overlapped, so scale the per-test timeout with N.
    test.setTimeout(ITERATIONS * T.testSharing);

    let completed = 0;
    for (let i = 1; i <= ITERATIONS; i++) {
      const sessions = await freshPagesParallel(browser, [A, B]);
      try {
        // login() resolves only once each app has loaded; assert the post-login
        // shell explicitly per page so a consent failure (which leaves the IdP
        // error page, app never reached) fails THIS round with its index.
        for (const s of sessions) {
          await expect(
            s.page.getByRole("button", { name: /Account menu/ }),
            `round ${i}/${ITERATIONS}: app shell after concurrent login`,
          ).toBeVisible({ timeout: T.action });
          s.guard.assertNoAppErrors();
        }
        completed = i;
      } finally {
        await Promise.all(sessions.map((s) => s.ctx.close().catch(() => {})));
      }
      console.log(`[login-stress] round ${i}/${ITERATIONS} ok`);
    }
    expect(completed).toBe(ITERATIONS);
  });
});
