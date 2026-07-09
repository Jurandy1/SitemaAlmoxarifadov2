/**
 * Corrige vínculo errado CREAS CENTRO → Cras Centro.
 * Deve ser CREAS CENTRO → Creas Centro (unidades distintas).
 *
 * Uso: FB_EMAIL=... FB_PASSWORD=... node scripts/corrigir-creas-centro.mjs --apply
 */
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, collection, getDocs, doc, writeBatch, getDoc, setDoc, query, orderBy } from 'firebase/firestore';

const APPLY = process.argv.includes('--apply');
const BASE = 'artifacts/default-app-id/public/data';
const CREAS_CENTRO = 'Creas Centro';
const CRAS_CENTRO = 'Cras Centro';

const firebaseConfig = {
  apiKey: 'AIzaSyD7VCxaHo8veaHnM8RwY60EX_DEh3hOVHk',
  authDomain: 'controle-almoxarifado-semcas.firebaseapp.com',
  projectId: 'controle-almoxarifado-semcas',
  storageBucket: 'controle-almoxarifado-semcas.firebasestorage.app',
  messagingSenderId: '916615427315',
  appId: '1:916615427315:web:6823897ed065c50d413386',
};

const email = process.env.FB_EMAIL;
const password = process.env.FB_PASSWORD;
if (!email || !password) process.exit(1);

function rmAcc(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
function key(s) {
  return rmAcc(s).toUpperCase().replace(/\s+/g, ' ').trim();
}

function isCreasCentroRaw(raw) {
  const k = key(raw);
  return k === 'CREAS CENTRO' || k.startsWith('CREAS CENTRO ');
}

const app = initializeApp(firebaseConfig);
await signInWithEmailAndPassword(getAuth(app), email, password);
const db = getFirestore(app);

const aliasSnap = await getDoc(doc(db, `${BASE}/semcasAliases`, 'config'));
const aliases = aliasSnap.exists() ? { ...(aliasSnap.data()?.aliases || {}) } : {};

const wrongAliasKeys = Object.entries(aliases)
  .filter(([, v]) => key(v) === key(CRAS_CENTRO))
  .map(([k]) => k)
  .filter((k) => k.includes('CREAS') && k.includes('CENTRO'));

const histSnap = await getDocs(query(collection(db, `${BASE}/semcasHistDB`), orderBy('weekStart', 'desc')));
const histFixes = [];
for (const d of histSnap.docs) {
  const data = d.data();
  let changed = false;
  const units = (data.units || []).map((u) => {
    const raw = u.rawUnit || u.unitName || '';
    if (key(u.unitName) === key(CRAS_CENTRO) && isCreasCentroRaw(raw)) {
      changed = true;
      return { ...u, unitName: CREAS_CENTRO };
    }
    return u;
  });
  if (changed) histFixes.push({ id: d.id, data: { ...data, units } });
}

const matsSnap = await getDocs(query(collection(db, `${BASE}/controleMateriais`), orderBy('registradoEm', 'desc')));
const matsFixes = [];
for (const d of matsSnap.docs) {
  const data = d.data();
  const raw = data.unidadeNomeInvalida || data.unidadeNome || '';
  if (key(data.unidadeNome) === key(CRAS_CENTRO) && isCreasCentroRaw(raw)) {
    matsFixes.push({ id: d.id, unidadeNome: CREAS_CENTRO });
  }
}

console.log('='.repeat(70));
console.log(APPLY ? 'CORRIGINDO CREAS CENTRO' : 'SIMULAÇÃO — use --apply');
console.log('='.repeat(70));
console.log(`Aliases errados a corrigir: ${wrongAliasKeys.length}`);
wrongAliasKeys.forEach((k) => console.log(`  • ${k} → ${aliases[k]}  (será ${CREAS_CENTRO})`));
if (!wrongAliasKeys.includes('CREAS CENTRO')) {
  console.log(`  • CREAS CENTRO → ${CREAS_CENTRO} (novo vínculo)`);
}
console.log(`\nHistórico a corrigir: ${histFixes.length} documentos`);
console.log(`Requisições a corrigir: ${matsFixes.length}`);

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

for (const h of histFixes) {
  batch.set(doc(db, `${BASE}/semcasHistDB`, h.id), h.data);
  ops++;
  if (ops >= 400) await flush();
}
await flush();

for (const m of matsFixes) {
  batch.update(doc(db, `${BASE}/controleMateriais`, m.id), { unidadeNome: m.unidadeNome });
  ops++;
  if (ops >= 400) await flush();
}
await flush();

for (const k of wrongAliasKeys) {
  aliases[k] = CREAS_CENTRO;
}
aliases['CREAS CENTRO'] = CREAS_CENTRO;
await setDoc(doc(db, `${BASE}/semcasAliases`, 'config'), { aliases }, { merge: true });

console.log('\n✅ Creas Centro separado de Cras Centro.');
console.log(`   Histórico: ${histFixes.length} docs`);
console.log(`   Requisições: ${matsFixes.length}`);
