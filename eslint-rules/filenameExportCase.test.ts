/// <reference lib="deno.ns" />
// Unit test for the content-aware filename-case rule. Drives it through ESLint's
// flat `Linter` (which lets us set the filename — the rule keys off it) over small
// code fixtures, covering every classification branch that tripped up earlier
// iterations (default-exported value, JSX in a camelCase helper, error-class util,
// imperative null component, intent core, entry point).
import { strict as assert } from "node:assert";
import { Linter } from "eslint";
import tseslint from "typescript-eslint";
import rule from "./filenameExportCase.js";

const tsParser = tseslint.parser;

const linter = new Linter({ configType: "flat" });

/** Lint `code` as `filename`; returns the rule's warning messages (empty = clean). */
function warnings(code: string, filename: string): string[] {
  return linter
    .verify(code, {
      files: ["**/*.{ts,tsx}"],
      languageOptions: { parser: tsParser, parserOptions: { ecmaFeatures: { jsx: true } } },
      plugins: { local: { rules: { fc: rule } } },
      rules: { "local/fc": "warn" },
    }, filename)
    .map((m) => m.message);
}

const COMPONENT = `export function Widget() { return <div>hi</div>; }`;
const NULL_COMPONENT = `function Layer() { return null; }\nexport default Layer;`;
const VALUE_MODULE = `export function doThing() { return 1; }\nexport const N = 2;`;
const DEFAULT_VALUE = `const theme = { a: 1 };\nexport default theme;`;
const JSX_IN_HELPER = `export function makeFields() { return [<input key="a" />]; }`;
const ERROR_CLASS = `export class SessionExpiredError extends Error {}\nexport function load() {}`;
const CORE = `export async function createThingCore() {}\nexport interface CreateThingParams {}`;

const cases: Array<[string, string, string, boolean]> = [
  // [label, code, filename, expectWarning]
  ["component in PascalCase file", COMPONENT, "src/components/Widget.tsx", false],
  ["component in camelCase file", COMPONENT, "src/components/widget.tsx", true],
  ["imperative null-component (default) PascalCase", NULL_COMPONENT, "src/components/Layer.tsx", false],
  ["imperative null-component (default) camelCase", NULL_COMPONENT, "src/components/layer.tsx", true],
  ["value module in camelCase file", VALUE_MODULE, "src/lib/doThing.ts", false],
  ["value module wearing PascalCase name", VALUE_MODULE, "src/lib/DoThing.ts", true],
  ["default-exported camelCase value", DEFAULT_VALUE, "src/theme.ts", false],
  ["JSX returned by a camelCase helper (.tsx, still a module)", JSX_IN_HELPER, "src/components/makeFields.tsx", false],
  ["…the same helper wrongly PascalCased", JSX_IN_HELPER, "src/components/MakeFields.tsx", true],
  ["error-class util stays camelCase", ERROR_CLASS, "src/services/podWrite.ts", false],
  ["intent core is PascalCase by path", CORE, "src/intents/cores/building/CreateThing.ts", false],
  ["intent core wrongly camelCase", CORE, "src/intents/cores/building/createThing.ts", true],
  ["entry point main.tsx exempt", COMPONENT, "src/main.tsx", false],
];

for (const [label, code, filename, expectWarn] of cases) {
  Deno.test(`filenameExportCase: ${label}`, () => {
    const w = warnings(code, filename);
    assert.equal(
      w.length > 0,
      expectWarn,
      `expected ${expectWarn ? "a warning" : "no warning"} for ${filename}, got: ${JSON.stringify(w)}`,
    );
  });
}
