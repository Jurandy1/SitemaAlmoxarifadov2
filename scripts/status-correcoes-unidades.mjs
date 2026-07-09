/**
 * Resumo do estado atual das correções de unidades.
 */
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, collection, getDocs, doc, getDoc, query, orderBy } from 'firebase/firestore';

const BASE = 'artifacts/default-app-id/public/data';
const firebaseConfig = {
  apiKey: 'AIzaSyD7VCxaHo8veaHnM8RwY60EX_DEh3hOVHk',
  authDomain: 'controle-almoxarifado-semcas.firebaseapp.com',
  projectId: 'controle-almoxarifado-semcas',
  storageBucket: 'controle-almoxarifado-semcas.firebasestorage.app',
  messagingSenderId: '916615427315',
  appId: '1:916615427315:web:6823897ed065c50d413386',
};

const email = process.env.FB_EMAIL;
const password = process.env.FB_PASSWORD;
if (!email || !password) process.exit(1);

function rmAcc(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
function key(s) {
  return rmAcc(s).toUpperCase().replace(/\s+/g, ' ').trim();
}

const EXPECTED = [
  ['CRAS VINHAIS', 'Cras Vinhas'],
  ['CRAS TERRITORIO 2 BAIRRO DE FATIMA', 'Cras Bairro De Fatima'],
  ['COORDENACAO DE TRANSPORTE', 'Diretoria Técnica De Transporte'],
  ['SUPERINTENDENCIA DE ADMINISTRACAO', 'Superintendência De Administração'],
  ['CREAS CENTRO', 'Creas Centro'],
  ['CRAS CENTRO', 'Cras Centro'],
  ['CT ANIL BEQUIMÃO', 'Anil/BequimãO'],
  ['CT CENTRO', 'Centro/Alemanha'],
  ['CT ITAQUIBACANGA', 'Itaqui-Bacanga'],
  ['CT VILA LUIZÃO', 'Vila LuizãO/Turu'],
];

const app = initializeApp(firebaseConfig);
await signInWithEmailAndPassword(getAuth(app), email, password);
const db = getFirestore(app);

const unidadesSnap = await getDocs(collection(db, `${BASE}/unidades`));
const registered = unidadesSnap.docs.map((d) => String(d.data().nome || d.data().unidadeNome || '').trim()).filter(Boolean);

function findReg(name) {
  return registered.find((r) => key(r) === key(name)) || null;
}

const aliasSnap = await getDoc(doc(db, `${BASE}/semcasAliases`, 'config'));
const aliases = aliasSnap.exists() ? aliasSnap.data()?.aliases || {} : {};

console.log('=== VÍNCULOS ESPERADOS (aliases salvos) ===\n');
for (const [raw, target] of EXPECTED) {
  const k = key(raw);
  const aliasVal = aliases[k];
  const ok = aliasVal && key(aliasVal) === key(target);
  const regOk = findReg(target);
  console.log(`${ok ? '✅' : aliasVal ? '⚠️' : '❌'} ${raw}`);
  console.log(`     alias: ${aliasVal || '(não salvo)'} → esperado: ${target}`);
  if (!regOk) console.log(`     ⚠️  "${target}" não encontrado no cadastro`);
  console.log('');
}

const matsSnap = await getDocs(query(collection(db, `${BASE}/controleMateriais`), orderBy('registradoEm', 'desc')));
let deletedInvalid = 0;
const deletedList = [];
for (const d of matsSnap.docs) {
  const data = d.data();
  if (data.deleted && data.unidadeNomeInvalida) {
    deletedInvalid++;
    if (deletedList.length < 20) deletedList.push(data.unidadeNomeInvalida);
  }
}

const histSnap = await getDocs(query(collection(db, `${BASE}/semcasHistDB`), orderBy('weekStart', 'desc')));
let histEmpty = 0;
let histCreasWrong = 0;
const wrongCreas = [];
for (const d of histSnap.docs) {
  const data = d.data();
  if (!(data.units || []).length && data.fileName) histEmpty++;
  for (const u of data.units || []) {
    const raw = u.rawUnit || '';
    if (key(u.unitName) === key('Cras Centro') && key(raw).startsWith('CREAS CENTRO')) {
      histCreasWrong++;
      if (wrongCreas.length < 5) wrongCreas.push(`${raw} → ${u.unitName}`);
    }
  }
}

console.log('=== SITUAÇÃO GERAL ===\n');
console.log(`Unidades cadastradas: ${registered.length}`);
console.log(`Total aliases salvos: ${Object.keys(aliases).length}`);
console.log(`Requisições ainda deleted (unidade inválida): ${deletedInvalid}`);
if (deletedList.length) {
  console.log('Exemplos pendentes:');
  deletedList.forEach((s) => console.log(`  • ${s}`));
}
console.log(`\nDocs histórico sem unidades (precisam reimportar): ${histEmpty}`);
console.log(`Hist com CREAS CENTRO ainda em Cras Centro: ${histCreasWrong}`);
if (wrongCreas.length) wrongCreas.forEach((s) => console.log(`  • ${s}`));

// Aliases CREAS apontando para CRAS (erro)
console.log('\n=== ALIASES CREAS→CRAS (erros) ===');
let creasCrasErrors = 0;
for (const [k, v] of Object.entries(aliases)) {
  if (key(k).startsWith('CREAS') && key(v).startsWith('CRAS')) {
    creasCrasErrors++;
    console.log(`  ❌ ${k} → ${v}`);
  }
}
if (!creasCrasErrors) console.log('  ✅ Nenhum');
