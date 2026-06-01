import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  // e2e/ and the Playwright config run under Node (Playwright), not the browser
  // app — exclude them from this browser-globals lint config.
  { ignores: ["dist", "e2e", "playwright.config.ts"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
    },
  },
  {
    // Typography discipline (components only). The app has a single 3-tier type
    // scale defined in src/theme.ts (heading / body / muted). Don't reintroduce
    // ad-hoc font sizes/weights in component sx/style — use a Typography
    // `variant` instead so everything renders through the scale.
    //
    // Scoped to *.tsx so theme.ts (the one legitimate place these live) and
    // other plain .ts files are exempt. Icon sizing via fontSize will also warn
    // here; prefer the icon `fontSize="small"`/"large" prop, or disable the rule
    // inline (with a reason) for the rare genuine exception.
    files: ["**/*.tsx"],
    rules: {
      "no-restricted-syntax": [
        "warn",
        {
          selector: "Property[key.name='fontSize']",
          message:
            "Avoid inline fontSize — use a Typography `variant` (the type scale lives in src/theme.ts). For icons, prefer the fontSize=\"small\"/\"large\" prop.",
        },
        {
          selector: "Property[key.name='fontWeight']",
          message:
            "Avoid inline fontWeight — use a Typography `variant` (headings in the scale are already weight 600). See src/theme.ts.",
        },
      ],
    },
  },
);
