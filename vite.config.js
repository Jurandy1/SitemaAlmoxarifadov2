import { defineConfig, loadEnv } from "vite";
import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";

// O site roda só no Supabase: o SDK do Firebase é trocado pela camada de compatibilidade em js/compat/
// (o código do app continua importando "firebase/*"). VITE_BACKEND=firebase volta ao Firebase (só emergência).
function backendAliases(mode) {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  if (env.VITE_BACKEND === "firebase") return {};
  return {
    "firebase/app": resolve(__dirname, "js/compat/firebase-app.js"),
    "firebase/auth": resolve(__dirname, "js/compat/firebase-auth.js"),
    "firebase/firestore": resolve(__dirname, "js/compat/firebase-firestore.js"),
    "firebase/storage": resolve(__dirname, "js/compat/firebase-storage.js"),
  };
}

export default defineConfig(({ mode }) => ({
  base: "./",
  plugins: [tailwindcss()],
  resolve: { alias: backendAliases(mode) },
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
}));
