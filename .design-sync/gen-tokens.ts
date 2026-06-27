// Generate authoritative MUI CSS custom properties from the app theme, for the
// design-sync tokens stylesheet (cfg.cssEntry). Deterministic from src/theme.ts —
// re-run on re-sync (it's listed as cfg.buildCmd). MUI v9 cssVariables mode.
import theme from "../src/theme.ts";
const t = theme as unknown as {
  generateStyleSheets: () => Array<Record<string, Record<string, unknown>>>;
};
let css = "/* Granergize theme tokens — generated from src/theme.ts (MUI cssVariables).\n" +
  "   Do not edit by hand; re-run `deno task ds:tokens`. */\n\n";
for (const sheet of t.generateStyleSheets()) {
  for (const [selector, decls] of Object.entries(sheet)) {
    if (!decls || typeof decls !== "object") continue;
    const body = Object.entries(decls)
      .filter(([, v]) => typeof v === "string" || typeof v === "number")
      .map(([k, v]) => `  ${k}: ${v};`)
      .join("\n");
    if (body) css += `${selector} {\n${body}\n}\n\n`;
  }
}
await Deno.writeTextFile(new URL("./theme-tokens.css", import.meta.url), css);
console.log(`wrote theme-tokens.css (${css.length} bytes)`);
