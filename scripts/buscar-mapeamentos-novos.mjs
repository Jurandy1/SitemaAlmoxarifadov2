import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, collection, getDocs, doc, getDoc, query, orderBy } from 'firebase/firestore';

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

const app = initializeApp(firebaseConfig);
await signInWithEmailAndPassword(getAuth(app), email, password);
const db = getFirestore(app);

const terms = ['janaina', 'tutelar', 'spsb', 'media complex', 'cadastro', 'transferencia', 'sgbstr', 'protecao social basica'];

console.log('=== CADASTRO ===\n');
const snap = await getDocs(collection(db, `${BASE}/unidades`));
for (const d of snap.docs) {
  const nome = d.data().nome || d.data().unidadeNome || '';
  const k = rmAcc(nome).toLowerCase();
  if (terms.some((t) => k.includes(t))) console.log(`  • ${nome}`);
}

console.log('\n=== DELETED REQS (nomes relevantes) ===\n');
const mats = await getDocs(query(collection(db, `${BASE}/controleMateriais`), orderBy('registradoEm', 'desc')));
for (const d of mats.docs) {
  const data = d.data();
  if (!data.deleted || !data.unidadeNomeInvalida) continue;
  const raw = data.unidadeNomeInvalida;
  const k = rmAcc(raw).toLowerCase();
  if (terms.some((t) => k.includes(t)) || k.includes('conselho')) {
    console.log(`  id=${d.id} | ${raw}`);
    if (data.fileName || data.arquivoOrigem) console.log(`    arquivo: ${data.fileName || data.arquivoOrigem}`);
  }
}

console.log('\n=== HIST — CONSELHO TUTELAR ===\n');
const hist = await getDocs(query(collection(db, `${BASE}/semcasHistDB`), orderBy('weekStart', 'desc')));
for (const d of hist.docs) {
  const data = d.data();
  const fn = data.fileName || '';
  const hit = (data.units || []).some((u) => rmAcc(u.unitName + u.rawUnit).toLowerCase().includes('tutelar'));
  if (hit || rmAcc(fn).toLowerCase().includes('tutelar') || rmAcc(fn).toLowerCase().includes('conselho')) {
    const units = (data.units || []).map((u) => `${u.unitName} (raw: ${u.rawUnit || '-'})`).join('; ');
    console.log(`  ${fn || d.id}`);
    console.log(`    unidades: ${units || '(vazio)'}`);
  }
}
