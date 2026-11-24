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

// Identificação do computador para a Auditoria (o banco grava estes cabeçalhos em cada exclusão).
// O navegador não revela o IP interno nem o nome da máquina, então cada navegador ganha um id fixo
// e o admin pode dar um nome a ele na tela de Auditoria.
export const DISPOSITIVO_ID_KEY = "semcas-dispositivo-id";
export const DISPOSITIVO_NOME_KEY = "semcas-dispositivo-nome";

function lerOuCriarDispositivo() {
  let id = "";
  let nome = "";
  try {
    id = localStorage.getItem(DISPOSITIVO_ID_KEY) || "";
    if (!id) {
      const rnd = Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => b.toString(16).padStart(2, "0")).join("");
      id = `PC-${rnd.toUpperCase()}`;
      localStorage.setItem(DISPOSITIVO_ID_KEY, id);
    }
    nome = localStorage.getItem(DISPOSITIVO_NOME_KEY) || "";
  } catch (_) {}
  return { id, nome };
}

const dispositivo = lerOuCriarDispositivo();
const dispositivoHeaders = {};
if (dispositivo.id) dispositivoHeaders["x-dispositivo-id"] = dispositivo.id;
if (dispositivo.nome) dispositivoHeaders["x-dispositivo-nome"] = encodeURIComponent(dispositivo.nome);

export function getDispositivoAtual() {
  return { ...dispositivo };
}

export const supabase = createClient(url, anonKey, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: "semcas-auth" },
  global: { headers: dispositivoHeaders },
});

// Cliente sem sessão persistida: usado para criar usuários sem derrubar o login do admin
// (equivalente ao "app secundário" que usuarios.js cria no Firebase).
export function createIsolatedClient() {
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, storageKey: `semcas-aux-${Date.now()}` },
  });
}
