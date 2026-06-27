import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { execSync } from "node:child_process";

function gitCommit(): string {
  try {
    // `--dirty` appends "-dirty" when the working tree has uncommitted changes,
    // so a local/dev build never claims to be the clean committed code.
    return execSync("git describe --always --dirty").toString().trim();
  } catch {
    return "unknown";
  }
}

export default defineConfig({
  // Relative asset URLs ("./assets/x"). With real-path routing (BrowserRouter),
  // index.html is served for every deep link, so a single deploy-agnostic build
  // must resolve assets at any subpath depth. The R-b inline `<head>` script in
  // index.html sets a runtime `<base href>` to the detected app root, against
  // which these relative URLs then resolve correctly (see
  // plans/plan-app-design-overhaul.md §5). Keep `base: "./"` paired with that
  // runtime base-href — do NOT switch to an absolute base.
  base: "./",
  define: {
    __APP_COMMIT__: JSON.stringify(gitCommit()),
  },
  plugins: [
    react(),
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (id.includes("@mui") || id.includes("@emotion")) {
            return "vendor-mui";
          }
          if (id.includes("recharts") || id.includes("d3-")) {
            return "vendor-charts";
          }
          if (id.includes("leaflet") || id.includes("react-leaflet")) {
            return "vendor-map";
          }
          if (id.includes("@inrupt")) return "vendor-rdf";
          // Keep the camera QR scanner (and its core-js polyfills) out of the
          // eager vendor chunk so it stays lazy-loaded with QrScanner.
          if (id.includes("html5-qrcode") || id.includes("core-js")) return;
          // xlsx (the community import parser) is dynamic-imported by
          // buildingImport.ts; let it stay in its own lazy chunk (a named
          // manualChunk here would override that and pull it eager). The export
          // side already does this via the exceljs rule below.
          if (id.includes("/xlsx/")) return;
          // exceljs (the styled-XLSX writer) is dynamic-imported by
          // buildingWorkbook.ts; keep it out of the eager vendor chunk so it
          // loads only when a user exports.
          if (id.includes("exceljs")) return "vendor-exceljs";
          return "vendor";
        },
      },
    },
  },
});
