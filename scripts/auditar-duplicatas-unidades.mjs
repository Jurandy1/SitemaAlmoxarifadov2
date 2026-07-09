import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, collection, getDocs } from 'firebase/firestore';

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
  return rmAcc(s).toLowerCase().replace(/\s+/g, ' ').trim();
}

const app = initializeApp(firebaseConfig);
await signInWithEmailAndPassword(getAuth(app), email, password);
const db = getFirestore(app);

const snap = await getDocs(collection(db, `${BASE}/unidades`));
const all = snap.docs.map((d) => ({
  id: d.id,
  nome: d.data().nome || d.data().unidadeNome || '',
  tipo: d.data().tipo || '',
  sigla: d.data().sigla || '',
  atendeMateriais: d.data().atendeMateriais,
}));

console.log(`Total unidades: ${all.length}\n`);

// Duplicatas exatas (mesmo nome normalizado)
const byName = new Map();
for (const u of all) {
  const k = key(u.nome);
  if (!k) continue;
  if (!byName.has(k)) byName.set(k, []);
  byName.get(k).push(u);
}

console.log('=== NOMES IDÊNTICOS (duplicatas exatas) ===\n');
let exactDup = 0;
for (const [k, list] of byName) {
  if (list.length > 1) {
    exactDup++;
    console.log(`"${list[0].nome}" (${list.length}x):`);
    list.forEach((u) => console.log(`  • id=${u.id} tipo=${u.tipo} sigla=${u.sigla || '-'}`));
    console.log('');
  }
}
if (!exactDup) console.log('  Nenhuma\n');

// Grupos semelhantes (alta complexidade, adjunto gestão, etc.)
const terms = [
  ['alta complex', 'ALTA COMPLEXIDADE'],
  ['adjunto.*gest', 'ADJUNTO GESTÃO'],
  ['media complex', 'MÉDIA COMPLEXIDADE'],
  ['protecao social basica', 'PROTEÇÃO BÁSICA'],
  ['superintend', 'SUPERINTENDÊNCIAS'],
];

for (const [pattern, label] of terms) {
  const re = new RegExp(pattern, 'i');
  const hits = all.filter((u) => re.test(rmAcc(u.nome)));
  if (hits.length) {
    console.log(`=== ${label} (${hits.length}) ===`);
    hits.forEach((u) => console.log(`  • ${u.nome} [${u.tipo}] id=${u.id}`));
    console.log('');
  }
}

// Nomes muito parecidos (um contém o outro)
console.log('=== PARES SUSPEITOS (um nome contém o outro) ===\n');
const sede = all.filter((u) => key(u.tipo).includes('sede') || key(u.nome).includes('superintend') || key(u.nome).includes('diretoria') || key(u.nome).includes('coordena'));
let pairs = 0;
for (let i = 0; i < sede.length; i++) {
  for (let j = i + 1; j < sede.length; j++) {
    const a = key(sede[i].nome);
    const b = key(sede[j].nome);
    if (a.length < 8 || b.length < 8) continue;
    if (a.includes(b) || b.includes(a)) {
      const ratio = Math.min(a.length, b.length) / Math.max(a.length, b.length);
      if (ratio > 0.35 && ratio < 0.95) {
        pairs++;
        if (pairs <= 25) {
          console.log(`  A: ${sede[i].nome}`);
          console.log(`  B: ${sede[j].nome}`);
          console.log('');
        }
      }
    }
  }
}
if (!pairs) console.log('  (nenhum par listado)\n');
