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

const CHECK = [
  'ALTA COMPLEXIDADE',
  'Secretário Adjunto De Gestão',
  'Creas Coroadinho',
  'Superintendência De Proteção Social Especial De Alta Complexidade',
];

const app = initializeApp(firebaseConfig);
await signInWithEmailAndPassword(getAuth(app), email, password);
const db = getFirestore(app);

const hist = await getDocs(query(collection(db, `${BASE}/semcasHistDB`), orderBy('weekStart', 'desc')));
const mats = await getDocs(query(collection(db, `${BASE}/controleMateriais`), orderBy('registradoEm', 'desc')));

for (const name of CHECK) {
  const k = key(name);
  let h = 0, m = 0;
  for (const d of hist.docs) {
    for (const u of d.data().units || []) {
      if (key(u.unitName).includes(k) || key(u.rawUnit).includes(k)) h++;
    }
  }
  for (const d of mats.docs) {
    const data = d.data();
    if (key(data.unidadeNome).includes(k) || key(data.unidadeNomeInvalida).includes(k)) m++;
  }
  console.log(`${name}: hist=${h} blocos, reqs=${m}`);
}
