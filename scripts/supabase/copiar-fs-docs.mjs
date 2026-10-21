/**
 * Copia os documentos do Firestore para public.fs_docs (camada de compatibilidade usada pelo app).
 * Preserva tipos: Timestamp → {"__ts": ISO}. Recarrega do zero a cada execução.
 * userRoles é regravado com o id do usuário no Supabase (procurado pelo e-mail).
 *
 * Uso:
 *   node --env-file=.env.local scripts/supabase/copiar-fs-docs.mjs
 */
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { getFirestore, collection, getDocs, getDoc, doc, Timestamp, DocumentReference, GeoPoint } from 'firebase/firestore';

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY (ex.: node --env-file=.env.local ...).');
  process.exit(1);
}

const BASES = ['artifacts/default-app-id/public/data', 'artifacts/controle-almoxarifado-semcas/public/data'];
const COLLECTIONS = [
  'unidades', 'controleAgua', 'controleGas', 'controleMateriais', 'estoqueAgua', 'estoqueGas',
  'socialCestaMov', 'socialCestaEstoque', 'socialEnxovalMov', 'socialEnxovalEstoque',
  'semcasHistDB', 'semcasAliases', 'userRoles', 'feriados', 'stats', 'entregas',
];
const DOCS_AVULSOS = [['chat', 'sala_principal']];

const headers = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' };

function encode(v) {
  if (v === null || v === undefined) return v ?? null;
  if (v instanceof Timestamp) return { __ts: v.toDate().toISOString() };
  if (v instanceof DocumentReference) return { __ref: v.path };
  if (v instanceof GeoPoint) return { __geo: [v.latitude, v.longitude] };
  if (Array.isArray(v)) return v.map(encode);
  if (typeof v === 'object') {
    const out = {};
    for (const [k, x] of Object.entries(v)) out[k] = encode(x);
    return out;
  }
  return v;
}

async function rest(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}${path}`, { ...options, headers: { ...headers, ...options.headers } });
  if (!res.ok) throw new Error(`${options.method || 'GET'} ${path}: ${res.status} ${await res.text()}`);
  return res;
}

async function inserir(rows) {
  for (let i = 0; i < rows.length; i += 500) {
    await rest('/rest/v1/fs_docs', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(rows.slice(i, i + 500)),
    });
  }
}

// e-mail → id do usuário no Supabase
const usuarios = await (await rest('/auth/v1/admin/users?per_page=1000')).json();
const uidPorEmail = new Map((usuarios.users || []).map((u) => [String(u.email).toLowerCase(), u.id]));

const app = initializeApp({
  apiKey: 'AIzaSyD7VCxaHo8veaHnM8RwY60EX_DEh3hOVHk',
  authDomain: 'controle-almoxarifado-semcas.firebaseapp.com',
  projectId: 'controle-almoxarifado-semcas',
});
await signInAnonymously(getAuth(app));
const db = getFirestore(app);

console.log('Limpando fs_docs...');
await rest('/rest/v1/fs_docs?col=not.is.null', { method: 'DELETE', headers: { Prefer: 'return=minimal' } });

let total = 0;
for (const base of BASES) {
  for (const nome of COLLECTIONS) {
    const col = `${base}/${nome}`;
    const snap = await getDocs(collection(db, col));
    if (!snap.size) continue;
    const rows = [];
    for (const d of snap.docs) {
      let id = d.id;
      const data = encode(d.data());
      if (nome === 'userRoles') {
        const novo = uidPorEmail.get(String(data.email || '').toLowerCase());
        if (!novo) {
          console.log(`  ! userRoles sem conta no Supabase: ${data.email}`);
          continue;
        }
        id = novo;
        data.uid = novo;
        data.firebaseUid = d.id;
      }
      rows.push({ col, id, data });
    }
    await inserir(rows);
    total += rows.length;
    console.log(`  ✓ ${col.padEnd(60)} ${rows.length}`);
  }
}
for (const [col, id] of DOCS_AVULSOS) {
  const s = await getDoc(doc(db, col, id));
  if (s.exists()) {
    await inserir([{ col, id, data: encode(s.data()) }]);
    total++;
    console.log(`  ✓ ${col}/${id}`);
  }
}

const res = await rest('/rest/v1/fs_docs?select=col', { method: 'HEAD', headers: { Prefer: 'count=exact', Range: '0-0' } });
const noBanco = Number(res.headers.get('content-range')?.split('/')[1] || 0);
console.log(`\nCopiados: ${total} | No Supabase: ${noBanco} ${total === noBanco ? '✓' : '✗ divergente'}`);
process.exit(total === noBanco ? 0 : 1);
