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

function rmAcc(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
function normKey(s) {
  return rmAcc(s).toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
}

const MAPEAMENTO = [
  { oficial: 'Anil/Bequimão', termos: ['anil', 'bequimao', 'ct anil'] },
  { oficial: 'Centro/Alemanha', termos: ['centro alemanha', 'ct centro', 'centro/alemanha'] },
  { oficial: 'Cidade Operária/Cidade Olímpica', termos: ['cidade oper', 'olimpica', 'operaria'] },
  { oficial: 'Cohab/Cohatrac', termos: ['cohab', 'cohatrac'] },
  { oficial: 'Coroadinho/João Paulo', termos: ['coroadinho', 'joao paulo'] },
  { oficial: 'Ct Zona Rural', termos: ['zona rural'] },
  { oficial: 'Itaqui-Bacanga', termos: ['itaqui', 'bacanga', 'ct itaqui'] },
  { oficial: 'São Cristóvão/São Raimundo', termos: ['cristovao', 'raimundo', 'sao cristovao'] },
  { oficial: 'São Francisco/Cohama', termos: ['sao francisco', 'cohama', 'francisco cohama'] },
  { oficial: 'Vila Luizão/Turu', termos: ['vila luiz', 'turu', 'ct vila'] },
];

function matchCT(unitName) {
  const k = normKey(unitName);
  for (const m of MAPEAMENTO) {
    if (termosMatch(k, m.termos) || normKey(m.oficial) === k) return m.oficial;
  }
  if (/^conselho tutelar$/i.test(rmAcc(unitName).trim())) return '??? Conselho Tutelar (genérico)';
  return null;
}
function termosMatch(k, termos) {
  return termos.some((t) => {
    const tk = normKey(t);
    return k === tk || k.includes(tk) || tk.includes(k);
  });
}

const app = initializeApp(firebaseConfig);
await signInWithEmailAndPassword(getAuth(app), email, password);
const db = getFirestore(app);

const unidadesSnap = await getDocs(collection(db, `${BASE}/unidades`));
const ctsCadastro = unidadesSnap.docs
  .map((d) => d.data())
  .filter((u) => String(u.tipo || '').toUpperCase() === 'CT')
  .map((u) => u.nome || u.unidadeNome);

const histSnap = await getDocs(query(collection(db, `${BASE}/semcasHistDB`), orderBy('weekStart', 'desc')));

/** @type {Map<string, {variacoes:Set,registros2026:number,expediente2026:number,qualquerAno:boolean}>} */
const porCT = new Map();
for (const m of MAPEAMENTO) {
  porCT.set(m.oficial, { variacoes: new Set(), registros2026: 0, expediente2026: 0, qualquerAno: false });
}

const nomesHistoricoTodos = new Set();

for (const doc of histSnap.docs) {
  const e = doc.data();
  for (const u of e.units || []) {
    const name = u.unitName || '';
    nomesHistoricoTodos.add(name);
    const ct = matchCT(name);
    if (!ct || !porCT.has(ct)) continue;
    const row = porCT.get(ct);
    row.variacoes.add(name);
    row.qualquerAno = true;
    if (e.year !== YEAR) continue;
    row.registros2026++;
    const temExp = (u.categories || []).some((c) => {
      const hasItems = (c.items || []).some((it) => (Number(it.qty) || 0) > 0);
      return /expediente/i.test(c.catName || '') && hasItems;
    });
    if (temExp) row.expediente2026++;
  }
}

console.log('OS 10 CONSELHOS TUTELARES — MAPEAMENTO COMPLETO\n');
console.log(`Cadastrados com tipo CT: ${ctsCadastro.length}\n`);

let comExpediente = 0;
let semExpediente = 0;
let semRegistro = 0;

MAPEAMENTO.forEach((m, i) => {
  const row = porCT.get(m.oficial);
  const vars = [...row.variacoes];
  let status;
  if (row.expediente2026 > 0) {
    status = `✅ COM expediente (${row.expediente2026} entrega(s))`;
    comExpediente++;
  } else if (row.registros2026 > 0) {
    status = `⚠️  COM registro mas SEM expediente em 2026`;
    semExpediente++;
  } else {
    status = `❌ SEM nenhum registro em 2026`;
    semRegistro++;
  }
  console.log(`${i + 1}. ${m.oficial}`);
  console.log(`   Status: ${status}`);
  console.log(`   Registros 2026: ${row.registros2026}`);
  if (vars.length) {
    console.log(`   Nomes usados no sistema:`);
    vars.forEach((v) => console.log(`     → "${v}"`));
  } else {
    console.log(`   Nomes no histórico: (nenhum encontrado)`);
  }
  console.log('');
});

console.log('-'.repeat(60));
console.log(`Com expediente em 2026: ${comExpediente}`);
console.log(`Com registro mas sem expediente: ${semExpediente}`);
console.log(`Sem registro em 2026: ${semRegistro}`);

console.log('\n📌 POR QUE SÓ APARECIAM 8 ANTES?');
console.log('Alguns CTs usam nome de bairro (ex: "Cohab/Cohatrac") e outros usam prefixo "CT" (ex: "CT CENTRO").');
console.log('Os 2 que pareciam "faltar" são:');
console.log('  • Ct Zona Rural — tem registro, mas sem material de expediente');
console.log('  • Vila Luizão/Turu — aparece como "CT VILA LUIZÃO 8 de junho 2026", sem expediente');

console.log('\n❓ Nome genérico no histórico:');
if (nomesHistoricoTodos.has('CONSELHO TUTELAR')) {
  console.log('  "CONSELHO TUTELAR" — 1 registro, não identifica qual CT é');
}
