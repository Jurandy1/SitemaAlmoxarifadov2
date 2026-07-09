import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, collection, getDocs, query, orderBy } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyD7VCxaHo8veaHnM8RwY60EX_DEh3hOVHk',
  authDomain: 'controle-almoxarifado-semcas.firebaseapp.com',
  projectId: 'controle-almoxarifado-semcas',
  storageBucket: 'controle-almoxarifado-semcas.firebasestorage.app',
  messagingSenderId: '916615427315',
  appId: '1:916615427315:web:6823897ed065c50d413386',
};

const YEAR = 2026;
const CAT_RE = /material de expediente|expediente/i;
const BASE = 'artifacts/default-app-id/public/data';
const TARGET_RE = /cmdca|cmdi|cmas/i;

const email = process.env.FB_EMAIL;
const password = process.env.FB_PASSWORD;
if (!email || !password) process.exit(1);

function rmAcc(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
function normKey(s) {
  return rmAcc(s).toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
}
function isExpediente(cat) {
  return CAT_RE.test(String(cat || ''));
}
function isTarget(name, tipo) {
  const n = String(name || '');
  const t = String(tipo || '');
  return TARGET_RE.test(n) || TARGET_RE.test(t);
}

const app = initializeApp(firebaseConfig);
await signInWithEmailAndPassword(getAuth(app), email, password);
const db = getFirestore(app);

const unidadesSnap = await getDocs(collection(db, `${BASE}/unidades`));
console.log('=== UNIDADES CADASTRADAS (CMDCA/CMDI/CMAS) ===');
const registered = [];
unidadesSnap.docs.forEach((d) => {
  const u = d.data();
  const nome = u.nome || u.unidadeNome || '';
  if (isTarget(nome, u.tipo)) {
    registered.push({ nome, tipo: u.tipo || '?' });
    console.log(`  ${nome} | tipo: ${u.tipo || '?'}`);
  }
});
if (!registered.length) console.log('  (nenhuma encontrada no cadastro)');

const histSnap = await getDocs(query(collection(db, `${BASE}/semcasHistDB`), orderBy('weekStart', 'desc')));
const namesInHist = new Map();

for (const doc of histSnap.docs) {
  const entry = doc.data();
  if (entry.year !== YEAR) continue;
  for (const u of entry.units || []) {
    const unit = u.unitName || '';
    if (!isTarget(unit)) continue;
    for (const c of u.categories || []) {
      if (!isExpediente(c.catName)) continue;
      const qty = (c.items || []).reduce((s, it) => s + (Number(it.qty) || 0), 0);
      if (!namesInHist.has(unit)) namesInHist.set(unit, { qty: 0, items: {} });
      const row = namesInHist.get(unit);
      row.qty += qty;
      for (const it of c.items || []) {
        const q = Number(it.qty) || 0;
        if (q > 0) row.items[it.material] = (row.items[it.material] || 0) + q;
      }
    }
  }
}

console.log('\n=== NO HISTÓRICO 2026 (expediente) ===');
if (!namesInHist.size) {
  console.log('  (nenhum registro)');
} else {
  for (const [unit, data] of [...namesInHist.entries()].sort()) {
    console.log(`\n${unit} — ${data.qty} unidades`);
    Object.entries(data.items).filter(([, q]) => q > 0).sort((a, b) => b[1] - a[1]).forEach(([m, q]) => console.log(`  • ${m}: ${q}`));
  }
}

console.log('\n=== TODOS OS NOMES NO HISTÓRICO QUE CONTÊM CMD/CMAS ===');
const allNames = new Set();
for (const doc of histSnap.docs) {
  const entry = doc.data();
  if (entry.year !== YEAR) continue;
  for (const u of entry.units || []) {
    const unit = u.unitName || '';
    if (/cmd|cmas|conselho municipal/i.test(unit)) allNames.add(unit);
  }
}
[...allNames].sort().forEach((n) => console.log(`  - ${n}`));
