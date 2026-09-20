import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Tauri expects a fixed dev server port and a clean console.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: {
    port: 5183,
    strictPort: true,
    // Don't let Vite's watcher crawl the Rust build output (src-tauri/target),
    // whose compiled .dll/.exe are often locked on Windows and crash the watcher.
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  build: {
    target: "esnext",
    outDir: "dist",
  },
});
