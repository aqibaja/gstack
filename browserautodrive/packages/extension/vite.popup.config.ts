import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const packageRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  base: "./",
  build: {
    emptyOutDir: false,
    outDir: path.join(packageRoot, "dist"),
    rollupOptions: {
      input: {
        popup: path.join(packageRoot, "popup/popup.html"),
      },
      output: {
        assetFileNames: "popup/assets/[name]-[hash][extname]",
        chunkFileNames: "popup/assets/[name]-[hash].js",
        entryFileNames: "popup/assets/[name]-[hash].js",
      },
    },
  },
});
