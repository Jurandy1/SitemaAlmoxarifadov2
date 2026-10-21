/**
 * Migra os usuários com permissão (Firestore userRoles) para o Supabase Auth + public.profiles.
 * Cria cada conta já com e-mail confirmado e a senha padrão informada; o usuário troca depois.
 *
 * Uso:
 *   $env:SUPABASE_URL="https://xxxx.supabase.co"
 *   $env:SUPABASE_SERVICE_ROLE_KEY="..."   (Project Settings → API → service_role — não versionar)
 *   node scripts/supabase/migrar-usuarios.mjs --senha <senha-padrao>          (simulação)
 *   node scripts/supabase/migrar-usuarios.mjs --senha <senha-padrao> --apply  (grava)
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { getFirestore, collection, getDocs } from 'firebase/firestore';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, 'out');
const BASE = 'artifacts/default-app-id/public/data';

const firebaseConfig = {
  apiKey: 'AIzaSyD7VCxaHo8veaHnM8RwY60EX_DEh3hOVHk',
  authDomain: 'controle-almoxarifado-semcas.firebaseapp.com',
  projectId: 'controle-almoxarifado-semcas',
};

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const senhaIdx = args.indexOf('--senha');
const SENHA = senhaIdx >= 0 ? args[senhaIdx + 1] : process.env.SENHA_PADRAO;
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SENHA || SENHA.length < 6) {
  console.error('Informe a senha padrão: --senha <senha> (mínimo 6 caracteres, exigência do Supabase).');
  process.exit(1);
}
if (APPLY && (!SUPABASE_URL || !SERVICE_KEY)) {
  console.error('Para gravar, defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}

// Firebase usa admin/editor/anon; o schema Supabase usa admin/editor/viewer
const ROLE_MAP = { admin: 'admin', editor: 'editor', anon: 'viewer' };

const headers = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  'Content-Type': 'application/json',
};

async function api(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}${path}`, { ...options, headers: { ...headers, ...options.headers } });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { ok: res.ok, status: res.status, body };
}

async function findUserByEmail(email) {
  for (let page = 1; page <= 20; page++) {
    const r = await api(`/auth/v1/admin/users?page=${page}&per_page=100`);
    if (!r.ok) throw new Error(`Falha ao listar usuários: ${r.status} ${JSON.stringify(r.body)}`);
    const users = r.body?.users || [];
    const hit = users.find((u) => String(u.email || '').toLowerCase() === email.toLowerCase());
    if (hit) return hit;
    if (users.length < 100) return null;
  }
  return null;
}

async function criarOuObterUsuario(email, firebaseUid) {
  const r = await api('/auth/v1/admin/users', {
    method: 'POST',
    body: JSON.stringify({
      email,
      password: SENHA,
      email_confirm: true,
      user_metadata: { firebase_uid: firebaseUid, must_change_password: true },
    }),
  });
  if (r.ok) return { user: r.body, criado: true };
  // Já existe: reaproveita (não altera a senha de quem já migrou)
  const existente = await findUserByEmail(email);
  if (existente) return { user: existente, criado: false };
  throw new Error(`Falha ao criar ${email}: ${r.status} ${JSON.stringify(r.body)}`);
}

async function salvarPerfil(id, email, role) {
  const r = await api('/rest/v1/profiles?on_conflict=id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ id, email, role, updated_at: new Date().toISOString() }),
  });
  if (!r.ok) throw new Error(`Falha ao salvar perfil de ${email}: ${r.status} ${JSON.stringify(r.body)}`);
}

const app = initializeApp(firebaseConfig);
await signInAnonymously(getAuth(app));
const snap = await getDocs(collection(getFirestore(app), `${BASE}/userRoles`));

const usuarios = snap.docs
  .map((d) => ({ uid: d.data().uid || d.id, email: String(d.data().email || '').trim(), roleFb: d.data().role }))
  .filter((u) => u.email);

console.log(`${usuarios.length} usuário(s) com permissão no Firebase.${APPLY ? '' : ' (SIMULAÇÃO — use --apply para gravar)'}\n`);

const linhas = ['email,papel_firebase,papel_supabase,resultado'];
let erros = 0;
for (const u of usuarios) {
  const role = ROLE_MAP[u.roleFb] || 'viewer';
  let resultado = 'simulado';
  if (APPLY) {
    try {
      const { user, criado } = await criarOuObterUsuario(u.email, u.uid);
      await salvarPerfil(user.id, u.email, role);
      resultado = criado ? 'criado' : 'já existia (perfil atualizado)';
    } catch (e) {
      resultado = `ERRO: ${e.message}`;
      erros++;
    }
  }
  console.log(`  ${u.email.padEnd(40)} ${String(u.roleFb).padEnd(7)} → ${role.padEnd(7)} ${resultado}`);
  linhas.push([u.email, u.roleFb, role, `"${resultado.replace(/"/g, "'")}"`].join(','));
}

mkdirSync(OUT_DIR, { recursive: true });
const csvPath = join(OUT_DIR, 'migracao-usuarios.csv');
writeFileSync(csvPath, linhas.join('\n'), 'utf8');
console.log(`\nRelatório: ${csvPath}`);
process.exit(erros ? 1 : 0);
