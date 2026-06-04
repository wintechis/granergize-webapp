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
    // Widget-vocabulary discipline (UI conventions, see CLAUDE.md). Keep the app
    // plain and consistent by routing everyone through the shared building
    // blocks instead of reaching for raw MUI primitives:
    //   - Dialogs go through <Modal> (src/components/Modal.tsx) — one structure
    //     + one close-guard. Raw `Dialog*` is banned.
    //   - Loading uses the header NetworkActivityIndicator; no ad-hoc spinners
    //     in the app shell (Circular/LinearProgress banned).
    // Files that legitimately own these primitives are exempted just below.
    files: ["**/*.{ts,tsx}"],
    ignores: [
      "src/components/Modal.tsx", // the dialog wrapper
      "src/components/NetworkActivityIndicator.tsx", // the one allowed spinner + debug popup
      "src/App.tsx", // full-page route spinners (header not mounted)
      "src/pages/Agent.tsx",
      "src/pages/AggregatedView.tsx",
      "src/pages/index.tsx", // lazy-chunk Suspense fallback
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              // Barrel import: `import { Dialog } from "@mui/material"`.
              name: "@mui/material",
              importNames: [
                "Dialog",
                "DialogTitle",
                "DialogContent",
                "DialogContentText",
                "DialogActions",
                "CircularProgress",
                "LinearProgress",
              ],
              message:
                "Use the shared <Modal> wrapper for dialogs, and the header NetworkActivityIndicator for loading (see CLAUDE.md → UI conventions). Don't import MUI Dialog*/Progress directly.",
            },
          ],
          // Subpath imports: `import Dialog from "@mui/material/Dialog"`.
          patterns: [
            {
              group: [
                "@mui/material/Dialog",
                "@mui/material/DialogTitle",
                "@mui/material/DialogContent",
                "@mui/material/DialogContentText",
                "@mui/material/DialogActions",
                "@mui/material/CircularProgress",
                "@mui/material/LinearProgress",
              ],
              message:
                "Use the shared <Modal> wrapper for dialogs, and the header NetworkActivityIndicator for loading (see CLAUDE.md → UI conventions). Don't import MUI Dialog*/Progress directly.",
            },
          ],
        },
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
