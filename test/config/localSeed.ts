/**
 * Fixtures shared by the browser "local" tier (E2E_LOCAL=1): the throwaway CSS
 * port and its two seeded password accounts. BOTH the CSS boot
 * (test/headless/localCss.ts) and the account registry (accounts.ts) read these,
 * so the credentials the browser logs in with can't drift from the ones the server
 * is seeded with. Runtime-agnostic (no Deno/Node APIs) so either side can import it.
 */
import { localProvider, type PodProvider } from "./providers.ts";

export const LOCAL_CSS_PORT = 3456;
export const LOCAL_CSS_BASE = `http://localhost:${LOCAL_CSS_PORT}/`;

/** A seeded CSS account: email+password login + its pod name (→ derived WebID). */
export interface LocalSeedAccount {
  email: string;
  password: string;
  pod: string;
}

/** The two accounts startLocalCss() seeds, keyed to the spec slots A and B. */
export const LOCAL_SEED: Record<"A" | "B", LocalSeedAccount> = {
  A: { email: "a@test.local", password: "alice-pw-12345", pod: "alice" },
  B: { email: "b@test.local", password: "bob-pw-12345", pod: "bob" },
};

/** The browser-OIDC provider for the booted local CSS (login via the CSS UI). */
export function localBrowserProvider(): PodProvider {
  return localProvider(LOCAL_CSS_BASE, "browser-oidc");
}
