/**
 * Carga completa: export JSONL do Firestore → tabelas do Supabase (via API REST, service role).
 * Recarrega do zero a cada execução (apaga e reinsere), então pode ser rodado várias vezes
 * até a virada definitiva. Não mexe em usuários/profiles.
 *
 * Pré-requisitos: 001_schema.sql + 003_ajustes_carga.sql aplicados e
 *   node scripts/supabase/export-firestore.mjs
 *
 * Uso:
 *   node --env-file=.env.local scripts/supabase/carregar-supabase.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXPORT_DIR = join(__dirname, 'out', 'export');
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY (ex.: node --env-file=.env.local ...).');
  process.exit(1);
}
if (!existsSync(join(EXPORT_DIR, 'manifest.json'))) {
  console.error('Rode antes: node scripts/supabase/export-firestore.mjs');
  process.exit(1);
}

const headers = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  'Content-Type': 'application/json',
};

function readJsonl(name) {
  const p = join(EXPORT_DIR, `${name}.jsonl`);
  if (!existsSync(p)) return [];
  return readFileSync(p, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
}

async function rest(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...options, headers: { ...headers, ...options.headers } });
  if (!res.ok) throw new Error(`${options.method || 'GET'} ${path}: ${res.status} ${await res.text()}`);
  return res;
}

async function apagarTudo(table, col = 'id') {
  await rest(`${table}?${col}=not.is.null`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
}

async function inserir(table, rows, size = 500) {
  for (let i = 0; i < rows.length; i += size) {
    await rest(table, {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify(rows.slice(i, i + size)),
    });
  }
  console.log(`  ✓ ${table.padEnd(24)} ${rows.length}`);
}

async function contar(table) {
  const res = await rest(`${table}?select=*`, { method: 'HEAD', headers: { Prefer: 'count=exact', Range: '0-0' } });
  return Number(res.headers.get('content-range')?.split('/')[1] || 0);
}

// Mesmo parser de quantidade do app (js/modules/separacao.js → extractNum): "1PCT" → 1
function extractNum(s) {
  if (typeof s === 'number') return s;
  if (!s) return 0;
  s = String(s).trim();
  if (/^(00?\.|nt$)/i.test(s)) return 0;
  const m = s.match(/^([\d.,]+)/);
  if (!m) return 0;
  let str = m[1];
  if (str.includes(',') && str.includes('.')) str = str.replace(/\./g, '').replace(',', '.');
  else if (str.includes(',')) str = str.replace(',', '.');
  else if (str.includes('.')) {
    const parts = str.split('.');
    if (parts.length === 2 && parts[1].length === 3) str = str.replace('.', '');
  }
  let val = parseFloat(str) || 0;
  const lower = s.toLowerCase();
  if (val && lower.includes('cento')) val *= 100;
  if (val && lower.includes('mil')) val *= 1000;
  return val;
}

// Datas do app são meia-noite de São Luís (UTC-3) gravadas em UTC: "2026-02-09T03:00:00.000Z" → 2026-02-09
function diaLocal(v) {
  if (!v) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const t = Date.parse(v);
  if (Number.isNaN(t)) return null;
  return new Date(t - 3 * 3600 * 1000).toISOString().slice(0, 10);
}

function ts(v) {
  if (!v) return null;
  return Number.isNaN(Date.parse(v)) ? null : v;
}

const txt = (v) => (v == null || v === '' ? null : String(v));
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

// ─── Leitura do export ────────────────────────────────────────────
const unidadesFs = readJsonl('unidades');
const aliasesFs = readJsonl('semcasAliases');
const histFs = readJsonl('semcasHistDB');
const matsFs = readJsonl('controleMateriais');
const aguaFs = readJsonl('controleAgua');
const gasFs = readJsonl('controleGas');
const estAguaFs = readJsonl('estoqueAgua');
const estGasFs = readJsonl('estoqueGas');
const cestaMovFs = readJsonl('socialCestaMov');
const cestaEstFs = readJsonl('socialCestaEstoque');
const enxMovFs = readJsonl('socialEnxovalMov');
const enxEstFs = readJsonl('socialEnxovalEstoque');
const feriadosFs = readJsonl('feriados');
const statsFs = readJsonl('stats');

console.log('Limpando tabelas de dados (usuários/profiles não são tocados)...');
for (const t of [
  'requisicao_itens', 'requisicoes', 'hist_semana_itens', 'hist_semanas', 'aliases_unidades',
  'movimentacoes_agua', 'movimentacoes_gas', 'estoque_entradas_agua', 'estoque_entradas_gas',
  'mov_cesta', 'estoque_cesta', 'mov_enxoval', 'estoque_enxoval',
]) await apagarTudo(t);
await apagarTudo('feriados', 'date');
await apagarTudo('aliases_config', 'key');
await apagarTudo('unidades');

console.log('Carregando...');

// ─── Unidades ─────────────────────────────────────────────────────
const unitIdByFs = new Map();
const unitIdByName = new Map();
for (const u of unidadesFs) unitIdByFs.set(u.id, randomUUID());
const unidades = unidadesFs.map((u) => {
  const id = unitIdByFs.get(u.id);
  unitIdByName.set(norm(u.nome), id);
  for (const a of u.aliases || []) if (!unitIdByName.has(norm(a))) unitIdByName.set(norm(a), id);
  return {
    id,
    firestore_id: u.id,
    nome: u.nome || '(sem nome)',
    tipo: u.tipo || 'OUTROS',
    sigla: txt(u.sigla),
    atende_agua: u.atendeAgua ?? true,
    atende_gas: u.atendeGas ?? true,
    atende_materiais: u.atendeMateriais ?? true,
    ativo: u.ativo ?? true,
    duplicata_de: null,
    aliases: (u.aliases || []).map(String),
    raw: u,
  };
});
// insere primeiro sem duplicata_de (auto-referência), depois atualiza
await inserir('unidades', unidades);
for (const u of unidadesFs.filter((x) => x.duplicataDe && unitIdByFs.has(x.duplicataDe))) {
  await rest(`unidades?id=eq.${unitIdByFs.get(u.id)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ duplicata_de: unitIdByFs.get(u.duplicataDe) }),
  });
}

function unidadeId(fsId, ...nomes) {
  if (fsId && unitIdByFs.has(fsId)) return unitIdByFs.get(fsId);
  for (const n of nomes) {
    const id = unitIdByName.get(norm(n));
    if (id) return id;
  }
  return null;
}

// ─── Aliases ──────────────────────────────────────────────────────
const aliasDoc = aliasesFs.find((d) => d.id === 'config');
const aliasRows = [];
for (const [k, v] of Object.entries(aliasDoc?.aliases || {})) {
  const id = unidadeId(null, v);
  if (id) aliasRows.push({ alias_key: k, alias_raw: txt(v), unidade_id: id });
}
await inserir('aliases_unidades', aliasRows);

// Documentos de configuração/cache guardados inteiros
const configRows = [
  ...aliasesFs.map((d) => ({ key: `semcasAliases/${d.id}`, payload: d, updated_at: ts(d.updatedAt) || new Date().toISOString() })),
  ...estAguaFs.filter((d) => String(d.tipo).startsWith('__')).map((d) => ({ key: `estoqueAgua/${d.id}`, payload: d, updated_at: ts(d.atualizadoEm) || new Date().toISOString() })),
  ...estGasFs.filter((d) => String(d.tipo).startsWith('__')).map((d) => ({ key: `estoqueGas/${d.id}`, payload: d, updated_at: ts(d.atualizadoEm) || new Date().toISOString() })),
];
await inserir('aliases_config', configRows);

// ─── Pedidos de materiais ─────────────────────────────────────────
const reqs = [];
const reqItens = [];
for (const m of matsFs) {
  const id = randomUUID();
  const tipos = Array.isArray(m.tiposMaterial) ? m.tiposMaterial : Array.isArray(m.tipos) ? m.tipos : m.tipoMaterial ? [m.tipoMaterial] : [];
  reqs.push({
    id,
    firestore_id: m.id,
    unidade_id: unidadeId(m.unidadeId, m.unidadeNome, m.unidade),
    unidade_nome_snap: txt(m.unidadeNome || m.unidade),
    tipo_unidade: txt(m.tipoUnidade),
    status: m.status || 'requisitado',
    tipos: tipos.map(String),
    formato: txt(m.formato),
    file_name: txt(m.fileName),
    period_label: txt(m.periodLabel),
    period_start: diaLocal(m.periodStart),
    period_end: diaLocal(m.periodEnd),
    data_requisicao: ts(m.dataRequisicao),
    data_entrega: ts(m.dataEntrega),
    responsavel: txt(m.responsavelLancamento || m.lancadoPor),
    separador: txt(m.responsavelSeparador || m.separador),
    entregue_por: txt(m.responsavelEntregaAlmox || m.responsavelEntrega),
    retirado_por: txt(m.responsavelRecebimento || m.retiradoPor),
    observacao: txt(m.obs),
    origem: txt(m.origemFluxo),
    deleted: !!m.deleted,
    registrado_em: ts(m.registradoEm) || ts(m.dataRequisicao) || new Date().toISOString(),
    file_url: txt(m.fileURL),
    storage_path: txt(m.storagePath),
    raw: m,
  });

  const lista = m.itemsMap ? Object.values(m.itemsMap) : Array.isArray(m.itens) ? m.itens : [];
  for (const it of lista) {
    if (!it?.material) continue;
    reqItens.push({
      requisicao_id: id,
      material_nome: String(it.material).trim(),
      categoria: txt(it.tipo || it.categoria),
      qtd_solicitada: extractNum(it.qtdSolicitada),
      qtd_atendida: extractNum(it.qtdAtendida),
      unidade_medida: txt(it.unidade),
      status: txt(it.status),
      observacao: txt(it.obs),
      raw: it,
    });
  }
  // formato antigo raro: categories[].items[]
  if (!lista.length) {
    for (const c of m.categories || []) {
      for (const it of c.items || []) {
        if (!it?.material) continue;
        reqItens.push({
          requisicao_id: id,
          material_nome: String(it.material).trim(),
          categoria: txt(c.name || c.catName),
          qtd_solicitada: extractNum(it.qtdSolicitada ?? it.qty),
          qtd_atendida: extractNum(it.qtdAtendida),
          unidade_medida: txt(it.unidade),
          status: txt(it.status),
          observacao: txt(it.obs),
          raw: it,
        });
      }
    }
  }
}
await inserir('requisicoes', reqs, 200);
await inserir('requisicao_itens', reqItens, 1000);

// ─── Histórico semanal ────────────────────────────────────────────
const semanas = [];
const semanaItens = [];
for (const h of histFs) {
  const id = randomUUID();
  const { units, ...resto } = h;
  semanas.push({
    id,
    firestore_id: h.id,
    file_name: txt(h.fileName),
    week_start: diaLocal(h.weekStart),
    week_end: diaLocal(h.weekEnd),
    week_label: txt(h.weekLabel),
    year: h.year ?? null,
    month: h.month ?? null,
    year_assumed: !!h.yearAssumed,
    updated_at: ts(h.updatedAt),
    raw: resto,
  });
  for (const u of units || []) {
    const uid = unidadeId(u.unidadeId, u.unitName, u.rawUnit);
    for (const c of u.categories || []) {
      for (const it of c.items || []) {
        if (!it?.material) continue;
        const temSol = it.qtySolicitada != null || it.qtdSolicitada != null;
        semanaItens.push({
          hist_semana_id: id,
          unidade_id: uid,
          unit_name: txt(u.unitName),
          raw_unit: txt(u.rawUnit),
          categoria: txt(c.catName || c.name),
          material_nome: String(it.material).trim(),
          qty: extractNum(it.qtyAtendida ?? it.qtdAtendida ?? it.qty),
          qty_solicitada: temSol ? extractNum(it.qtySolicitada ?? it.qtdSolicitada) : null,
          raw: it,
        });
      }
    }
  }
}
await inserir('hist_semanas', semanas, 300);
await inserir('hist_semana_itens', semanaItens, 2000);

// ─── Água / gás ───────────────────────────────────────────────────
const mov = (d) => ({
  firestore_id: d.id,
  unidade_id: unidadeId(d.unidadeId, d.unidadeNome),
  unidade_nome_snap: txt(d.unidadeNome),
  tipo_unidade: txt(d.tipoUnidade),
  tipo: d.tipo,
  quantidade: Math.round(Number(d.quantidade) || 0),
  data: diaLocal(d.data),
  responsavel: txt(d.responsavel),
  responsavel_almox: txt(d.responsavelAlmoxarifado),
  observacao: txt(d.observacao),
  origem: txt(d.origem),
  registrado_em: ts(d.registradoEm) || new Date().toISOString(),
  raw: d,
});
await inserir('movimentacoes_agua', aguaFs.map(mov), 1000);
await inserir('movimentacoes_gas', gasFs.map(mov), 1000);

const est = (d) => ({
  firestore_id: d.id,
  tipo: d.tipo,
  quantidade: Math.round(Number(d.quantidade) || 0),
  data: diaLocal(d.data),
  responsavel: txt(d.responsavel),
  nota_fiscal: txt(d.notaFiscal),
  registrado_em: ts(d.registradoEm) || new Date().toISOString(),
  raw: d,
});
await inserir('estoque_entradas_agua', estAguaFs.filter((d) => !String(d.tipo).startsWith('__')).map(est));
await inserir('estoque_entradas_gas', estGasFs.filter((d) => !String(d.tipo).startsWith('__')).map(est));

// ─── Social ───────────────────────────────────────────────────────
const socialMov = (d) => ({
  firestore_id: d.id,
  tipo: txt(d.tipo),
  destinatario: txt(d.destinatario),
  quantidade: Number(d.quantidade) || 0,
  categoria: txt(d.categoria),
  custo: d.custo ?? null,
  status: txt(d.status),
  registrado_em: ts(d.registradoEm) || new Date().toISOString(),
  raw: d,
});
const socialEst = (d) => ({
  firestore_id: d.id,
  tipo: txt(d.tipo),
  quantidade: Number(d.quantidade) || 0,
  categoria: txt(d.categoria),
  registrado_em: ts(d.registradoEm) || new Date().toISOString(),
  raw: d,
});
await inserir('mov_cesta', cestaMovFs.map(socialMov));
await inserir('estoque_cesta', cestaEstFs.map(socialEst));
await inserir('mov_enxoval', enxMovFs.map(socialMov));
await inserir('estoque_enxoval', enxEstFs.map(socialEst));

// ─── Feriados (dois formatos no Firestore; a data é a chave) ──────
const porData = new Map();
for (const f of feriadosFs) {
  const date = diaLocal(f.date || f.data);
  if (!date) continue;
  const atual = porData.get(date) || { date, name: null, nature: null, weekday: null, raw: [] };
  atual.name = atual.name || txt(f.name || f.nome || f.descricao);
  atual.nature = atual.nature || txt(f.nature || f.tipo);
  atual.weekday = atual.weekday || txt(f.weekday);
  atual.raw.push(f);
  porData.set(date, atual);
}
await inserir('feriados', [...porData.values()]);

// ─── Status público ───────────────────────────────────────────────
const st = statsFs.find((d) => d.id === 'status_public');
if (st) {
  await rest('status_public?on_conflict=id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ id: 1, agua: st.agua || 0, gas: st.gas || 0, updated_at: ts(st.updatedAt) || new Date().toISOString() }),
  });
  console.log('  ✓ status_public');
}

// ─── Conferência ──────────────────────────────────────────────────
const esperado = {
  unidades: unidades.length,
  aliases_unidades: aliasRows.length,
  requisicoes: reqs.length,
  requisicao_itens: reqItens.length,
  hist_semanas: semanas.length,
  hist_semana_itens: semanaItens.length,
  movimentacoes_agua: aguaFs.length,
  movimentacoes_gas: gasFs.length,
  estoque_entradas_agua: estAguaFs.filter((d) => !String(d.tipo).startsWith('__')).length,
  estoque_entradas_gas: estGasFs.filter((d) => !String(d.tipo).startsWith('__')).length,
  mov_cesta: cestaMovFs.length,
  estoque_cesta: cestaEstFs.length,
  mov_enxoval: enxMovFs.length,
  estoque_enxoval: enxEstFs.length,
  feriados: porData.size,
  aliases_config: configRows.length,
};
console.log('\nConferência (esperado × no Supabase):');
let divergencias = 0;
for (const [t, n] of Object.entries(esperado)) {
  const real = await contar(t);
  const ok = real === n;
  if (!ok) divergencias++;
  console.log(`  ${ok ? '✓' : '✗'} ${t.padEnd(24)} ${String(n).padStart(6)} × ${String(real).padStart(6)}`);
}
const semUnidade = reqs.filter((r) => !r.unidade_id).length;
console.log(`\nPedidos sem unidade vinculada: ${semUnidade} (nome original guardado em unidade_nome_snap)`);
console.log(divergencias ? `\n${divergencias} tabela(s) com divergência.` : '\nTudo conferido.');
process.exit(divergencias ? 1 : 0);
