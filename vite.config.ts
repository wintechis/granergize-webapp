import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";
// Resolve the real (non-symlink) path so both our code and react-chartjs-2
// share exactly one Chart.js module across the .deno/.pnpm stores.
const chartJsReal = fs.realpathSync(path.resolve("node_modules/chart.js"));

export default defineConfig({
  base: "./",
  plugins: [
    react(),
    {
      // Force the bare "chart.js" specifier to the single canonical ESM file so
      // our code and react-chartjs-2 share exactly one Chart.js instance.
      name: "dedupe-chartjs",
      enforce: "pre",
      resolveId(id) {
        if (id === "chart.js") {
          return {
            id: path.join(chartJsReal, "dist/chart.js"),
            moduleSideEffects: false,
          };
        }
      },
    },
  ],
  optimizeDeps: {
    include: ["chart.js", "react-chartjs-2"],
  },
  resolve: {
    dedupe: ["chart.js"],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (id.includes("@mui") || id.includes("@emotion")) {
            return "vendor-mui";
          }
          if (id.includes("chart.js") || id.includes("react-chartjs-2")) {
            return "vendor-charts";
          }
          if (id.includes("leaflet") || id.includes("react-leaflet")) {
            return "vendor-map";
          }
          if (id.includes("@inrupt")) return "vendor-rdf";
          return "vendor";
        },
      },
    },
  },
  server: {
    proxy: {
      "/weather-api": {
        target: "https://wetterdienst-rdf-adapter.deno.dev/",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/weather-api/, ""),
        secure: true,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
          "Accept": "application/json",
        },
      },
    },
  },
});
