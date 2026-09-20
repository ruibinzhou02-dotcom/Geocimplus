import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  worker: { format: "es" },
  server: {
    proxy: {
      "/api": "http://127.0.0.1:8765",
      "/v2-data": "http://127.0.0.1:8766",
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
    rollupOptions: { input: { main: "index.html", v2: "v2.html" } },
  },
});
