import { defineConfig } from "vite";
import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  base: "./",
  plugins: [tailwindcss()],
  server: {
    host: true,
    port: 5173,
    strictPort: true
  },
  build: {
    rollupOptions: {
      input: {
        index:                  resolve(__dirname, "index.html"),
        dashboard:              resolve(__dirname, "dashboard.html"),
        status:                 resolve(__dirname, "status.html"),   // ← NOVO: página mobile para unidades
        importador:             resolve(__dirname, "importador.html"),
        "semcas-index":         resolve(__dirname, "semcas-index.html"),
        "semcas-agua-completo": resolve(__dirname, "semcas-agua-completo.html"),
      },
      external: (id) => /^https?:\/\//.test(id)
    }
  }
});
