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
  return rmAcc(s).toLowerCase();
}

const app = initializeApp(firebaseConfig);
await signInWithEmailAndPassword(getAuth(app), email, password);
const db = getFirestore(app);

const snap = await getDocs(collection(db, `${BASE}/unidades`));
const all = snap.docs.map((d) => {
  const u = d.data();
  return { nome: u.nome || u.unidadeNome || '', tipo: u.tipo || '' };
}).filter((u) => u.nome);

console.log('=== CRAS ===');
for (const u of all.filter((x) => key(x.tipo).includes('cras') || key(x.nome).includes('cras'))) {
  console.log(`  ${u.nome}`);
}

console.log('\n=== VINHA / VINHAIS / VINHAS ===');
for (const u of all.filter((x) => key(x.nome).includes('vinh'))) {
  console.log(`  ${u.nome} (${u.tipo})`);
}

console.log('\n=== Total unidades:', all.length);
