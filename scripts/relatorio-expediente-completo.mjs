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

const YEAR = 2026;
const BASE = 'artifacts/default-app-id/public/data';
const CAT_EXP = /material de expediente|expediente/i;
function isCT(name, tipo) {
  const n = String(name || '');
  const t = String(tipo || '').toUpperCase();
  return t === 'CT' || /^ct\b/i.test(n) || /conselho\s*tutelar/i.test(n);
}
function isCouncil(name, tipo) {
  return isCT(name, tipo) || /cmdca|cmdi|cmas/i.test(String(name || '')) || /cmdca|cmdi|cmas|conselho/i.test(String(tipo || ''));
}
const ITEM_EXP = /caneta|lapis|lápis|clips|resma|papel a4|envelope|corretivo|marca.?texto|post.?it|grampe|fita|pasta|borracha|tesoura|apontador|escarcela|cartolina|pincel|grampo|envelop|chamex|bloco|prancheta|carimbo/i;

const email = process.env.FB_EMAIL;
const password = process.env.FB_PASSWORD;
if (!email || !password) process.exit(1);

function rmAcc(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
function normItem(s) {
  return rmAcc(s).toUpperCase().replace(/\s+/g, ' ').trim();
}
function normKey(s) {
  return rmAcc(s).toLowerCase().replace(/^ct\s+/, '').replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
}
function isTargetUnit(name, tipo, registered) {
  if (isCouncil(name, tipo)) return true;
  return registered.some((u) => normKey(u) === normKey(name) || normKey(name).includes(normKey(u)) || normKey(u).includes(normKey(name)));
}

function isExpedienteCat(cat) {
  return CAT_EXP.test(String(cat || ''));
}
function isExpedienteItem(mat) {
  return ITEM_EXP.test(rmAcc(mat));
}
function displayUnit(name) {
  const n = String(name || '');
  if (/^cmas$/i.test(n)) return 'CMAS';
  if (/^cmdca$/i.test(n)) return 'CMDCA';
  if (/^cmdi$/i.test(n)) return 'CMDI';
  return n;
}
function resolveCT(raw, registered) {
  const key = normKey(raw);
  for (const u of registered) {
    if (normKey(u) === key) return displayUnit(u);
  }
  const manual = {
    'anil bequimao': 'Anil/Bequimão',
    centro: 'Centro/Alemanha',
    'itaquibacanga': 'Itaqui-Bacanga',
  };
  if (manual[key]) return manual[key];
  for (const u of registered) {
    const uk = normKey(u);
    if (uk.includes(key) || key.includes(uk)) return displayUnit(u);
  }
  return displayUnit(raw);
}

const app = initializeApp(firebaseConfig);
await signInWithEmailAndPassword(getAuth(app), email, password);
const db = getFirestore(app);

const unidadesSnap = await getDocs(collection(db, `${BASE}/unidades`));
const registered = [];
unidadesSnap.docs.forEach((d) => {
  const u = d.data();
  const nome = u.nome || u.unidadeNome || '';
  if (isCouncil(nome, u.tipo)) registered.push(nome);
});
registered.sort((a, b) => a.localeCompare(b, 'pt-BR'));

/** @type {Map<string, Map<string, number>>} */
const byUnit = new Map();
function add(rawUnit, rawItem, qty, catName) {
  if (!qty || qty <= 0) return;
  const unit = resolveCT(rawUnit, registered);
  const item = normItem(rawItem);
  if (!item) return;
  if (!byUnit.has(unit)) byUnit.set(unit, new Map());
  const items = byUnit.get(unit);
  items.set(item, (items.get(item) || 0) + qty);
}

const histSnap = await getDocs(query(collection(db, `${BASE}/semcasHistDB`), orderBy('weekStart', 'desc')));
for (const doc of histSnap.docs) {
  const entry = doc.data();
  if (entry.year !== YEAR) continue;
  for (const u of entry.units || []) {
    const unit = u.unitName;
    if (!unit || !(isTargetUnit(unit, '', registered) || isCT(unit) || /cmdca|cmdi|cmas/i.test(unit))) continue;
    const isCmdCouncil = /cmdca|cmdi|cmas/i.test(unit);
    for (const c of u.categories || []) {
      const cat = c.catName || '';
      for (const it of c.items || []) {
        const qty = Number(it.qty) || 0;
        const mat = it.material || '';
        const ok = isExpedienteCat(cat) || (isCmdCouncil && isExpedienteItem(mat));
        if (!ok) continue;
        add(unit, mat, qty, cat);
      }
    }
  }
}

for (const u of registered) {
  const d = displayUnit(u);
  if (!byUnit.has(d)) byUnit.set(d, new Map());
}

const __dir = dirname(fileURLToPath(import.meta.url));
const lines = ['Unidade;Item;Quantidade'];
const allUnits = [...byUnit.keys()].sort((a, b) => a.localeCompare(b, 'pt-BR'));

let grand = 0;
console.log(`LISTA COMPLETA — Expediente | CTs + CMDCA + CMDI + CMAS | ${YEAR}\n`);

for (const unit of allUnits) {
  const items = [...(byUnit.get(unit) || new Map()).entries()]
    .filter(([, q]) => q > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'pt-BR'));
  const total = items.reduce((s, [, q]) => s + q, 0);
  grand += total;
  console.log(`▶ ${unit} — ${total} unidades`);
  if (!items.length) console.log('   (sem entrega registrada)\n');
  else {
    for (const [item, qty] of items) {
      console.log(`   • ${item}: ${qty}`);
      lines.push(`${unit};${item};${qty}`);
    }
    console.log('');
  }
}

console.log(`TOTAL GERAL: ${grand} unidades`);

const out = join(__dir, `lista-itens-expediente-cts-e-conselhos-${YEAR}.csv`);
writeFileSync(out, '\uFEFF' + lines.join('\n'), 'utf8');
console.log(`\nArquivo: ${out}`);
