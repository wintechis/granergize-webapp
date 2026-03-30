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
          return { id: path.join(chartJsReal, "dist/chart.js"), moduleSideEffects: false };
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
  server: {
    proxy: {
      "/weather-api": {
        target: "https://wetterdienst-rdf-adapter.deno.dev",
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
