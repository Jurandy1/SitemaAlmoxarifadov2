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
const email = process.env.FB_EMAIL;
const password = process.env.FB_PASSWORD;
if (!email || !password) process.exit(1);

function rmAcc(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
function normKey(s) {
  return rmAcc(s).toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
}
function isCTLike(name, tipo) {
  const n = String(name || '');
  const t = String(tipo || '').toUpperCase();
  return (
    t === 'CT' ||
    /^ct\b/i.test(n) ||
    /^ct[\s./-]/i.test(n) ||
    /conselho\s*tutelar/i.test(n)
  );
}

const app = initializeApp(firebaseConfig);
await signInWithEmailAndPassword(getAuth(app), email, password);
const db = getFirestore(app);

// 1) Cadastro unidades
const unidadesSnap = await getDocs(collection(db, `${BASE}/unidades`));
const cadastrados = [];
const todosCadastro = [];

unidadesSnap.docs.forEach((d) => {
  const u = { id: d.id, ...d.data() };
  const nome = u.nome || u.unidadeNome || '';
  todosCadastro.push({ nome, tipo: u.tipo || '', sigla: u.sigla || '' });
  if (isCTLike(nome, u.tipo)) {
    cadastrados.push({ nome, tipo: u.tipo || '', sigla: u.sigla || '', fonte: 'cadastro' });
  }
});

// 2) Nomes no histórico 2026
const histSnap = await getDocs(query(collection(db, `${BASE}/semcasHistDB`), orderBy('weekStart', 'desc')));
const noHistorico = new Map(); // normKey -> { names: Set, entregas: n, expediente: n, anos: Set }

for (const doc of histSnap.docs) {
  const e = doc.data();
  for (const u of e.units || []) {
    const name = u.unitName || '';
    if (!isCTLike(name)) continue;
    const k = normKey(name);
    if (!noHistorico.has(k)) noHistorico.set(k, { names: new Set(), entregas: 0, expediente: 0, anos: new Set() });
    const row = noHistorico.get(k);
    row.names.add(name);
    row.anos.add(e.year);
    if (e.year === YEAR) {
      row.entregas++;
      const exp = (u.categories || []).some((c) => /expediente/i.test(c.catName || ''));
      if (exp) row.expediente++;
    }
  }
}

// 3) controleMateriais
const matsSnap = await getDocs(query(collection(db, `${BASE}/controleMateriais`), orderBy('registradoEm', 'desc')));
const noWorkflow = new Map();

for (const d of matsSnap.docs) {
  const data = d.data();
  const unit = data.unidadeNome || '';
  if (!isCTLike(unit, data.tipoUnidade)) continue;
  const k = normKey(unit);
  if (!noWorkflow.has(k)) noWorkflow.set(k, { names: new Set(), entregues: 0 });
  noWorkflow.get(k).names.add(unit);
  if (data.status === 'entregue') noWorkflow.get(k).entregues++;
}

// 4) Busca ampla — qualquer nome suspeito no histórico
const suspeitos = new Set();
for (const doc of histSnap.docs) {
  const e = doc.data();
  for (const u of e.units || []) {
    const name = u.unitName || '';
    const n = rmAcc(name).toLowerCase();
    if (
      /tutelar|ct\b|ct[\s./-]|zona\s*rural|anil|bequim|centro|alemanha|cohab|cohatrac|operaria|olimpica|coroadinho|joao\s*paulo|itaqui|bacanga|cristovao|raimundo|francisco|cohama|vila\s*luiz|turu/i.test(n)
    ) {
      suspeitos.add(name);
    }
  }
}

console.log('='.repeat(72));
console.log('INVESTIGAÇÃO — 10 CONSELHOS TUTELARES');
console.log('='.repeat(72));

console.log(`\n📋 CTs NO CADASTRO (tipo CT ou nome CT/Conselho Tutelar): ${cadastrados.length}\n`);
cadastrados.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')).forEach((c, i) => {
  const hist = [...noHistorico.entries()].find(([k]) => k === normKey(c.nome) || normKey(c.nome).includes(k) || k.includes(normKey(c.nome)));
  const histInfo = hist ? `histórico 2026: ${hist[1].entregas} registro(s), expediente: ${hist[1].expediente}` : 'SEM registro no histórico 2026';
  console.log(`${i + 1}. ${c.nome}`);
  console.log(`   Tipo: ${c.tipo || '?'} | Sigla: ${c.sigla || '-'} | ${histInfo}`);
});

