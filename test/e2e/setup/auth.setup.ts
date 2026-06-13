import { test as setup } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { account, loginInteractive } from "../helpers/login.ts";
import { authStateDir, authStatePath } from "../helpers/loginReuse.ts";

/**
 * Login-REUSE setup (runs as a project DEPENDENCY of the catalog when
 * E2E_LOGIN_REUSE is set): log each role in ONCE via the full interactive OIDC flow
 * and persist its Playwright `storageState`, so every spec restores the session
 * instead of re-running the ~40–50 s login. The dominant per-spec cost, paid 3×
 * total instead of ~22×.
 *
 * `loginInteractive` (not `login`) so it always drives the UI to MINT the session,
 * even though reuse is on. Requires `/wipe` resets (E2E_RESET=wipe): the saved IdP
 * cookie is only valid while this same pod server keeps running, which `/wipe`
 * guarantees (no restart) — see loginReuse.ts.
 */
mkdirSync(authStateDir(), { recursive: true });

for (const slot of ["A", "B", "C"] as const) {
  setup(`authenticate ${slot}`, async ({ browser }) => {
    setup.setTimeout(120_000); // a full OIDC login can be slow
    const acc = account(slot);
    const ctx = await browser.newContext();
    try {
      await loginInteractive(await ctx.newPage(), acc);
      await ctx.storageState({ path: authStatePath(slot), indexedDB: true });
    } finally {
      await ctx.close();
    }
  });
}
