import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, collection, getDocs, query, orderBy } from 'firebase/firestore';
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const firebaseConfig = {
  apiKey: 'AIzaSyD7VCxaHo8veaHnM8RwY60EX_DEh3hOVHk',
  authDomain: 'controle-almoxarifado-semcas.firebaseapp.com',
  projectId: 'controle-almoxarifado-semcas',
  storageBucket: 'controle-almoxarifado-semcas.firebasestorage.app',
  messagingSenderId: '916615427315',
  appId: '1:916615427315:web:6823897ed065c50d413386',
};

const PATHS = [
  'artifacts/controle-almoxarifado-semcas/public/data',
  'artifacts/default-app-id/public/data',
];

const YEAR = 2026;
const CAT_RE = /material de expediente|expediente/i;

const email = process.env.FB_EMAIL;
const password = process.env.FB_PASSWORD;
if (!email || !password) {
  console.error('Defina FB_EMAIL e FB_PASSWORD.');
  process.exit(1);
}

function rmAcc(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function normKey(s) {
  return rmAcc(s).toLowerCase().replace(/^ct\s+/, '').replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
}

function normItem(s) {
  return rmAcc(s).toUpperCase().replace(/\s+/g, ' ').trim();
}

function isCT(name, tipo) {
  const n = String(name || '');
  const t = String(tipo || '').toUpperCase();
  return t === 'CT' || /^ct\b/i.test(n) || /conselho\s*tutelar/i.test(n);
}

function isExpediente(catName) {
  return CAT_RE.test(String(catName || ''));
}

function resolveCT(rawName, registeredCTs) {
  const key = normKey(rawName);
  if (!key) return rawName;

  for (const ct of registeredCTs) {
    if (normKey(ct) === key) return ct;
  }

  const manual = {
    'anil bequimao': 'Anil/Bequimão',
    'centro': 'Centro/Alemanha',
    'itaquibacanga': 'Itaqui-Bacanga',
    'conselho tutelar': 'CONSELHO TUTELAR (nome genérico)',
  };
  if (manual[key]) return manual[key];

  for (const ct of registeredCTs) {
    const ck = normKey(ct);
    if (ck.includes(key) || key.includes(ck)) return ct;
  }

  return rawName;
}

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

console.log('Conectando ao sistema...');
await signInWithEmailAndPassword(auth, email, password);

async function countCol(path, name) {
  return (await getDocs(collection(db, `${path}/${name}`))).size;
}

let base = PATHS[0];
for (const path of PATHS) {
  const total = await Promise.all(['unidades', 'semcasHistDB', 'controleMateriais'].map((c) => countCol(path, c)));
  if (total.reduce((a, b) => a + b, 0) > 0) {
    base = path;
    break;
  }
}

const unidadesSnap = await getDocs(collection(db, `${base}/unidades`));
const registeredCTs = [];
unidadesSnap.docs.forEach((d) => {
  const data = d.data();
  const nome = data.nome || data.unidadeNome || '';
  if (isCT(nome, data.tipo)) registeredCTs.push(nome);
});
registeredCTs.sort((a, b) => a.localeCompare(b, 'pt-BR'));

/** @type {Map<string, Map<string, {qty:number, hist:number, workflow:number}>>} */
const byCT = new Map();

function addItem(rawUnit, rawItem, qty, source) {
  if (!qty || qty <= 0) return;
  const unit = resolveCT(rawUnit, registeredCTs);
  const item = normItem(rawItem);
  if (!item) return;

  if (!byCT.has(unit)) byCT.set(unit, new Map());
  const items = byCT.get(unit);
  if (!items.has(item)) items.set(item, { qty: 0, hist: 0, workflow: 0 });
  const row = items.get(item);
  row.qty += qty;
  row[source] += qty;
}

let histRecords = 0;
let workflowRecords = 0;

const histSnap = await getDocs(query(collection(db, `${base}/semcasHistDB`), orderBy('weekStart', 'desc')));
for (const doc of histSnap.docs) {
  const entry = doc.data();
  if (entry.year !== YEAR) continue;

  for (const u of entry.units || []) {
    const unit = u.unitName;
    if (!unit || (!registeredCTs.some((ct) => resolveCT(unit, registeredCTs) === ct) && !isCT(unit))) continue;

    for (const c of u.categories || []) {
      if (!isExpediente(c.catName)) continue;
      histRecords++;
      for (const it of c.items || []) {
        addItem(unit, it.material, Number(it.qty) || 0, 'hist');
      }
    }
  }
}

const matsSnap = await getDocs(query(collection(db, `${base}/controleMateriais`), orderBy('registradoEm', 'desc')));
for (const doc of matsSnap.docs) {
  const data = doc.data();
  if (data.status !== 'entregue') continue;
  const unit = data.unidadeNome || '';
  if (!isCT(unit, data.tipoUnidade)) continue;

  const entrega = data.dataEntrega?.toDate?.() || (data.dataEntrega ? new Date(data.dataEntrega) : null);
  const reg = data.registradoEm?.toDate?.() || null;
  const ref = entrega || reg;
  if (!ref || ref.getFullYear() !== YEAR) continue;

  const itemsMap = data.itemsMap || {};
  let added = false;
  for (const [key, val] of Object.entries(itemsMap)) {
    const cat = val?.categoria || val?.cat || val?.tipo || key;
    if (data.tipoMaterial && !isExpediente(data.tipoMaterial)) continue;
    if (!isExpediente(cat) && !isExpediente(data.tipoMaterial)) continue;
    const mat = val?.material || val?.nome || key;
    const qty = Number(val?.qty ?? val?.quantidade ?? 0);
    if (qty > 0) {
      addItem(unit, mat, qty, 'workflow');
      added = true;
    }
  }
  if (added) workflowRecords++;
}

for (const ct of registeredCTs) {
  if (!byCT.has(ct)) byCT.set(ct, new Map());
}

const __dir = dirname(fileURLToPath(import.meta.url));
const detailLines = ['Conselho Tutelar;Item;Quantidade;Origem'];
const summaryLines = ['Conselho Tutelar;Item;Quantidade'];

const allCTs = [...new Set([...registeredCTs, ...byCT.keys()])].sort((a, b) => a.localeCompare(b, 'pt-BR'));

let grandTotal = 0;
let totalItensDistintos = 0;

console.log('\n' + '='.repeat(72));
console.log(`LISTA DE ITENS — Material de Expediente | CTs | ${YEAR}`);
console.log(`Fonte: banco SEMCAS (${base})`);
console.log(`Registros histórico: ${histRecords} | Entregas confirmadas no sistema: ${workflowRecords}`);
console.log('='.repeat(72));

for (const ct of allCTs) {
  const items = byCT.get(ct) || new Map();
  const rows = [...items.entries()]
    .filter(([, v]) => v.qty > 0)
    .sort((a, b) => b[1].qty - a[1].qty || a[0].localeCompare(b[0], 'pt-BR'));

  const ctTotal = rows.reduce((s, [, v]) => s + v.qty, 0);
  grandTotal += ctTotal;
  totalItensDistintos += rows.length;

  console.log(`\n▶ ${ct}`);
  if (!rows.length) {
    console.log('   (sem entregas registradas em 2026)');
    summaryLines.push(`${ct};—;0`);
    continue;
  }

  console.log(`   Total: ${ctTotal} unidades | ${rows.length} tipo(s) de item`);
  for (const [item, v] of rows) {
    const origem = [];
    if (v.hist > 0) origem.push(`planilha/histórico (${v.hist})`);
    if (v.workflow > 0) origem.push(`sistema (${v.workflow})`);
    console.log(`   • ${item}: ${v.qty}`);
    detailLines.push(`${ct};${item};${v.qty};${origem.join(' + ')}`);
    summaryLines.push(`${ct};${item};${v.qty}`);
  }
}

console.log('\n' + '-'.repeat(72));
console.log(`TOTAL GERAL: ${grandTotal} unidades entregues`);
console.log(`CTs no cadastro: ${registeredCTs.length}`);
console.log(`CTs com entrega: ${allCTs.filter((ct) => (byCT.get(ct)?.size || 0) > 0).length}`);

const detailPath = join(__dir, `lista-itens-ct-expediente-${YEAR}.csv`);
const summaryPath = join(__dir, `lista-itens-ct-expediente-${YEAR}-simples.csv`);
writeFileSync(detailPath, '\uFEFF' + detailLines.join('\n'), 'utf8');
writeFileSync(summaryPath, '\uFEFF' + summaryLines.join('\n'), 'utf8');

console.log(`\nArquivos gerados:`);
console.log(`  1) ${detailPath}`);
console.log(`  2) ${summaryPath}`);
