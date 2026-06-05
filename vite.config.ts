import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "./",
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