console.log(`\n📦 NOMES DE CT NO HISTÓRICO (todas as variações, qualquer ano): ${noHistorico.size}\n`);
[...noHistorico.entries()].sort((a, b) => [...a[1].names][0].localeCompare([...b[1].names][0], 'pt-BR')).forEach(([k, v]) => {
  const names = [...v.names].join(' | ');
  const em2026 = v.anos.has(YEAR) ? 'SIM' : 'não';
  console.log(`• ${names}`);
  console.log(`  Chave: "${k}" | Em 2026: ${em2026} | Registros 2026: ${v.entregas} | Com expediente: ${v.expediente}`);
});

console.log('\n🔍 CTs CADASTRADOS SEM NENHUM REGISTRO EM 2026:');
const semRegistro = cadastrados.filter((c) => {
  const ck = normKey(c.nome);
  return ![...noHistorico.entries()].some(([k, v]) => {
    if (!v.anos.has(YEAR)) return false;
    return k === ck || ck.includes(k) || k.includes(ck);
  });
});
semRegistro.forEach((c) => console.log(`  ⚠️  ${c.nome} (tipo: ${c.tipo})`));

console.log('\n🔗 NOMES NO HISTÓRICO QUE PARECEM CT MAS NÃO BATEM COM CADASTRO:');
const cadKeys = new Set(cadastrados.map((c) => normKey(c.nome)));
for (const [k, v] of noHistorico.entries()) {
  if (!v.anos.has(YEAR)) continue;
  const match = [...cadKeys].some((ck) => ck === k || ck.includes(k) || k.includes(ck));
  if (!match) {
    console.log(`  ❓ ${[...v.names].join(' | ')} (${v.entregas} registros em 2026)`);
  }
}

console.log('\n📝 NOMES SUSPEITOS NO HISTÓRICO (busca ampla):');
[...suspeitos].sort((a, b) => a.localeCompare(b, 'pt-BR')).forEach((n) => {
  const ct = isCTLike(n) ? '✓ CT' : '  ?';
  console.log(`  ${ct}  ${n}`);
});

// Mapeamento sugerido de duplicatas
console.log('\n🗺️  MAPEAMENTO SUGERIDO (variações → CT oficial):');
const grupos = [
  ['Anil/Bequimão', ['anil', 'bequim', 'ct anil']],
  ['Centro/Alemanha', ['centro', 'alemanha', 'ct centro']],
  ['Cidade Operária/Cidade Olímpica', ['operaria', 'olimpica', 'cidade oper']],
  ['Cohab/Cohatrac', ['cohab', 'cohatrac']],
  ['Coroadinho/João Paulo', ['coroadinho', 'joao paulo']],
  ['Ct Zona Rural', ['zona rural']],
  ['Itaqui-Bacanga', ['itaqui', 'bacanga', 'ct itaqui']],
  ['São Cristóvão/São Raimundo', ['cristovao', 'raimundo']],
  ['São Francisco/Cohama', ['francisco', 'cohama']],
  ['Vila Luizão/Turu', ['vila luiz', 'turu']],
];

for (const [oficial, termos] of grupos) {
  const variacoes = [];
  for (const [k, v] of noHistorico.entries()) {
    if (!v.anos.has(YEAR)) continue;
    if (termos.some((t) => k.includes(t))) variacoes.push([...v.names].join(' / '));
  }
  const cad = cadastrados.find((c) => normKey(c.nome).includes(normKey(oficial).split(' ')[0]));
  const status = variacoes.length ? `✅ ${variacoes.join(' | ')}` : '❌ SEM dados em 2026';
  console.log(`  ${oficial}: ${status}`);
}

// CSV
const outDir = join(dirname(fileURLToPath(import.meta.url)), 'planilhas');
mkdirSync(outDir, { recursive: true });
const rows = [
  ['#', 'Nome no Cadastro', 'Tipo', 'Registros 2026', 'Expediente 2026', 'Variações no Histórico', 'Status'],
];
cadastrados.sort((a, b) => a.nome.localeCompare(b, 'pt-BR')).forEach((c, i) => {
  const ck = normKey(c.nome);
  let regs = 0, exp = 0, vars = [];
  for (const [k, v] of noHistorico.entries()) {
    if (!v.anos.has(YEAR)) continue;
    if (k === ck || ck.includes(k) || k.includes(ck) || grupos.some(([of, t]) => normKey(of) === ck && t.some((x) => k.includes(x)))) {
      regs += v.entregas;
      exp += v.expediente;
      vars.push(...v.names);
    }
  }
  const status = regs > 0 ? 'Com entregas' : 'SEM entregas em 2026';
  rows.push([i + 1, c.nome, c.tipo, regs, exp, [...new Set(vars)].join(' | '), status]);
});
const csvPath = join(outDir, 'mapeamento-10-cts-2026.csv');
writeFileSync(csvPath, '\uFEFF' + rows.map((r) => r.join(';')).join('\n'), 'utf8');
console.log(`\n📄 Planilha salva: ${csvPath}`);
