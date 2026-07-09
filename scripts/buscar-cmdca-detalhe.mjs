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
const BASE = 'artifacts/default-app-id/public/data';
const UNITS = ['Cmdca', 'Cmdi', 'Cmas'];

const email = process.env.FB_EMAIL;
const password = process.env.FB_PASSWORD;
if (!email || !password) process.exit(1);

const app = initializeApp(firebaseConfig);
await signInWithEmailAndPassword(getAuth(app), email, password);
const db = getFirestore(app);

const histSnap = await getDocs(query(collection(db, `${BASE}/semcasHistDB`), orderBy('weekStart', 'desc')));

for (const unitName of UNITS) {
  console.log(`\n=== ${unitName.toUpperCase()} — todas as categorias em ${YEAR} ===`);
  const cats = {};
  for (const doc of histSnap.docs) {
    const entry = doc.data();
    if (entry.year !== YEAR) continue;
    for (const u of entry.units || []) {
      if ((u.unitName || '').toLowerCase() !== unitName.toLowerCase()) continue;
      for (const c of u.categories || []) {
        const cat = c.catName || '?';
        const qty = (c.items || []).reduce((s, it) => s + (Number(it.qty) || 0), 0);
        if (!cats[cat]) cats[cat] = { qty: 0, items: {} };
        cats[cat].qty += qty;
        for (const it of c.items || []) {
          const q = Number(it.qty) || 0;
          if (q > 0) cats[cat].items[it.material] = (cats[cat].items[it.material] || 0) + q;
        }
      }
    }
  }
  if (!Object.keys(cats).length) {
    console.log('  (sem registros)');
    continue;
  }
  for (const [cat, data] of Object.entries(cats).sort()) {
    console.log(`\n  [${cat}] — ${data.qty} unidades`);
    Object.entries(data.items).filter(([, q]) => q > 0).sort((a, b) => b[1] - a[1]).forEach(([m, q]) => console.log(`    • ${m}: ${q}`));
  }
}
