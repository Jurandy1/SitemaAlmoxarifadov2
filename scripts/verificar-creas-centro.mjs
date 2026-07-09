import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, collection, getDocs, doc, getDoc } from 'firebase/firestore';

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

const app = initializeApp(firebaseConfig);
await signInWithEmailAndPassword(getAuth(app), email, password);
const db = getFirestore(app);

const snap = await getDocs(collection(db, `${BASE}/unidades`));
console.log('=== CREAS / CRAS CENTRO no cadastro ===');
for (const d of snap.docs) {
  const nome = d.data().nome || d.data().unidadeNome || '';
  const k = rmAcc(nome).toLowerCase();
  if (k.includes('creas') || (k.includes('cras') && k.includes('centro'))) {
    console.log(`  • ${nome} (${d.data().tipo || '?'})`);
  }
}

const aliasSnap = await getDoc(doc(db, `${BASE}/semcasAliases`, 'config'));
const aliases = aliasSnap.exists() ? aliasSnap.data()?.aliases || {} : {};
console.log('\n=== Aliases com CREAS ou CRAS CENTRO ===');
for (const [k, v] of Object.entries(aliases)) {
  if (rmAcc(k).toLowerCase().includes('creas') || rmAcc(v).toLowerCase().includes('creas') ||
      rmAcc(k).toLowerCase().includes('cras centro') || rmAcc(v).toLowerCase().includes('cras centro')) {
    console.log(`  ${k} → ${v}`);
  }
}
