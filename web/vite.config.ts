import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  base: "./",
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    target: "esnext",
  },
  server: {
    proxy: {
      "/eth-rpc": {
        target: "http://127.0.0.1:8545",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/eth-rpc/, ""),
      },
    },
  },
});
