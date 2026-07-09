/**
 * Corrige unidades incorretas no histórico e requisições.
 * Uso: FB_EMAIL=... FB_PASSWORD=... node scripts/corrigir-unidades-historico.mjs
 *      FB_EMAIL=... FB_PASSWORD=... node scripts/corrigir-unidades-historico.mjs --apply
 */
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, collection, getDocs, doc, writeBatch, getDoc, setDoc, query, orderBy } from 'firebase/firestore';
import { key, MANUAL_RAW, createResolver } from './unit-mappings-shared.mjs';

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

const MANUAL_RAW_EXPORT = MANUAL_RAW; // re-export para logs

const email = process.env.FB_EMAIL;
const password = process.env.FB_PASSWORD;
if (!email || !password) {
  console.error('Defina FB_EMAIL e FB_PASSWORD');
  process.exit(1);
}

function rmAcc(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

const app = initializeApp(firebaseConfig);
await signInWithEmailAndPassword(getAuth(app), email, password);
const db = getFirestore(app);

const unidadesSnap = await getDocs(collection(db, `${BASE}/unidades`));
const registered = unidadesSnap.docs.map((d) => {
  const u = d.data();
  return String(u.nome || u.unidadeNome || '').trim();
}).filter(Boolean);

const aliasSnap = await getDoc(doc(db, `${BASE}/semcasAliases`, 'config'));
let aliases = aliasSnap.exists() ? (aliasSnap.data()?.aliases || {}) : {};

// Garantir vínculos confirmados pelo usuário (sobrescreve erros antigos)
for (const [raw, target] of MANUAL_RAW_EXPORT) {
  aliases[key(raw)] = registered.find((r) => key(r) === key(target)) || target;
}
// Corrigir alias antigo errado da transferência de renda
aliases[key('TRANSFERÊNCIA DE RENDA-SGBSTR')] =
  registered.find((r) => key(r).includes('CADASTRO') && key(r).includes('TRANSFERENCIA')) ||
  'Diretoria Técnica De Cadastro úNico E TransferêNcia De Renda';

const { resolveUnit } = createResolver(registered, aliases);

function mergeUnits(units) {
  const map = new Map();
  for (const u of units) {
    const name = u.unitName;
    if (!map.has(name)) {
      map.set(name, { unitName: name, rawUnit: u.rawUnit || name, categories: [] });
    }
    const target = map.get(name);
    if (u.rawUnit && u.rawUnit !== name) target.rawUnit = u.rawUnit;
    for (const c of u.categories || []) {
      let cat = target.categories.find((x) => key(x.catName) === key(c.catName));
      if (!cat) {
        cat = { catName: c.catName, items: [] };
        target.categories.push(cat);
      }
      for (const it of c.items || []) {
        const qty = Number(it.qty) || 0;
        if (qty <= 0) continue;
        const ex = cat.items.find((x) => key(x.material) === key(it.material));
        if (ex) ex.qty += qty;
        else cat.items.push({ material: it.material, qty });
      }
    }
  }
  return [...map.values()];
}

const histSnap = await getDocs(query(collection(db, `${BASE}/semcasHistDB`), orderBy('weekStart', 'desc')));
const matsSnap = await getDocs(query(collection(db, `${BASE}/controleMateriais`), orderBy('registradoEm', 'desc')));

const stats = {
  histDocs: 0,
  histUnitsRenamed: 0,
  histUnitsRemoved: 0,
  histMerged: 0,
  matsFixed: 0,
  matsRestored: 0,
  matsRemoved: 0,
  newAliases: {},
  removedSamples: [],
  renamedSamples: [],
};

const histUpdates = [];
for (const d of histSnap.docs) {
  const data = d.data();
  let changed = false;
  const units = [];

  for (const u of data.units || []) {
    const raw = u.rawUnit || u.unitName || '';
    const resolved = resolveUnit(raw, data.fileName) || resolveUnit(u.unitName, data.fileName);
    if (resolved) {
      if (key(resolved) !== key(u.unitName)) {
        stats.histUnitsRenamed++;
        if (stats.renamedSamples.length < 30) {
          stats.renamedSamples.push(`${u.unitName} → ${resolved}`);
        }
        if (key(raw) !== key(resolved) && !aliases[key(raw)]) {
          stats.newAliases[key(raw)] = resolved;
        }
      }
      units.push({
        ...u,
        unitName: resolved,
        rawUnit: raw || u.unitName,
      });
      changed = true;
    } else {
      stats.histUnitsRemoved++;
      if (stats.removedSamples.length < 30) {
        stats.removedSamples.push(`${u.unitName} (arquivo: ${data.fileName || d.id})`);
      }
      changed = true;
    }
  }

  const merged = mergeUnits(units);
  if (merged.length !== units.length) {
    stats.histMerged++;
    changed = true;
  }

  if (changed) {
    stats.histDocs++;
    histUpdates.push({ id: d.id, data: { ...data, units: merged } });
  }
}

const matsUpdates = [];
for (const d of matsSnap.docs) {
  const data = d.data();
  const fileName = data.fileName || data.arquivoOrigem || '';
  const raw = data.unidadeNomeInvalida || data.unidadeNome || '';
  const resolved = resolveUnit(raw, fileName);
  if (data.deleted && data.unidadeNomeInvalida && resolved) {
    stats.matsRestored++;
    if (key(raw) !== key(resolved) && !stats.newAliases[key(raw)]) {
      stats.newAliases[key(raw)] = resolved;
    }
    matsUpdates.push({
      id: d.id,
      restore: true,
      data: { ...data, unidadeNome: resolved, deleted: false, unidadeNomeInvalida: null },
    });
    continue;
  }
  if (data.deleted) continue;
  const rawActive = data.unidadeNome || '';
  const resolvedActive = resolveUnit(rawActive, fileName);
  if (!resolvedActive) {
    stats.matsRemoved++;
    matsUpdates.push({ id: d.id, markDeleted: true, reason: rawActive });
    continue;
  }
  if (key(resolvedActive) !== key(rawActive)) {
    stats.matsFixed++;
    if (key(rawActive) !== key(resolvedActive) && !stats.newAliases[key(rawActive)]) {
      stats.newAliases[key(rawActive)] = resolvedActive;
    }
    matsUpdates.push({
      id: d.id,
      data: { ...data, unidadeNome: resolvedActive },
    });
  }
}

console.log('='.repeat(70));
console.log(APPLY ? 'APLICANDO CORREÇÕES' : 'SIMULAÇÃO (dry-run) — use --apply para gravar');
console.log('='.repeat(70));
console.log(`Unidades cadastradas: ${registered.length}`);
console.log(`\nHistórico (semcasHistDB):`);
console.log(`  Documentos a corrigir: ${stats.histDocs}`);
console.log(`  Unidades renomeadas: ${stats.histUnitsRenamed}`);
console.log(`  Unidades removidas (sem cadastro): ${stats.histUnitsRemoved}`);
console.log(`  Documentos com merge de duplicatas: ${stats.histMerged}`);
console.log(`\nRequisições (controleMateriais):`);
console.log(`  Corrigidas: ${stats.matsFixed}`);
console.log(`  Restauradas (estavam deleted): ${stats.matsRestored}`);
console.log(`  Marcadas como excluídas (unidade inválida): ${stats.matsRemoved}`);
console.log(`\nNovos vínculos de alias: ${Object.keys(stats.newAliases).length}`);

if (stats.renamedSamples.length) {
  console.log('\nExemplos de renomeação:');
  stats.renamedSamples.slice(0, 15).forEach((s) => console.log(`  • ${s}`));
}
if (stats.removedSamples.length) {
  console.log('\nExemplos removidos (sem unidade cadastrada):');
  stats.removedSamples.slice(0, 15).forEach((s) => console.log(`  • ${s}`));
}

if (!APPLY) {
  console.log('\n⚠️  Nada foi alterado. Rode com --apply para gravar no banco.');
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

for (const u of histUpdates) {
  batch.set(doc(db, `${BASE}/semcasHistDB`, u.id), u.data);
  ops++;
  if (ops >= 400) await flush();
}
await flush();

for (const u of matsUpdates) {
  if (u.markDeleted) {
    batch.update(doc(db, `${BASE}/controleMateriais`, u.id), { deleted: true, unidadeNomeInvalida: u.reason || '' });
  } else if (u.restore) {
    batch.set(doc(db, `${BASE}/controleMateriais`, u.id), u.data);
  } else {
    batch.set(doc(db, `${BASE}/controleMateriais`, u.id), u.data);
  }
  ops++;
  if (ops >= 400) await flush();
}
await flush();

const mergedAliases = { ...aliases, ...stats.newAliases };
await setDoc(doc(db, `${BASE}/semcasAliases`, 'config'), { aliases: mergedAliases }, { merge: true });

console.log('\n✅ Correções aplicadas com sucesso.');
console.log(`   Aliases salvos: ${Object.keys(stats.newAliases).length} novos vínculos`);
