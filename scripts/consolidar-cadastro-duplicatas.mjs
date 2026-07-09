/**
 * Unifica unidades duplicadas no cadastro:
 * - Atualiza histórico e requisições para o nome canônico
 * - Salva aliases
 * - Desativa duplicata no cadastro (atendeMateriais: false)
 *
 * Uso: node scripts/consolidar-cadastro-duplicatas.mjs [--apply]
 */
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, collection, getDocs, doc, writeBatch, getDoc, setDoc, query, orderBy } from 'firebase/firestore';
import { key, createResolver } from './unit-mappings-shared.mjs';

const APPLY = process.argv.includes('--apply');
const BASE = 'artifacts/default-app-id/public/data';

const firebaseConfig = {
  apiKey: 'AIzaSyD7VCxaHo8veaHnM8RwY60EX_DEh3hOVHk',
  authDomain: 'controle-almoxarifado-semcas.firebaseapp.com',
  projectId: 'controle-almoxarifado-semcas',
  storageBucket: 'controle-almoxarifado-semcas.firebasestorage.app',
  messagingSenderId: '916615427315',
  appId: '1:916615427315:web:6823897ed065c50d413386',
};

/**
 * duplicata → nome canônico no cadastro (deve existir como unidade oficial)
 * duplicataIds: docs a desativar no cadastro
 */
const CONSOLIDACOES = [
  {
    label: 'Alta Complexidade = Superintendência PSE Alta',
    duplicata: 'ALTA COMPLEXIDADE',
    canonico: 'SuperintendêNcia De ProteçãO Social Especial De Alta Complexidade/CoordenaçãO Dos ServiçOs De Acolhimento Familiar E Institucional',
    desativarIds: ['AOQDLwgYNvzf4YhTHumD'],
    aliasExtras: ['ALTA COMPLEXIDADE', 'SPSE ALTA COMPLEXIDADE', 'SUPERINTENDENCIA DE ALTA COMPLEXIDADE'],
  },
  {
    label: 'Secretário Adjunto de Gestão (2 cadastros iguais)',
    duplicata: 'SecretáRio Adjunto De GestãO',
    canonico: 'SecretáRio Adjunto De GestãO',
    desativarIds: ['o4w4I3rxR8lFiECTVaSI'],
    manterId: '3VcdS3uofQCXEtKWAgJa',
  },
  {
    label: 'Diretoria acolhimento — variante sem "De"',
    duplicata: 'Diretoria TéCnica De Acolhimento Institucional/Diretoria TéCnica Da Central De Acolhimento/Diretoria TéCnica De Acolhimento Em FamíLia Acolhedora (SuperintendêNcia Alta Complexidade)',
    canonico: 'Diretoria TéCnica De Acolhimento Institucional/Diretoria TéCnica Da Central De Acolhimento/Diretoria TéCnica De Acolhimento Em FamíLia Acolhedora (SuperintendêNcia De Alta Complexidade)',
    desativarIds: ['H2pcPfPAbK6mlIQHPZ0e'],
    manterId: 'Ms92pA8hEMLkd6WiVATQ',
  },
];

const email = process.env.FB_EMAIL;
const password = process.env.FB_PASSWORD;
if (!email || !password) process.exit(1);

const app = initializeApp(firebaseConfig);
await signInWithEmailAndPassword(getAuth(app), email, password);
const db = getFirestore(app);

const unidadesSnap = await getDocs(collection(db, `${BASE}/unidades`));
const registered = unidadesSnap.docs.map((d) => {
  const u = d.data();
  return { id: d.id, nome: String(u.nome || u.unidadeNome || '').trim(), ...u };
}).filter((u) => u.nome);

function findReg(name) {
  return registered.find((r) => key(r.nome) === key(name)) || null;
}

const aliasSnap = await getDoc(doc(db, `${BASE}/semcasAliases`, 'config'));
const aliases = aliasSnap.exists() ? { ...(aliasSnap.data()?.aliases || {}) } : {};
const { resolveUnit } = createResolver(registered.map((r) => r.nome), aliases);

const stats = { histRenamed: 0, matsRenamed: 0, aliases: 0, desativadas: 0 };
const newAliases = {};
const histUpdates = [];
const matsUpdates = [];
const unitDeactivations = [];

