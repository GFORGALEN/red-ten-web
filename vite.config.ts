import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  build: {
    target: "es2018",
    outDir: "dist/client",
    emptyOutDir: true
  }
});
