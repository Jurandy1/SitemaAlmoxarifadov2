import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, collection, getDocs, query, orderBy } from 'firebase/firestore';
import { writeFileSync, mkdirSync } from 'fs';
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
function isCT(name, tipo) {
  const t = String(tipo || '').toUpperCase();
  const n = String(name || '');
  return t === 'CT' || /^ct\b/i.test(n) || /conselho\s*tutelar/i.test(n);
}
function isCouncil(name, tipo) {
  return isCT(name, tipo) || /cmdca|cmdi|cmas/i.test(String(name || '')) || /cmdca|cmdi|cmas|conselho/i.test(String(tipo || ''));
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
function resolveUnit(raw, registered) {
  const key = normKey(raw);
  for (const u of registered) {
    if (normKey(u) === key) return displayUnit(u);
  }
  const manual = {
    'anil bequimao': 'Anil/Bequimão',
    centro: 'Centro/Alemanha',
    itaquibacanga: 'Itaqui-Bacanga',
  };
  if (manual[key]) return manual[key];
  for (const u of registered) {
    const uk = normKey(u);
    if (uk.includes(key) || key.includes(uk)) return displayUnit(u);
  }
  return displayUnit(raw);
}
function fmtDate(d) {
  if (!d) return '';
  if (typeof d === 'string') return d.substring(0, 10);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function csvEsc(v) {
  const s = String(v ?? '');
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function toCsv(rows) {
  return '\uFEFF' + rows.map((r) => r.map(csvEsc).join(';')).join('\n');
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

function includeUnit(unit) {
  return isCouncil(unit) || /cmdca|cmdi|cmas/i.test(unit) || registered.some((u) => {
    const a = normKey(u), b = normKey(unit);
    return a === b || a.includes(b) || b.includes(a);
  });
}

/** @type {Array<{unit:string,item:string,qty:number,dataInicio:string,dataFim:string,periodo:string,mes:string,origem:string,arquivo:string}>} */
const detalhes = [];

const histSnap = await getDocs(query(collection(db, `${BASE}/semcasHistDB`), orderBy('weekStart', 'desc')));
for (const doc of histSnap.docs) {
  const e = doc.data();
  if (e.year !== YEAR) continue;
  const dataInicio = e.weekStart || '';
  const dataFim = e.weekEnd || '';
  const periodo = e.weekLabel || `${dataInicio} a ${dataFim}`;
  const mes = dataInicio.length >= 7 ? dataInicio.substring(0, 7) : String(e.month || '').padStart(2, '0');
  const arquivo = e.fileName || doc.id;

  for (const u of e.units || []) {
    const unit = u.unitName;
    if (!unit || !includeUnit(unit)) continue;
    const isCmd = /cmdca|cmdi|cmas/i.test(unit);

    for (const c of u.categories || []) {
      const cat = c.catName || '';
      for (const it of c.items || []) {
        const qty = Number(it.qty) || 0;
        if (qty <= 0) continue;
        const ok = isExpedienteCat(cat) || (isCmd && isExpedienteItem(it.material));
        if (!ok) continue;
        detalhes.push({
          unit: resolveUnit(unit, registered),
          item: normItem(it.material),
          qty,
          dataInicio,
          dataFim,
          periodo,
          mes: mes.includes('-') ? mes : `${YEAR}-${mes}`,
          origem: 'Histórico/Planilha',
          arquivo,
        });
      }
    }
  }
}

const matsSnap = await getDocs(query(collection(db, `${BASE}/controleMateriais`), orderBy('registradoEm', 'desc')));
for (const d of matsSnap.docs) {
  const data = d.data();
  if (data.status !== 'entregue') continue;
  const unit = data.unidadeNome || '';
  if (!includeUnit(unit)) continue;

  const entrega = data.dataEntrega?.toDate?.() || (data.dataEntrega ? new Date(data.dataEntrega) : null);
  const reg = data.registradoEm?.toDate?.() || null;
  const ref = entrega || reg;
  if (!ref || ref.getFullYear() !== YEAR) continue;

  const dataInicio = fmtDate(ref);
  const dataFim = dataInicio;
  const periodo = data.periodLabel || dataInicio;
  const mes = dataInicio.substring(0, 7);
  const isCmd = /cmdca|cmdi|cmas/i.test(unit);
  const tipos = [data.tipoMaterial, ...(data.tiposMaterial || [])].filter(Boolean);

  for (const [key, val] of Object.entries(data.itemsMap || {})) {
    const cat = val?.categoria || val?.cat || val?.tipo || key;
    const mat = val?.material || val?.nome || key;
    const qty = Number(val?.qty ?? val?.quantidade ?? 0);
    if (qty <= 0) continue;
    const ok = isExpedienteCat(cat) || tipos.some((t) => isExpedienteCat(t)) || (isCmd && isExpedienteItem(mat));
    if (!ok) continue;
    detalhes.push({
      unit: resolveUnit(unit, registered),
      item: normItem(mat),
      qty,
      dataInicio,
      dataFim,
      periodo,
      mes,
      origem: 'Sistema (entrega)',
      arquivo: data.fileName || d.id,
    });
  }
}

detalhes.sort((a, b) =>
  a.unit.localeCompare(b.unit, 'pt-BR') ||
  a.item.localeCompare(b.item, 'pt-BR') ||
  a.dataInicio.localeCompare(b.dataInicio)
);

// Resumo para média anual
/** @type {Map<string, {unit:string,item:string,total:number,pedidos:number,meses:Set<string>,primeiro:string,ultimo:string}>} */
const resumoMap = new Map();
for (const r of detalhes) {
  const k = `${r.unit}\x00${r.item}`;
  if (!resumoMap.has(k)) {
    resumoMap.set(k, { unit: r.unit, item: r.item, total: 0, pedidos: 0, meses: new Set(), primeiro: r.dataInicio, ultimo: r.dataInicio });
  }
  const s = resumoMap.get(k);
  s.total += r.qty;
  s.pedidos += 1;
  s.meses.add(r.mes);
  if (r.dataInicio && r.dataInicio < s.primeiro) s.primeiro = r.dataInicio;
  if (r.dataInicio && r.dataInicio > s.ultimo) s.ultimo = r.dataInicio;
}

const resumos = [...resumoMap.values()].sort((a, b) =>
  a.unit.localeCompare(b.unit, 'pt-BR') || a.item.localeCompare(b.item, 'pt-BR')
);

const outDir = join(dirname(fileURLToPath(import.meta.url)), 'planilhas');
mkdirSync(outDir, { recursive: true });

// Aba 1 — cada pedido com data
const detalheRows = [[
  'Unidade', 'Item', 'Quantidade', 'Data Início', 'Data Fim', 'Período', 'Mês', 'Origem', 'Arquivo/Referência',
]];
for (const r of detalhes) {
  detalheRows.push([r.unit, r.item, r.qty, r.dataInicio, r.dataFim, r.periodo, r.mes, r.origem, r.arquivo]);
}

// Aba 2 — média anual
const mediaRows = [[
  'Unidade', 'Item', 'Total Anual', 'Nº de Pedidos', 'Nº de Meses com Pedido', 'Média por Pedido', 'Média Mensal', 'Primeiro Pedido', 'Último Pedido',
]];
for (const s of resumos) {
  const mediaPedido = s.pedidos ? Math.round((s.total / s.pedidos) * 100) / 100 : 0;
  const mediaMensal = s.meses.size ? Math.round((s.total / s.meses.size) * 100) / 100 : 0;
  mediaRows.push([
    s.unit, s.item, s.total, s.pedidos, s.meses.size,
    mediaPedido, mediaMensal, s.primeiro, s.ultimo,
  ]);
}

// Aba 3 — visão por unidade (datas em colunas para cada item)
const porUnidadeRows = [['Unidade', 'Item', 'Datas dos Pedidos (início)', 'Quantidades em cada pedido', 'Total Anual', 'Média por Pedido']];
const byUnitItem = new Map();
for (const r of detalhes) {
  const k = `${r.unit}\x00${r.item}`;
  if (!byUnitItem.has(k)) byUnitItem.set(k, []);
  byUnitItem.get(k).push(r);
}
for (const [k, rows] of [...byUnitItem.entries()].sort()) {
  const [unit, item] = k.split('\x00');
  const datas = rows.map((r) => r.dataInicio).join(' | ');
  const qtds = rows.map((r) => r.qty).join(' | ');
  const total = rows.reduce((s, r) => s + r.qty, 0);
  const media = rows.length ? Math.round((total / rows.length) * 100) / 100 : 0;
  porUnidadeRows.push([unit, item, datas, qtds, total, media]);
}

const p1 = join(outDir, `pedidos-por-data-${YEAR}.csv`);
const p2 = join(outDir, `media-anual-expediente-${YEAR}.csv`);
const p3 = join(outDir, `datas-e-quantidades-por-item-${YEAR}.csv`);

writeFileSync(p1, toCsv(detalheRows), 'utf8');
writeFileSync(p2, toCsv(mediaRows), 'utf8');
writeFileSync(p3, toCsv(porUnidadeRows), 'utf8');

console.log('Planilhas geradas:\n');
console.log(`1) Pedidos com datas (linha a linha): ${p1}`);
console.log(`   ${detalhes.length} registros`);
console.log(`\n2) Média anual (resumo): ${p2}`);
console.log(`   ${resumos.length} combinações unidade+item`);
console.log(`\n3) Datas e quantidades por item: ${p3}`);
console.log(`   ${porUnidadeRows.length - 1} linhas`);
