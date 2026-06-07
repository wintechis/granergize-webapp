/**
 * Which throwaway local Pod server the test tiers boot. Default `css` (Community
 * Solid Server); set `LOCAL_POD_SERVER=jss` to boot JavaScript Solid Server
 * instead. Runtime-agnostic (no Deno/Node APIs) so both the Deno boot scripts
 * (test/headless/*) and the Node/Playwright account registry import it.
 *
 * Selection is read fresh from the env each call so the same code path serves both
 * processes Playwright spawns (the test runner and the `webServer` pod script).
 */
import { getEnv } from "./env.ts";

export type PodServerKind = "css" | "jss";

export function podServerKind(): PodServerKind {
  return getEnv("LOCAL_POD_SERVER") === "jss" ? "jss" : "css";
}
