/**
 * Restaura requisições marcadas deleted por unidade inválida (mapeamentos corrigidos).
 * Uso: FB_EMAIL=... FB_PASSWORD=... node scripts/restaurar-requisicoes-unidades.mjs
 *      FB_EMAIL=... FB_PASSWORD=... node scripts/restaurar-requisicoes-unidades.mjs --apply
 */
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, collection, getDocs, doc, writeBatch, getDoc, setDoc, query, orderBy } from 'firebase/firestore';

const APPLY = process.argv.includes('--apply');
const BASE = 'artifacts/default-app-id/public/data';

const firebaseConfig = {
  apiKey: 'AIzaSyD7VCxaHo8veaHnM8RwY60EX_DEh3hOVHk',
  authDomain: 'controle-almoxarifado-semcas.firebaseapp.com',
  projectId: 'controle-almoxarifado-semcas',
  storageBucket: 'controle-almoxarifado-semcas.firebasestorage.app',
  messagingSenderId: '916615427315',
  appId: '1:916615427315:web:6823897ed065c50d413386',
};

const MANUAL_RAW = [
  ['CRAS VINHAIS', 'Cras Vinhas'],
  ['CRAS TERRITÓRIO 2 – BAIRRO DE FÁTIMA', 'Cras Bairro De Fatima'],
  ['CRAS BAIRRO DE FÁTIMA', 'Cras Bairro De Fatima'],
  ['COORDENAÇÃO DE TRANSPORTE', 'Diretoria Técnica De Transporte'],
  ['SUPERINTENDÊNCIA DE ADMINISTRAÇÃO', 'SuperintendêNcia De AdministraçãO'],
  ['SUPERINTENDÊNCIA ADMINISTRATIVA - SA', 'SuperintendêNcia De AdministraçãO'],
];
const MANUAL_PREFIX = MANUAL_RAW.map(([a, b]) => [key(a), b]);

const email = process.env.FB_EMAIL;
const password = process.env.FB_PASSWORD;
if (!email || !password) {
  console.error('Defina FB_EMAIL e FB_PASSWORD');
  process.exit(1);
}

function rmAcc(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
function key(s) {
  return rmAcc(s).toUpperCase().replace(/\s+/g, ' ').trim();
}

function cleanUnitName(raw) {
  return String(raw || '')
    .replace(/\d{1,2}[\/.]\d{1,2}[\/.]?\d{0,4}.*/gi, '')
    .replace(/\bentrega\b.*/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const app = initializeApp(firebaseConfig);
await signInWithEmailAndPassword(getAuth(app), email, password);
const db = getFirestore(app);

const unidadesSnap = await getDocs(collection(db, `${BASE}/unidades`));
const registered = unidadesSnap.docs.map((d) => {
  const u = d.data();
  return String(u.nome || u.unidadeNome || '').trim();
}).filter(Boolean);
const registeredKeys = new Set(registered.map(key));

const aliasSnap = await getDoc(doc(db, `${BASE}/semcasAliases`, 'config'));
const aliases = aliasSnap.exists() ? (aliasSnap.data()?.aliases || {}) : {};

function findRegistered(targetName) {
  if (!targetName) return null;
  return registered.find((r) => key(r) === key(targetName)) || null;
}

function resolveUnit(raw) {
  if (!raw) return null;
  const seen = new Set();
  const candidates = [];
  for (const c of [String(raw).trim(), cleanUnitName(raw)]) {
    if (!c || seen.has(key(c))) continue;
    seen.add(key(c));
    candidates.push(c);
  }

  for (const s of candidates) {
    const k = key(s);
    if (aliases[k]) {
      const hit = findRegistered(aliases[k]);
      if (hit) return hit;
    }
    for (const [prefix, target] of MANUAL_PREFIX) {
      if (k === prefix || k.startsWith(prefix + ' ') || k.startsWith(prefix)) {
        const hit = findRegistered(target);
        if (hit) return hit;
      }
    }
    if (registeredKeys.has(k)) return findRegistered(s);
  }
  return null;
}

const matsSnap = await getDocs(query(collection(db, `${BASE}/controleMateriais`), orderBy('registradoEm', 'desc')));
const toRestore = [];
const newAliases = {};

for (const d of matsSnap.docs) {
  const data = d.data();
  if (!data.deleted || !data.unidadeNomeInvalida) continue;
  const raw = data.unidadeNomeInvalida;
  const resolved = resolveUnit(raw);
  if (!resolved) continue;
  toRestore.push({ id: d.id, raw, resolved, data });
  if (key(raw) !== key(resolved) && !aliases[key(raw)]) {
    newAliases[key(raw)] = resolved;
  }
}

console.log('='.repeat(70));
console.log(APPLY ? 'RESTAURANDO REQUISIÇÕES' : 'SIMULAÇÃO — use --apply para gravar');
console.log('='.repeat(70));
console.log(`Requisições a restaurar: ${toRestore.length}`);
toRestore.forEach((r) => console.log(`  • ${r.raw} → ${r.resolved} (${r.id})`));

if (!APPLY) {
  console.log('\n⚠️  Nada alterado.');
  process.exit(0);
}

let batch = writeBatch(db);
let ops = 0;
async function flush() {
  if (ops > 0) {
    await batch.commit();
    batch = writeBatch(db);
    ops = 0;
  }
}

for (const r of toRestore) {
  batch.update(doc(db, `${BASE}/controleMateriais`, r.id), {
    deleted: false,
    unidadeNome: r.resolved,
    unidadeNomeInvalida: null,
  });
  ops++;
  if (ops >= 400) await flush();
}
await flush();

if (Object.keys(newAliases).length) {
  await setDoc(doc(db, `${BASE}/semcasAliases`, 'config'), { aliases: { ...aliases, ...newAliases } }, { merge: true });
}

console.log(`\n✅ ${toRestore.length} requisições restauradas.`);
console.log(`   ${Object.keys(newAliases).length} aliases salvos.`);
