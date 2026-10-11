import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: { host: "127.0.0.1", port: 1431, strictPort: true, open: false },
  build: { outDir: "dist-demo", rollupOptions: { input: "demo.html" } },
});
