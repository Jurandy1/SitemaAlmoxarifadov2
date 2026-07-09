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
const email = process.env.FB_EMAIL;
const password = process.env.FB_PASSWORD;
if (!email || !password) process.exit(1);

const CTS_OFICIAIS = [
  'Anil/BequimãO', 'Centro/Alemanha', 'Cidade OperáRia/Cidade OlíMpica', 'Cohab/Cohatrac',
  'Coroadinho/JoãO Paulo', 'Ct Zona Rural', 'Itaqui-Bacanga', 'SãO CristóVãO/SãO Raimundo',
  'SãO Francisco/Cohama', 'Vila LuizãO/Turu',
];

function rmAcc(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
function normKey(s) {
  return rmAcc(s).toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
}

// Variações conhecidas — só nomes que são DO CT, não CRAS/CREAS
const ALIASES = {
  'Anil/Bequimão': ['anil bequimao', 'ct anil bequimao', 'anil/bequimao'],
  'Centro/Alemanha': ['centro alemanha', 'ct centro', 'centro/alemanha'],
  'Cidade Operária/Cidade Olímpica': ['cidade operaria cidade olimpica', 'cidade operaria/cidade olimpica'],
  'Cohab/Cohatrac': ['cohab cohatrac', 'cohab/cohatrac'],
  'Coroadinho/João Paulo': ['coroadinho joao paulo', 'coroadinho/joao paulo'],
  'Ct Zona Rural': ['ct zona rural', 'zona rural'],
  'Itaqui-Bacanga': ['itaqui bacanga', 'ct itaquibacanga', 'itaqui-bacanga'],
  'São Cristóvão/São Raimundo': ['sao cristovao sao raimundo', 'sao cristovao/sao raimundo'],
  'São Francisco/Cohama': ['sao francisco cohama', 'sao francisco/cohama'],
  'Vila Luizão/Turu': ['vila luizao turu', 'vila luizao/turu', 'ct vila luizao'],
};

function matchOficial(unitName) {
  const k = normKey(unitName);
  if (/^conselho tutelar$/i.test(rmAcc(unitName).trim())) return 'CONSELHO TUTELAR (genérico)';
  for (const [oficial, aliases] of Object.entries(ALIASES)) {
    const ok = normKey(oficial) === k || aliases.some((a) => k === a || k.startsWith(a) || a.startsWith(k));
    if (ok) return oficial;
  }
  if (/^ct\b/i.test(unitName)) return `CT não mapeado: ${unitName}`;
  return null;
}

const app = initializeApp(firebaseConfig);
await signInWithEmailAndPassword(getAuth(app), email, password);
const db = getFirestore(app);

const histSnap = await getDocs(query(collection(db, `${BASE}/semcasHistDB`), orderBy('weekStart', 'desc')));

const resultado = {};
for (const ct of Object.keys(ALIASES)) {
  resultado[ct] = { variacoes: new Set(), expediente: 0, outras: 0, registros: 0 };
}

for (const doc of histSnap.docs) {
  const e = doc.data();
  if (e.year !== YEAR) continue;
  for (const u of e.units || []) {
    const name = u.unitName || '';
    const oficial = matchOficial(name);
    if (!oficial || !resultado[oficial]) continue;
    resultado[oficial].variacoes.add(name);
    resultado[oficial].registros++;
    for (const c of u.categories || []) {
      const qty = (c.items || []).reduce((s, it) => s + (Number(it.qty) || 0), 0);
      if (qty <= 0) continue;
      if (/expediente/i.test(c.catName || '')) resultado[oficial].expediente += qty;
      else resultado[oficial].outras += qty;
    }
  }
}

console.log('10 CTs — nomes reais no histórico 2026 (sem misturar CRAS/CREAS)\n');
Object.entries(ALIASES).forEach(([ct], i) => {
  const r = resultado[ct];
  const vars = [...r.variacoes];
  console.log(`${i + 1}. ${ct}`);
  if (!vars.length) {
    console.log('   ❌ Nenhum registro em 2026');
  } else {
    console.log(`   Nomes encontrados: ${vars.map((v) => `"${v}"`).join(', ')}`);
    console.log(`   Expediente: ${r.expediente} unid. | Outras categorias: ${r.outras} unid.`);
    console.log(r.expediente > 0 ? '   ✅ Tem material de expediente' : '   ⚠️  Tem registro mas SEM expediente');
  }
  console.log('');
});

console.log('Nomes com prefixo CT no histórico 2026:');
const ctPrefix = new Set();
for (const doc of histSnap.docs) {
  const e = doc.data();
  if (e.year !== YEAR) continue;
  for (const u of e.units || []) {
    if (/^ct\b/i.test(u.unitName || '') || /conselho tutelar/i.test(u.unitName || '')) {
      ctPrefix.add(u.unitName);
    }
  }
}
[...ctPrefix].sort().forEach((n) => console.log(`  • ${n}`));
