/**
 * Exporta coleções Firestore para JSONL (staging da migração Supabase).
 *
 * Uso (entra como visitante, só leitura; ou defina FB_EMAIL/FB_PASSWORD):
 *   node scripts/supabase/export-firestore.mjs
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, collection, getDocs } from 'firebase/firestore';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, 'out', 'export');
const BASE = process.env.FB_BASE || 'artifacts/default-app-id/public/data';

const firebaseConfig = {
  apiKey: 'AIzaSyD7VCxaHo8veaHnM8RwY60EX_DEh3hOVHk',
  authDomain: 'controle-almoxarifado-semcas.firebaseapp.com',
  projectId: 'controle-almoxarifado-semcas',
  storageBucket: 'controle-almoxarifado-semcas.firebasestorage.app',
  messagingSenderId: '916615427315',
  appId: '1:916615427315:web:6823897ed065c50d413386',
};

const COLLECTIONS = [
  'unidades',
  'controleAgua',
  'controleGas',
  'controleMateriais',
  'estoqueAgua',
  'estoqueGas',
  'socialCestaMov',
  'socialCestaEstoque',
  'socialEnxovalMov',
  'socialEnxovalEstoque',
  'semcasHistDB',
  'semcasAliases',
  'userRoles',
  'feriados',
  'stats',
];

const email = process.env.FB_EMAIL;
const password = process.env.FB_PASSWORD;


function serialize(value) {
  if (value == null) return value;
  if (typeof value?.toDate === 'function') return value.toDate().toISOString();
  if (typeof value?.toMillis === 'function') return new Date(value.toMillis()).toISOString();
  if (Array.isArray(value)) return value.map(serialize);
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = serialize(v);
    return out;
  }
  return value;
}

const app = initializeApp(firebaseConfig);
// Leitura é liberada para qualquer usuário autenticado (inclusive visitante anônimo)
if (email && password) await signInWithEmailAndPassword(getAuth(app), email, password);
else await signInAnonymously(getAuth(app));
const db = getFirestore(app);
mkdirSync(OUT_DIR, { recursive: true });

const manifest = { base: BASE, exportedAt: new Date().toISOString(), collections: {} };

for (const name of COLLECTIONS) {
  const snap = await getDocs(collection(db, `${BASE}/${name}`));
  const lines = [];
  for (const d of snap.docs) {
    lines.push(JSON.stringify({ id: d.id, ...serialize(d.data()) }));
  }
  const file = join(OUT_DIR, `${name}.jsonl`);
  writeFileSync(file, lines.join('\n') + (lines.length ? '\n' : ''), 'utf8');
  manifest.collections[name] = { docs: snap.size, file: `${name}.jsonl` };
  console.log(`✓ ${name}: ${snap.size} docs → ${file}`);
}

writeFileSync(join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`\nManifesto: ${join(OUT_DIR, 'manifest.json')}`);
process.exit(0);
