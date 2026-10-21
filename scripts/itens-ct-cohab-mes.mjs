// Lista os itens do CT Cohab/Cohatrac no mês atual e no mês anterior.
// Uso: node scripts/itens-ct-cohab-mes.mjs [AAAA-MM]  (entra como visitante, só leitura; ou usa FB_EMAIL/FB_PASSWORD)
// (AAAA-MM opcional = "mês atual"; o mês anterior é calculado a partir dele)
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, collection, getDocs } from 'firebase/firestore';
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

const email = process.env.FB_EMAIL;
const password = process.env.FB_PASSWORD;

function ym(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

const argMonth = process.argv[2];
const atual = argMonth && /^\d{4}-\d{2}$/.test(argMonth) ? new Date(`${argMonth}-15T12:00:00`) : new Date();
const anterior = new Date(atual.getFullYear(), atual.getMonth() - 1, 15);
const MESES = [ym(anterior), ym(atual)];

function rmAcc(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function normItem(s) {
  return rmAcc(s).toUpperCase().replace(/\s+/g, ' ').trim();
}

function num(v) {
  if (v == null) return 0;
  const n = Number(String(v).replace(',', '.').match(/-?\d+(\.\d+)?/)?.[0]);
  return Number.isFinite(n) ? n : 0;
}

function toDate(val) {
  if (!val) return null;
  if (val instanceof Date) return Number.isNaN(val.getTime()) ? null : val;
  if (typeof val?.toDate === 'function') {
    try {
      const d = val.toDate();
      return Number.isNaN(d.getTime()) ? null : d;
    } catch {
      return null;
    }
  }
  if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}/.test(val)) {
    const d = new Date(val.slice(0, 10) + 'T12:00:00');
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(val);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Só o Conselho Tutelar — evita pegar CRAS/CREAS da Cohab
function isCtCohab(name, tipo) {
  const n = rmAcc(name).toUpperCase();
  if (!/COHAB|COHATRAC/.test(n)) return false;
  const t = String(tipo || '').toUpperCase();
  if (t === 'CT' || /^CT\b/.test(n) || /CONSELHO\s*TUTELAR/.test(n)) return true;
  // nome canônico do CT no cadastro: "Cohab/Cohatrac"
  return /^COHAB\s*\/\s*COHATRAC$/.test(n.trim());
}

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

console.log('Conectando ao sistema...');
// Leitura é liberada para qualquer usuário autenticado (inclusive visitante anônimo, como no site)
if (email && password) await signInWithEmailAndPassword(auth, email, password);
else await signInAnonymously(auth);

let base = PATHS[0];
for (const path of PATHS) {
  const sizes = await Promise.all(
    ['semcasHistDB', 'controleMateriais'].map(async (c) => (await getDocs(collection(db, `${path}/${c}`))).size),
  );
  if (sizes.some((s) => s > 0)) {
    base = path;
    break;
  }
}

/** linhas: {mes, data, cat, item, sol, ate, origem, unidade, status} */
const rows = [];
const nomesEncontrados = new Set();
const coveredHist = new Set();

const matsSnap = await getDocs(collection(db, `${base}/controleMateriais`));
for (const snap of matsSnap.docs) {
  const doc = { id: snap.id, ...snap.data() };
  if (doc.deleted) continue;
  const unit = doc.unidadeNome || doc.unidade || '';
  if (!isCtCohab(unit, doc.tipoUnidade)) continue;
  const date =
    toDate(doc.dataRequisicao) || toDate(doc.periodStart) || toDate(doc.dataEntrega) || toDate(doc.registradoEm);
  if (!date || !MESES.includes(ym(date))) continue;

  const items = doc.itemsMap || doc.items || {};
  const list = Array.isArray(items) ? items : Object.values(items);
  if (!list.length) continue;

  const reqId = String(doc.v2Id || doc.id);
  coveredHist.add(doc.histEntryId ? String(doc.histEntryId) : 'req_' + reqId);
  coveredHist.add('req_' + reqId);
  nomesEncontrados.add(unit);

  for (const it of list) {
    if (!it?.material) continue;
    rows.push({
      mes: ym(date),
      data: date.toISOString().slice(0, 10),
      cat: it.tipo || it.categoria || it.catName || doc.tipoMaterial || 'Outros',
      item: normItem(it.material),
      sol: num(it.qtdSolicitada),
      ate: num(it.qtdAtendida),
      origem: 'sistema',
      unidade: unit,
      status: String(doc.status || ''),
    });
  }
}

const histSnap = await getDocs(collection(db, `${base}/semcasHistDB`));
for (const snap of histSnap.docs) {
  const entry = { id: snap.id, ...snap.data() };
  if (coveredHist.has(String(entry.id))) continue;
  const date = toDate(entry.weekStart) || toDate(entry.weekEnd);
  if (!date || !MESES.includes(ym(date))) continue;

  for (const u of entry.units || []) {
    const unit = u.unitName || u.rawUnit || '';
    if (!isCtCohab(unit, u.tipoUnidade)) continue;
    nomesEncontrados.add(unit);
    for (const c of u.categories || []) {
      for (const it of c.items || []) {
        if (!it?.material) continue;
        rows.push({
          mes: ym(date),
          data: date.toISOString().slice(0, 10),
          cat: c.catName || 'Outros',
          item: normItem(it.material),
          sol: num(it.qtySolicitada ?? it.qtdSolicitada),
          ate: num(it.qtyAtendida ?? it.qtdAtendida ?? it.qty),
          origem: 'histórico',
          unidade: unit,
          status: 'historico',
        });
      }
    }
  }
}

console.log('\n' + '='.repeat(72));
console.log(`ITENS — CT Cohab/Cohatrac | ${MESES.join(' e ')}`);
console.log(`Fonte: ${base}`);
console.log(`Nomes de unidade encontrados: ${[...nomesEncontrados].join(' | ') || '(nenhum)'}`);
console.log('='.repeat(72));

const csv = ['Mês;Data;Categoria;Item;Solicitado;Atendido;Origem;Status;Unidade (como registrada)'];

for (const mes of MESES) {
  const doMes = rows.filter((r) => r.mes === mes).sort((a, b) => a.data.localeCompare(b.data));
  console.log(`\n▶ ${mes}`);
  if (!doMes.length) {
    console.log('   (nenhum item registrado)');
    continue;
  }
  const datas = [...new Set(doMes.map((r) => r.data))];
  console.log(`   ${doMes.length} linha(s) em ${datas.length} pedido(s)/semana(s): ${datas.join(', ')}`);

  // resumo por item (soma do mês)
  const agg = new Map();
  for (const r of doMes) {
    const k = `${r.cat}||${r.item}`;
    if (!agg.has(k)) agg.set(k, { cat: r.cat, item: r.item, sol: 0, ate: 0 });
    const a = agg.get(k);
    a.sol += r.sol;
    a.ate += r.ate;
  }
  const porCat = new Map();
  for (const a of agg.values()) {
    if (!porCat.has(a.cat)) porCat.set(a.cat, []);
    porCat.get(a.cat).push(a);
  }
  for (const [cat, itens] of [...porCat.entries()].sort((a, b) => a[0].localeCompare(b[0], 'pt-BR'))) {
    console.log(`   [${cat}]`);
    for (const a of itens.sort((x, y) => x.item.localeCompare(y.item, 'pt-BR'))) {
      console.log(`     • ${a.item}: solicitado ${a.sol} | atendido ${a.ate}`);
    }
  }

  for (const r of doMes) {
    csv.push([r.mes, r.data, r.cat, r.item, r.sol, r.ate, r.origem, r.status, r.unidade].join(';'));
  }
}

const __dir = dirname(fileURLToPath(import.meta.url));
const out = join(__dir, `itens-ct-cohab-${MESES[0]}_${MESES[1]}.csv`);
writeFileSync(out, '﻿' + csv.join('\n'), 'utf8');
console.log(`\nArquivo gerado: ${out}`);
process.exit(0);
