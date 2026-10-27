// js/compat/supabase-client.js
// Cliente Supabase compartilhado pela camada de compatibilidade (js/compat/*).
// URL e chave pública vêm de VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY (.env.local ou Vercel).
// A chave "anon" é pública por natureza (vai no navegador); o acesso é controlado pelas regras (RLS) do banco.
import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL || "https://zfhlxrywxolkimwjoadq.supabase.co";
const anonKey =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpmaGx4cnl3eG9sa2ltd2pvYWRxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMwNjYzNzUsImV4cCI6MjEwODY0MjM3NX0.2n4vz2bCKBWzI3kCoovvW08nez8UFPtRaC60qdNc84Q";

if (!url || !anonKey) {
  throw new Error("[Supabase] Defina VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no .env.local");
}

export const supabase = createClient(url, anonKey, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: "semcas-auth" },
});

// Cliente sem sessão persistida: usado para criar usuários sem derrubar o login do admin
// (equivalente ao "app secundário" que usuarios.js cria no Firebase).
export function createIsolatedClient() {
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, storageKey: `semcas-aux-${Date.now()}` },
  });
}
