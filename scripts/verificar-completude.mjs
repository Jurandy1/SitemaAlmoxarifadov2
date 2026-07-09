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

const email = process.env.FB_EMAIL;
const password = process.env.FB_PASSWORD;
if (!email || !password) process.exit(1);

function rmAcc(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
function normKey(s) {
  return rmAcc(s).toLowerCase().replace(/^ct\s+/, '').replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
}
function isCT(name, tipo) {
  const n = String(name || '');
  const t = String(tipo || '').toUpperCase();
  return t === 'CT' || /^ct\b/i.test(n) || /conselho\s*tutelar/i.test(n);
}
function isExpediente(cat) {
  return CAT_RE.test(String(cat || ''));
}

const app = initializeApp(firebaseConfig);
await signInWithEmailAndPassword(getAuth(app), email, password);
const db = getFirestore(app);

const unidadesSnap = await getDocs(collection(db, `${BASE}/unidades`));
const registeredCTs = unidadesSnap.docs
  .map((d) => d.data())
  .filter((u) => isCT(u.nome || u.unidadeNome, u.tipo))
  .map((u) => u.nome || u.unidadeNome);

const histSnap = await getDocs(query(collection(db, `${BASE}/semcasHistDB`), orderBy('weekStart', 'desc')));
const allHist = histSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
const hist2026 = allHist.filter((e) => e.year === YEAR);

let histExpedienteAllUnits = 0;
let histExpedienteCT = 0;
let histExpedienteCTQty = 0;
const ctNamesInHist = new Set();
const catsSeen = new Set();

for (const entry of hist2026) {
  for (const u of entry.units || []) {
    for (const c of u.categories || []) {
      catsSeen.add(c.catName);
      if (!isExpediente(c.catName)) continue;
      const qty = (c.items || []).reduce((s, it) => s + (Number(it.qty) || 0), 0);
      histExpedienteAllUnits += qty;
      if (isCT(u.unitName) || registeredCTs.some((ct) => normKey(ct) === normKey(u.unitName))) {
        histExpedienteCT += qty;
        histExpedienteCTQty += qty;
        ctNamesInHist.add(u.unitName);
      }
    }
  }
}

const matsSnap = await getDocs(query(collection(db, `${BASE}/controleMateriais`), orderBy('registradoEm', 'desc')));
let wfTotal = 0;
let wfCTExpediente = 0;
let wfCTExpediente2026 = 0;
const wfSamples = [];

for (const d of matsSnap.docs) {
  const data = d.data();
  if (data.status !== 'entregue') continue;
  wfTotal++;
  const unit = data.unidadeNome || '';
  if (!isCT(unit, data.tipoUnidade)) continue;

  const entrega = data.dataEntrega?.toDate?.() || (data.dataEntrega ? new Date(data.dataEntrega) : null);
  const reg = data.registradoEm?.toDate?.() || null;
  const ref = entrega || reg;
  const yearOk = ref && ref.getFullYear() === YEAR;

  const tipos = [data.tipoMaterial, ...(data.tiposMaterial || [])].filter(Boolean);
  const itemsMap = data.itemsMap || {};
  let qty = 0;
  for (const val of Object.values(itemsMap)) {
    const cat = val?.categoria || val?.cat || val?.tipo || '';
    if (isExpediente(cat) || tipos.some((t) => isExpediente(t))) {
      qty += Number(val?.qty ?? val?.quantidade ?? 0);
    }
  }
  if (tipos.some((t) => isExpediente(t)) && qty === 0) {
    qty = Object.values(itemsMap).reduce((s, v) => s + (Number(v?.qty ?? v?.quantidade ?? 0)), 0);
  }

  if (qty > 0 || tipos.some((t) => isExpediente(t))) {
    wfCTExpediente++;
    if (yearOk) {
      wfCTExpediente2026 += qty;
      if (wfSamples.length < 5) wfSamples.push({ unit, qty, tipos, id: d.id });
    }
  }
}

console.log('=== VERIFICAÇÃO DE COMPLETUDE ===\n');
console.log(`semcasHistDB total no banco: ${allHist.length}`);
console.log(`semcasHistDB em ${YEAR}: ${hist2026.length}`);
console.log(`CTs cadastrados: ${registeredCTs.length}`);
console.log(`CTs com expediente no histórico: ${ctNamesInHist.size}`);
console.log('');
console.log(`Expediente (todos os tipos de unidade) em ${YEAR}: ${histExpedienteAllUnits} unidades`);
console.log(`Expediente só CTs em ${YEAR}: ${histExpedienteCTQty} unidades`);
console.log('');
console.log(`controleMateriais entregues (total): ${wfTotal}`);
console.log(`Entregas CT com expediente (qualquer ano): ${wfCTExpediente}`);
console.log(`Entregas CT expediente em ${YEAR} (workflow): ${wfCTExpediente2026} unidades`);
console.log('');
console.log('CTs cadastrados:');
registeredCTs.sort().forEach((c) => console.log(`  - ${c}`));
console.log('');
console.log('Nomes de CT encontrados no histórico (podem ter variação):');
[...ctNamesInHist].sort().forEach((c) => console.log(`  - ${c}`));
console.log('');
console.log('Categorias com "expediente" vistas no histórico 2026:');
[...catsSeen].filter((c) => isExpediente(c)).forEach((c) => console.log(`  - ${c}`));

const missingCTs = registeredCTs.filter((ct) => ![...ctNamesInHist].some((n) => normKey(n) === normKey(ct) || normKey(n).includes(normKey(ct)) || normKey(ct).includes(normKey(n))));
console.log('');
console.log('CTs cadastrados SEM expediente no histórico 2026:');
missingCTs.forEach((c) => console.log(`  - ${c}`));
