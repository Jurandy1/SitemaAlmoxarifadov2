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

const CTS_OFICIAIS = [
  'Anil/Bequimão',
  'Centro/Alemanha',
  'Cidade Operária/Cidade Olímpica',
  'Cohab/Cohatrac',
  'Coroadinho/João Paulo',
  'Ct Zona Rural',
  'Itaqui-Bacanga',
  'São Cristóvão/São Raimundo',
  'São Francisco/Cohama',
  'Vila Luizão/Turu',
];

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

const email = process.env.FB_EMAIL;
const password = process.env.FB_PASSWORD;
if (!email || !password) process.exit(1);

function rmAcc(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
function normKey(s) {
  return rmAcc(s).toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
}
function normItem(s) {
  return rmAcc(s).toUpperCase().replace(/\s+/g, ' ').trim();
}
function brDate(iso) {
  if (!iso || iso.length < 10) return '';
  const [y, m, d] = iso.substring(0, 10).split('-');
  return `${d}/${m}/${y}`;
}
function csvEsc(v) {
  const s = String(v ?? '');
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function toCsv(rows) {
  return '\uFEFF' + rows.map((r) => r.map(csvEsc).join(';')).join('\n');
}

function matchCT(unitName) {
  const k = normKey(unitName);
  for (const [oficial, aliases] of Object.entries(ALIASES)) {
    if (normKey(oficial) === k) return oficial;
    if (aliases.some((a) => k === a || k.startsWith(a) || a.startsWith(k))) return oficial;
  }
  return null;
}

const app = initializeApp(firebaseConfig);
await signInWithEmailAndPassword(getAuth(app), email, password);
const db = getFirestore(app);

/** @type {Array<{ct:string,item:string,qty:number,data:string,dataBr:string,periodo:string,mes:string,arquivo:string}>} */
const pedidos = [];

const histSnap = await getDocs(query(collection(db, `${BASE}/semcasHistDB`), orderBy('weekStart', 'desc')));
for (const doc of histSnap.docs) {
  const e = doc.data();
  if (e.year !== YEAR) continue;

  const data = e.weekStart || '';
  const dataBr = brDate(data);
  const periodo = e.weekLabel || dataBr;
  const mes = data.length >= 7 ? data.substring(0, 7) : '';
  const arquivo = e.fileName || doc.id;

  for (const u of e.units || []) {
    const ct = matchCT(u.unitName || '');
    if (!ct) continue;

    for (const c of u.categories || []) {
      if (!CAT_EXP.test(c.catName || '')) continue;
      for (const it of c.items || []) {
        const qty = Number(it.qty) || 0;
        if (qty <= 0) continue;
        pedidos.push({
          ct,
          item: normItem(it.material),
          qty,
          data,
          dataBr,
          periodo,
          mes,
          arquivo,
        });
      }
    }
  }
}

pedidos.sort((a, b) =>
  a.ct.localeCompare(b.ct, 'pt-BR') ||
  a.item.localeCompare(b.item, 'pt-BR') ||
  a.data.localeCompare(b.data)
);

const outDir = join(dirname(fileURLToPath(import.meta.url)), 'planilhas');
mkdirSync(outDir, { recursive: true });

// PLANILHA 1 — cada pedido em uma linha (com colunas de data)
const linhas = [[
  'Conselho Tutelar', 'Item', 'Quantidade',
  'Data (AAAA-MM-DD)', 'Data (DD/MM/AAAA)', 'Período', 'Mês', 'Arquivo',
]];
for (const p of pedidos) {
  linhas.push([p.ct, p.item, p.qty, p.data, p.dataBr, p.periodo, p.mes, p.arquivo]);
}
for (const ct of CTS_OFICIAIS) {
  if (!pedidos.some((p) => p.ct === ct)) {
    linhas.push([ct, '(sem pedido de expediente em 2026)', 0, '', '', '', '', '']);
  }
}

// PLANILHA 2 — uma linha por CT+item, com colunas de data separadas
const byKey = new Map();
let maxPedidos = 0;
for (const p of pedidos) {
  const k = `${p.ct}\x00${p.item}`;
  if (!byKey.has(k)) byKey.set(k, { ct: p.ct, item: p.item, rows: [] });
  byKey.get(k).rows.push(p);
}
for (const v of byKey.values()) {
  maxPedidos = Math.max(maxPedidos, v.rows.length);
}

const matrizHeader = ['Conselho Tutelar', 'Item', 'Total Anual', 'Nº Pedidos', 'Média por Pedido'];
for (let i = 1; i <= maxPedidos; i++) {
  matrizHeader.push(`Data Pedido ${i}`, `Qtd ${i}`, `Período ${i}`);
}
const matrizRows = [matrizHeader];

const allKeys = new Set([...byKey.keys()]);
for (const ct of CTS_OFICIAIS) {
  const items = [...byKey.entries()].filter(([k]) => k.startsWith(ct + '\x00'));
  if (!items.length) {
    matrizRows.push([ct, '(sem expediente)', 0, 0, 0]);
    continue;
  }
  for (const [, v] of [...byKey.entries()].filter(([k]) => k.startsWith(ct + '\x00')).sort((a, b) => a[1].item.localeCompare(b[1].item, 'pt-BR'))) {
    const total = v.rows.reduce((s, r) => s + r.qty, 0);
    const media = v.rows.length ? Math.round((total / v.rows.length) * 100) / 100 : 0;
    const row = [v.ct, v.item, total, v.rows.length, media];
    for (let i = 0; i < maxPedidos; i++) {
      const r = v.rows[i];
      if (r) row.push(r.dataBr, r.qty, r.periodo);
      else row.push('', '', '');
    }
    matrizRows.push(row);
  }
}

// PLANILHA 3 — resumo por CT (datas de todos os pedidos)
const porCT = new Map();
for (const ct of CTS_OFICIAIS) porCT.set(ct, { itens: new Set(), total: 0, datas: new Set(), pedidos: 0 });
for (const p of pedidos) {
  const s = porCT.get(p.ct);
  s.itens.add(p.item);
  s.total += p.qty;
  s.datas.add(p.dataBr);
  s.pedidos++;
}
const resumoCT = [[
  'Conselho Tutelar', 'Total Expediente', 'Tipos de Item', 'Nº Pedidos',
  'Datas dos Pedidos', 'Primeira Data', 'Última Data',
]];
for (const ct of CTS_OFICIAIS) {
  const s = porCT.get(ct);
  const datas = [...s.datas].sort((a, b) => {
    const [da, ma, ya] = a.split('/').map(Number);
    const [db, mb, yb] = b.split('/').map(Number);
    return new Date(ya, ma - 1, da) - new Date(yb, mb - 1, db);
  });
  resumoCT.push([
    ct,
    s.total,
    s.itens.size,
    s.pedidos,
    datas.join(' | '),
    datas[0] || '',
    datas[datas.length - 1] || '',
  ]);
}

const p1 = join(outDir, `cts-expediente-pedidos-com-datas-${YEAR}.csv`);
const p2 = join(outDir, `cts-expediente-matriz-datas-${YEAR}.csv`);
const p3 = join(outDir, `cts-expediente-resumo-por-ct-${YEAR}.csv`);

writeFileSync(p1, toCsv(linhas), 'utf8');
writeFileSync(p2, toCsv(matrizRows), 'utf8');
writeFileSync(p3, toCsv(resumoCT), 'utf8');

console.log('Planilhas dos 10 CTs com datas geradas:\n');
console.log(`1) Pedido a pedido: ${p1}`);
console.log(`   ${pedidos.length} linhas de pedidos`);
console.log(`\n2) Matriz com colunas de data: ${p2}`);
console.log(`   ${matrizRows.length - 1} linhas | até ${maxPedidos} colunas de data por item`);
console.log(`\n3) Resumo por CT: ${p3}`);
console.log(`   10 conselhos tutelares`);