for (const c of CONSOLIDACOES) {
  const canon = findReg(c.canonico);
  if (!canon) {
    console.warn(`⚠️  Canônico não encontrado: ${c.canonico}`);
    continue;
  }

  const namesToReplace = new Set([c.duplicata, ...(c.aliasExtras || [])]);
  if (key(c.duplicata) !== key(c.canonico)) namesToReplace.add(c.duplicata);

  for (const n of namesToReplace) {
    if (key(n) !== key(canon.nome)) {
      newAliases[key(n)] = canon.nome;
      stats.aliases++;
    }
  }

  for (const id of c.desativarIds || []) {
    unitDeactivations.push({
      id,
      data: {
        atendeMateriais: false,
        atendeAgua: false,
        atendeGas: false,
        duplicataDe: c.manterId || canon.id,
        nomeCanonico: canon.nome,
        observacao: `Unificado em: ${canon.nome}`,
      },
    });
  }
}

const histSnap = await getDocs(query(collection(db, `${BASE}/semcasHistDB`), orderBy('weekStart', 'desc')));
for (const d of histSnap.docs) {
  const data = d.data();
  let changed = false;
  const units = (data.units || []).map((u) => {
    const raw = u.rawUnit || u.unitName || '';
    let resolved = resolveUnit(raw, data.fileName) || u.unitName;
    for (const c of CONSOLIDACOES) {
      const canon = findReg(c.canonico);
      if (!canon) continue;
      if (key(u.unitName) === key(c.duplicata) || key(raw) === key(c.duplicata)) {
        resolved = canon.nome;
      }
      for (const ex of c.aliasExtras || []) {
        if (key(u.unitName) === key(ex) || key(raw) === key(ex)) resolved = canon.nome;
      }
    }
    if (resolved && key(resolved) !== key(u.unitName)) {
      stats.histRenamed++;
      changed = true;
      return { ...u, unitName: resolved, rawUnit: raw || u.unitName };
    }
    return u;
  });
  if (changed) histUpdates.push({ id: d.id, data: { ...data, units } });
}

const matsSnap = await getDocs(query(collection(db, `${BASE}/controleMateriais`), orderBy('registradoEm', 'desc')));
for (const d of matsSnap.docs) {
  const data = d.data();
  const raw = data.unidadeNomeInvalida || data.unidadeNome || '';
  let resolved = data.unidadeNome;
  for (const c of CONSOLIDACOES) {
    const canon = findReg(c.canonico);
    if (!canon) continue;
    if (key(raw) === key(c.duplicata) || key(data.unidadeNome) === key(c.duplicata)) {
      resolved = canon.nome;
    }
    for (const ex of c.aliasExtras || []) {
      if (key(raw) === key(ex) || key(data.unidadeNome) === key(ex)) resolved = canon.nome;
    }
  }
  if (resolved && key(resolved) !== key(data.unidadeNome)) {
    stats.matsRenamed++;
    matsUpdates.push({
      id: d.id,
      data: {
        ...data,
        unidadeNome: resolved,
        deleted: false,
        unidadeNomeInvalida: null,
      },
    });
  }
}

console.log('='.repeat(70));
console.log(APPLY ? 'CONSOLIDANDO CADASTRO' : 'SIMULAÇÃO — use --apply');
console.log('='.repeat(70));
console.log('\nGrupos:');
CONSOLIDACOES.forEach((c) => {
  const ok = findReg(c.canonico);
  console.log(`  ${ok ? '✅' : '❌'} ${c.label}`);
  console.log(`     "${c.duplicata}" → "${c.canonico}"`);
  if (c.desativarIds?.length) console.log(`     desativar ${c.desativarIds.length} cadastro(s) duplicado(s)`);
});
console.log(`\nHistórico: ${histUpdates.length} docs, ${stats.histRenamed} blocos renomeados`);
console.log(`Requisições: ${matsUpdates.length} corrigidas`);
console.log(`Aliases novos: ${stats.aliases}`);
console.log(`Cadastros a desativar: ${unitDeactivations.length}`);

if (!APPLY) {
  console.log('\n⚠️  Nada alterado.');
  process.exit(0);
}

let batch = writeBatch(db);
let ops = 0;
async function flush() {
  if (ops > 0) {
    await batch.commit();
    batch = writeBatch(db);
    ops = 0;
  }
}

for (const h of histUpdates) {
  batch.set(doc(db, `${BASE}/semcasHistDB`, h.id), h.data);
  ops++;
  if (ops >= 400) await flush();
}
await flush();

for (const m of matsUpdates) {
  batch.set(doc(db, `${BASE}/controleMateriais`, m.id), m.data);
  ops++;
  if (ops >= 400) await flush();
}
await flush();

for (const u of unitDeactivations) {
  batch.set(doc(db, `${BASE}/unidades`, u.id), u.data, { merge: true });
  ops++;
  if (ops >= 400) await flush();
}
await flush();

await setDoc(doc(db, `${BASE}/semcasAliases`, 'config'), { aliases: { ...aliases, ...newAliases } }, { merge: true });

console.log('\n✅ Consolidação aplicada.');
