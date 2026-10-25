import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// While developing the screens, `vite` serves them and forwards the API to a running server.
export default defineConfig({
  plugins: [react()],
  server: { proxy: { "/api": "http://127.0.0.1:8788" } },
  build: { outDir: "dist", sourcemap: false },
});
