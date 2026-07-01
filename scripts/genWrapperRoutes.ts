/**
 * Generate the typed **route contract** for a wrapper from its LIVE `/routes` manifest — the
 * "option C" source of truth: the running service, not a checked-in copy of `web.xml`. The app
 * references wrapper routes through the generated union (e.g. `MASTR_ROUTES` in `mastrNearby.ts`),
 * so a renamed/removed endpoint becomes a compile error (`deno task check`) instead of a silent
 * 404 found only by the remote contract lane. See explore/explore-wrapper-contract-drift.md.
 *
 *   deno task gen:routes:<id>          # regenerate src/generated/<id>.routes.ts from live
 *   deno task gen:routes:<id>:check    # CI gate: regenerate to memory, fail if it differs
 *   deno run -A scripts/genWrapperRoutes.ts <id> --webxml <path-to-web.xml>   # offline bootstrap
 */
import { sourceBase } from "../src/constants/dataSources.ts";
import type { SourceId } from "../src/constants/dataSources.ts";

const SUFFIXES = [".ttl", ".nt", ".rdf", ".jsonld", ".geojson", ".json", ".html"];

const args = Deno.args;
const check = args.includes("--check");
const webxmlIdx = args.indexOf("--webxml");
const webxmlPath = webxmlIdx >= 0 ? args[webxmlIdx + 1] : undefined;
const id = args.find((a) => !a.startsWith("--") && a !== webxmlPath);
if (!id) {
  console.error("usage: genWrapperRoutes.ts <id> [--check] [--webxml <path>]");
  Deno.exit(2);
}
const OUT = new URL(`../src/generated/${id}.routes.ts`, import.meta.url);
const TYPE = id.split(/[^a-z0-9]+/i).filter(Boolean)
  .map((w) => w[0].toUpperCase() + w.slice(1)).join("") + "Route";

/** A raw url-pattern → its logical route (mirrors the wrapper's RoutesServlet.logicalRoutes). */
function reduce(pattern: string): string | null {
  let r = pattern.startsWith("/") ? pattern.slice(1) : pattern;
  if (r.endsWith("/*")) r = r.slice(0, -2);
  else {
    const dot = r.lastIndexOf(".");
    if (dot > 0 && SUFFIXES.includes(r.slice(dot))) r = r.slice(0, dot);
  }
  return r && !r.includes("*") ? r : null;
}

async function liveRoutes(): Promise<string[]> {
  const url = `${sourceBase(id as SourceId)}routes.json`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  // The manifest is a name array (older wrapper) or {name,formats,params} objects — the route
  // union only needs the names.
  const body = await res.json() as { routes?: (string | { name?: string })[] };
  const names = (body.routes ?? [])
    .map((r) => (typeof r === "string" ? r : r.name))
    .filter((n): n is string => !!n);
  return [...new Set(names)].sort();
}

function webxmlRoutes(xml: string): string[] {
  const pats = [...xml.matchAll(/<url-pattern>([^<]+)<\/url-pattern>/g)].map((m) => m[1]);
  return [...new Set(pats.map(reduce).filter((r): r is string => !!r))].sort();
}

function render(routes: string[]): string {
  return `// GENERATED from the live linked-${id} /routes manifest — DO NOT EDIT BY HAND.
// Regenerate: deno task gen:routes:${id}  ·  Verify in CI: deno task gen:routes:${id}:check
// The union is the wrapper's DEPLOYED endpoint set; a renamed/removed route breaks the app's
// compile at the use site.
export type ${TYPE} =
${routes.map((r) => `  | ${JSON.stringify(r)}`).join("\n")};
`;
}

const routes = webxmlIdx >= 0
  ? webxmlRoutes(await Deno.readTextFile(args[webxmlIdx + 1]))
  : await liveRoutes();
if (routes.length === 0) {
  console.error("gen-routes: no routes resolved — refusing to write an empty contract");
  Deno.exit(2);
}

const next = render(routes);
if (check) {
  const current = await Deno.readTextFile(OUT).catch(() => "");
  if (current !== next) {
    console.error(
      `gen-routes: src/generated/${id}.routes.ts is STALE vs the live wrapper.\n` +
        `Run \`deno task gen:routes:${id}\` and fix any compile errors.`,
    );
    Deno.exit(1);
  }
  console.log(`gen-routes: ${id}.routes.ts matches the live wrapper ✓`);
} else {
  await Deno.writeTextFile(OUT, next);
  console.log(`gen-routes: wrote ${OUT.pathname} (${routes.length} routes)`);
}
