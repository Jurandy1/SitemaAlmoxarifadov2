/**
 * Aplica lotacoes_de_para.json no cadastro Firestore:
 * - Renomeia unidades (nome / unidadeNome)
 * - Define tipo operacional (tipo) e grupoLotacao (organograma)
 * - Grava sigla, nomeAnterior, ordemGrupo
 * - Salva aliases nome_antigo → nome_novo (planilhas antigas)
 * - Opcional: funde duplicata "Medidas Socio Educativas"
 *
 * Uso:
 *   $env:FB_EMAIL="..."
 *   $env:FB_PASSWORD="..."
 *   node scripts/aplicar-lotacoes-de-para.mjs
 *   node scripts/aplicar-lotacoes-de-para.mjs --apply
 */
import fs from 'fs';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import {
  getFirestore,
  collection,
  getDocs,
  doc,
  getDoc,
  setDoc,
  writeBatch,
  serverTimestamp,
} from 'firebase/firestore';
import { key } from './unit-mappings-shared.mjs';

const APPLY = process.argv.includes('--apply');
const MAP_PATH =
  process.argv.find((a) => a.endsWith('.json') && !a.startsWith('-')) ||
  'c:/Users/PC/Desktop/BATIMENTO DE COMPRAS/lotacoes_de_para.json';
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
if (!email || !password) {
  console.error('Defina FB_EMAIL e FB_PASSWORD');
  process.exit(1);
}

const mapFile = JSON.parse(fs.readFileSync(MAP_PATH, 'utf8'));
const mapeamento = mapFile.mapeamento || [];

const app = initializeApp(firebaseConfig);
await signInWithEmailAndPassword(getAuth(app), email, password);
const db = getFirestore(app);

const snap = await getDocs(collection(db, `${BASE}/unidades`));
const registered = snap.docs.map((d) => {
  const u = d.data() || {};
  return {
    id: d.id,
    nome: String(u.nome || u.unidadeNome || '').trim(),
    tipo: String(u.tipo || u.tipoUnidade || '').trim(),
    sigla: String(u.sigla || '').trim(),
    atendeMateriais: u.atendeMateriais,
    duplicataDe: u.duplicataDe || null,
    raw: u,
  };
});

function findUnit(nomeAntigo, idAntigo, preferTipo) {
  const candidates = [
    nomeAntigo,
    idAntigo,
    String(nomeAntigo || '').replace(/\s*\[.*?\]\s*/g, ' ').trim(),
    String(idAntigo || '').replace(/\s*\(cadastrado como SEDE\)\s*/i, '').trim(),
  ].filter(Boolean);

  const byKey = new Map();
  for (const u of registered) {
    if (!u.nome) continue;
    if ((u.atendeMateriais ?? true) === false && u.duplicataDe) continue;
    const k = key(u.nome);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(u);
  }

  for (const c of candidates) {
    const list = byKey.get(key(c)) || [];
    if (!list.length) continue;
    if (preferTipo) {
      const hit = list.find((u) => key(u.tipo) === key(preferTipo));
      if (hit) return hit;
    }
    if (list.length === 1) return list[0];
    // Prefer active materials unit
    const active = list.find((u) => (u.atendeMateriais ?? true) === true);
    return active || list[0];
  }

  // Fuzzy: contains
  const target = key(nomeAntigo || idAntigo);
  if (target.length >= 6) {
    const soft = registered.filter((u) => {
      const k = key(u.nome);
      return k.includes(target) || target.includes(k);
    });
    if (preferTipo) {
      const hit = soft.find((u) => key(u.tipo) === key(preferTipo));
      if (hit) return hit;
    }
    if (soft.length === 1) return soft[0];
  }
  return null;
}

const planned = [];
const missing = [];
const aliasesToSave = {};

