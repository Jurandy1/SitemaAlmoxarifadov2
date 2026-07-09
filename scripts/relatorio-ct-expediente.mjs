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

async function countCol(path, name) {
  const snap = await getDocs(collection(db, `${path}/${name}`));
  return snap.size;
}

async function findDataPath() {
  for (const path of PATHS) {
    const counts = {};
    for (const col of ['unidades', 'semcasHistDB', 'controleMateriais', 'controleAgua']) {
      counts[col] = await countCol(path, col);
    }
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    console.log(`Caminho ${path}:`, counts);
    if (total > 0) return { path, counts };
  }
  return { path: PATHS[0], counts: {} };
}
const YEAR = 2026;
const CAT_RE = /material de expediente|expediente/i;

const email = process.env.FB_EMAIL;
const password = process.env.FB_PASSWORD;

if (!email || !password) {
  console.error('Defina FB_EMAIL e FB_PASSWORD nas variáveis de ambiente.');
  process.exit(1);
}

function isCT(name, tipo) {
  const n = String(name || '');
  const t = String(tipo || '').toUpperCase();
  return t === 'CT' || /^ct\b/i.test(n) || /conselho\s*tutelar/i.test(n);
}

function isExpediente(catName) {
  return CAT_RE.test(String(catName || ''));
}

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

console.log('Autenticando...');
await signInWithEmailAndPassword(auth, email, password);
console.log('OK');

const found = await findDataPath();
const base = found.path;
console.log(`\nUsando: ${base}\n`);

// Unidades CT
const unidadesSnap = await getDocs(collection(db, `${base}/unidades`));
const ctUnits = new Map();
unidadesSnap.docs.forEach((d) => {
  const data = d.data();
  const nome = data.nome || data.unidadeNome || '';
  if (isCT(nome, data.tipo)) ctUnits.set(nome, data.tipo || 'CT');
});

// Histórico de entregas
const histSnap = await getDocs(query(collection(db, `${base}/semcasHistDB`), orderBy('weekStart', 'desc')));
const entries = histSnap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((e) => e.year === YEAR);

console.log(`Registros históricos em ${YEAR}: ${entries.length} (de ${histSnap.size} total)\n`);

// Agregar por CT
const report = {};

for (const entry of entries) {
  for (const u of entry.units || []) {
    const unit = u.unitName;
    if (!unit) continue;
    const knownCT = ctUnits.has(unit) || isCT(unit);
    if (!knownCT) continue;

    for (const c of u.categories || []) {
      if (!isExpediente(c.catName)) continue;

      if (!report[unit]) report[unit] = { total: 0, items: {}, entregas: 0 };
      report[unit].entregas += 1;

      for (const it of c.items || []) {
        const qty = Number(it.qty) || 0;
        const mat = String(it.material || '').trim();
        report[unit].total += qty;
        report[unit].items[mat] = (report[unit].items[mat] || 0) + qty;
      }
    }
  }
}

// Também buscar entregas operacionais em controleMateriais
const matsSnap = await getDocs(query(collection(db, `${base}/controleMateriais`), orderBy('registradoEm', 'desc')));
let matsCount = 0;

for (const d of matsSnap.docs) {
  const data = d.data();
  if (data.status !== 'entregue') continue;
  const unit = data.unidadeNome || '';
  if (!isCT(unit, data.tipoUnidade)) continue;

  const entrega = data.dataEntrega?.toDate?.() || (data.dataEntrega ? new Date(data.dataEntrega) : null);
  if (entrega && entrega.getFullYear() !== YEAR) continue;
  if (!entrega && data.registradoEm?.toDate) {
    const reg = data.registradoEm.toDate();
    if (reg.getFullYear() !== YEAR) continue;
  }

  const itemsMap = data.itemsMap || {};
  let hasExpediente = false;

  for (const [key, val] of Object.entries(itemsMap)) {
    const cat = val?.categoria || val?.cat || val?.tipo || key;
    const mat = val?.material || val?.nome || key;
    const qty = Number(val?.qty ?? val?.quantidade ?? 0);
    if (!isExpediente(cat) && !isExpediente(data.tipoMaterial)) continue;
    if (data.tipoMaterial && !isExpediente(data.tipoMaterial)) continue;

    hasExpediente = true;
    if (!report[unit]) report[unit] = { total: 0, items: {}, entregas: 0, fromWorkflow: 0 };
    report[unit].total += qty;
    report[unit].items[mat] = (report[unit].items[mat] || 0) + qty;
  }

  if (hasExpediente) {
    if (!report[unit]) report[unit] = { total: 0, items: {}, entregas: 0, fromWorkflow: 0 };
    report[unit].fromWorkflow = (report[unit].fromWorkflow || 0) + 1;
    matsCount++;
  }
}

// CT cadastrados sem entrega
for (const [nome] of ctUnits) {
  if (!report[nome]) report[nome] = { total: 0, items: {}, entregas: 0 };
}

const sorted = Object.entries(report).sort((a, b) => a[0].localeCompare(b[0], 'pt-BR'));

console.log('='.repeat(70));
console.log(`RELATÓRIO — Material de Expediente entregue aos CTs em ${YEAR}`);
console.log('='.repeat(70));
console.log('');

let grandTotal = 0;
for (const [unit, data] of sorted) {
  grandTotal += data.total;
  console.log(`📍 ${unit}`);
  console.log(`   Total de itens entregues: ${data.total}`);
  console.log(`   Registros no histórico: ${data.entregas || 0}`);
  if (data.fromWorkflow) console.log(`   Entregas via sistema (workflow): ${data.fromWorkflow}`);

  const topItems = Object.entries(data.items).sort((a, b) => b[1] - a[1]);
  if (topItems.length) {
    console.log('   Itens:');
    for (const [mat, qty] of topItems) {
      console.log(`     - ${mat}: ${qty}`);
    }
  } else {
    console.log('   (nenhuma entrega registrada este ano)');
  }
  console.log('');
}

console.log('-'.repeat(70));
console.log(`TOTAL GERAL: ${grandTotal} itens em ${sorted.length} CT(s)`);
console.log(`CTs cadastrados: ${ctUnits.size}`);
console.log(`Entregas workflow processadas: ${matsCount}`);

// CSV resumido (só itens com qty > 0)
const __dir = dirname(fileURLToPath(import.meta.url));

const csvLines = ['Conselho Tutelar;Total Itens Entregues;Qtd Registros;Principais Itens'];
for (const [unit, data] of sorted) {
  const top = Object.entries(data.items)
    .filter(([, q]) => q > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([m, q]) => `${m} (${q})`)
    .join(' | ');
  csvLines.push(`${unit};${data.total};${(data.entregas || 0) + (data.fromWorkflow || 0)};${top}`);
}

const csvPath = join(__dir, `relatorio-ct-expediente-${YEAR}.csv`);
writeFileSync(csvPath, '\uFEFF' + csvLines.join('\n'), 'utf8');
console.log(`\nArquivo salvo: ${csvPath}`);
