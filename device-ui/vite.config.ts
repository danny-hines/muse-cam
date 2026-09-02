import { fileURLToPath, URL } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: fileURLToPath(new URL("../device/src/musecam/static", import.meta.url)),
    emptyOutDir: true,
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:8080",
      "/media": "http://127.0.0.1:8080",
      "/preview.mjpg": "http://127.0.0.1:8080",
    },
  },
});
