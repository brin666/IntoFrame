import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        subjectExperiment: resolve(__dirname, "experiment.html"),
        submissionDemo: resolve(__dirname, "demo.html"),
      },
    },
  },
  server: {
    port: 5187,
    strictPort: true,
    watch: { ignored: ["**/.edge-preview/**", "**/screenshots/**", "**/backend/data/**"] },
    proxy: {
      "/api": "http://127.0.0.1:8000",
      "/media": "http://127.0.0.1:8000",
    },
  },
});
