/**
 * Audita dados afetados pelos nomes incorretos e o que pode ser restaurado.
 */
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, collection, getDocs, query, orderBy } from 'firebase/firestore';

const BASE = 'artifacts/default-app-id/public/data';
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

const PATTERNS = [
  ['vinhai', 'Cras Vinhas'],
  ['territorio 2', 'Cras Bairro De Fatima'],
  ['bairro de fati', 'Cras Bairro De Fatima'],
  ['coordenacao de transporte', 'Diretoria Técnica De Transporte'],
  ['superintendencia de administracao', 'Superintendência De Administração'],
];

function matchesPattern(k) {
  const lk = rmAcc(k).toLowerCase();
  for (const [p, target] of PATTERNS) {
    if (lk.includes(p)) return target;
  }
  return null;
}

const app = initializeApp(firebaseConfig);
await signInWithEmailAndPassword(getAuth(app), email, password);
const db = getFirestore(app);

const matsSnap = await getDocs(query(collection(db, `${BASE}/controleMateriais`), orderBy('registradoEm', 'desc')));
const deletedMats = [];
for (const d of matsSnap.docs) {
  const data = d.data();
  if (!data.deleted) continue;
  const raw = data.unidadeNomeInvalida || data.unidadeNome || '';
  const target = matchesPattern(raw);
  if (target) {
    deletedMats.push({ id: d.id, raw, target, fileName: data.arquivoOrigem || data.fileName || '' });
  }
}

console.log(`Requisições marcadas deleted recuperáveis: ${deletedMats.length}`);
deletedMats.slice(0, 20).forEach((r) => console.log(`  • ${r.raw} → ${r.target} (${r.id})`));

const histSnap = await getDocs(query(collection(db, `${BASE}/semcasHistDB`), orderBy('weekStart', 'desc')));
const histFiles = new Set();
for (const d of histSnap.docs) {
  const data = d.data();
  const names = (data.units || []).map((u) => key(u.unitName || ''));
  const hasTarget = names.some((n) =>
    n.includes('VINHAS') || n.includes('BAIRRO DE FATIMA') ||
    n.includes('DIRETORIA TECNICA DE TRANSPORTE') ||
    n.includes('SUPERINTENDENCIA DE ADMINISTRACAO')
  );
  if (!hasTarget && data.fileName) {
    // hist doc exists but may have lost units - can't know without backup
  }
}

// Buscar nomes únicos ainda presentes como rawUnit em hist
const rawInHist = new Map();
for (const d of histSnap.docs) {
  for (const u of d.data().units || []) {
    const raw = u.rawUnit || u.unitName || '';
    const target = matchesPattern(raw);
    if (target && key(raw) !== key(target)) {
      rawInHist.set(raw, (rawInHist.get(raw) || 0) + 1);
    }
  }
}

console.log(`\nBlocos hist ainda com rawUnit corrigível: ${rawInHist.size}`);
[...rawInHist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).forEach(([raw, n]) => {
  console.log(`  • ${raw} (${n}x) → ${matchesPattern(raw)}`);
});

// Unidades que sumiram - procurar fileNames em docs com poucas units
console.log('\nDocs hist com fileName (amostra para reimportação se necessário):');
let emptyish = 0;
for (const d of histSnap.docs) {
  const data = d.data();
  if ((data.units || []).length === 0 && data.fileName) {
    emptyish++;
    if (emptyish <= 10) console.log(`  • ${data.fileName} (${d.id})`);
  }
}
console.log(`Total docs hist sem unidades: ${emptyish}`);