for (const row of mapeamento) {
  const preferTipo =
    /cadastrado como SEDE/i.test(row.id_antigo || '') || /cadastrado como SEDE/i.test(row.nome_antigo || '')
      ? 'SEDE'
      : row.grupo_antigo === 'CREAS'
        ? 'CREAS'
        : row.grupo_antigo === 'CRAS'
          ? 'CRAS'
          : null;

  const unit = findUnit(row.nome_antigo, row.id_antigo, preferTipo);
  if (!unit) {
    missing.push(row);
    continue;
  }

  const nomeNovo = String(row.nome_novo || '').trim();
  const tipoNovo = String(row.tipo_sistema || row.grupo_antigo || unit.tipo || 'OUTROS').trim().toUpperCase();
  const grupoLotacao = String(row.grupo_novo || '').trim();
  const sigla = String(row.sigla || unit.sigla || '').trim();
  const ordemGrupo = Number.isFinite(row.ordem_grupo) ? row.ordem_grupo : 99;

  const needsRename = key(unit.nome) !== key(nomeNovo);
  const needsTipo = key(unit.tipo) !== key(tipoNovo);
  const needsGrupo = key(unit.raw?.grupoLotacao || '') !== key(grupoLotacao);
  const needsSigla = sigla && key(unit.sigla) !== key(sigla);

  if (row.acao === 'fundir_com_duplicado') {
    planned.push({
      ...row,
      unitId: unit.id,
      nomeAtual: unit.nome,
      action: 'fundir_desativar',
      patch: {
        atendeMateriais: false,
        duplicataDe: null,
        nomeAnterior: unit.nome,
        grupoLotacao,
        tipo: tipoNovo,
        atualizadoEm: 'server',
      },
    });
    if (nomeNovo) aliasesToSave[key(unit.nome)] = nomeNovo;
    if (row.nome_antigo) aliasesToSave[key(row.nome_antigo)] = nomeNovo;
    continue;
  }

  if (!needsRename && !needsTipo && !needsGrupo && !needsSigla && row.acao === 'sem_alteracao') {
    // still set grupo if missing
    if (!unit.raw?.grupoLotacao && grupoLotacao) {
      planned.push({
        ...row,
        unitId: unit.id,
        nomeAtual: unit.nome,
        action: 'so_grupo',
        patch: {
          grupoLotacao,
          ordemGrupo,
          tipo: tipoNovo,
          ...(sigla ? { sigla } : {}),
        },
      });
    }
    continue;
  }

  const patch = {
    nome: nomeNovo,
    unidadeNome: nomeNovo,
    tipo: tipoNovo,
    tipoUnidade: tipoNovo,
    grupoLotacao,
    ordemGrupo,
    nomeAnterior: unit.nome,
  };
  if (sigla) patch.sigla = sigla;

  planned.push({
    ...row,
    unitId: unit.id,
    nomeAtual: unit.nome,
    action: needsRename ? 'renomear' : 'atualizar_meta',
    patch,
  });

  if (needsRename) {
    aliasesToSave[key(unit.nome)] = nomeNovo;
    if (row.nome_antigo) aliasesToSave[key(row.nome_antigo)] = nomeNovo;
    if (row.id_antigo) aliasesToSave[key(row.id_antigo)] = nomeNovo;
  }
}

console.log(`\nModo: ${APPLY ? 'APPLY' : 'DRY-RUN'}`);
console.log(`Mapeamento: ${mapeamento.length}`);
console.log(`Planejados: ${planned.length}`);
console.log(`Não encontrados: ${missing.length}`);
console.log(`Aliases novos: ${Object.keys(aliasesToSave).length}`);

const byAction = {};
for (const p of planned) byAction[p.action] = (byAction[p.action] || 0) + 1;
console.log('Ações:', byAction);

console.log('\n=== PLANO (amostra) ===');
for (const p of planned.slice(0, 40)) {
  console.log(
    `- [${p.action}] ${p.nomeAtual} → ${p.patch.nome || p.nomeAtual} | tipo=${p.patch.tipo} | grupo=${p.patch.grupoLotacao}`
  );
}
if (planned.length > 40) console.log(`... +${planned.length - 40} itens`);

if (missing.length) {
  console.log('\n=== NÃO ENCONTRADOS ===');
  missing.forEach((m) => console.log(`- ${m.nome_antigo || m.id_antigo}`));
}

if (!APPLY) {
  console.log('\nRode com --apply para gravar.');
  process.exit(0);
}

// Aplicar em batches
let batch = writeBatch(db);
let ops = 0;
const commit = async () => {
  if (!ops) return;
  await batch.commit();
  batch = writeBatch(db);
  ops = 0;
};

for (const p of planned) {
  const ref = doc(db, `${BASE}/unidades`, p.unitId);
  const data = { ...p.patch, atualizadoEm: serverTimestamp() };
  if (p.action === 'fundir_desativar') {
    // Marca como duplicata inativa apontando ao canônico (se existir)
    const canon = planned.find(
      (x) => x.acao !== 'fundir_com_duplicado' && key(x.nome_novo) === key(p.nome_novo) && x.unitId !== p.unitId
    );
    data.atendeMateriais = false;
    if (canon) data.duplicataDe = canon.unitId;
  }
  batch.set(ref, data, { merge: true });
  ops++;
  if (ops >= 400) await commit();
}
await commit();

// Aliases
const aliasRef = doc(db, `${BASE}/semcasAliases`, 'config');
const aliasSnap = await getDoc(aliasRef);
const aliases = aliasSnap.exists() ? { ...(aliasSnap.data()?.aliases || {}) } : {};
Object.assign(aliases, aliasesToSave);
await setDoc(
  aliasRef,
  {
    aliases,
    atualizadoEm: serverTimestamp(),
    origem: 'aplicar-lotacoes-de-para',
  },
  { merge: true }
);

console.log(`\nAplicado: ${planned.length} unidades + ${Object.keys(aliasesToSave).length} aliases.`);
