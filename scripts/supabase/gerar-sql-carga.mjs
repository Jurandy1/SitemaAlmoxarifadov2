/**
 * Transforma export JSONL em SQL de carga (piloto).
 * Foco inicial: unidades + aliases + hist/materiais.
 *
 * Uso:
 *   node scripts/supabase/gerar-sql-carga.mjs
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXPORT_DIR = join(__dirname, 'out', 'export');
const OUT_DIR = join(__dirname, 'out');

function sqlStr(v) {
  if (v == null || v === '') return 'NULL';
  return `'${String(v).replace(/'/g, "''")}'`;
}

function sqlBool(v) {
  return v === false ? 'false' : 'true';
}

function readJsonl(name) {
  const p = join(EXPORT_DIR, `${name}.jsonl`);
  if (!existsSync(p)) return [];
  return readFileSync(p, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

if (!existsSync(join(EXPORT_DIR, 'manifest.json'))) {
  console.error('Rode antes: node scripts/supabase/export-firestore.mjs');
  process.exit(1);
}

mkdirSync(OUT_DIR, { recursive: true });
const unidades = readJsonl('unidades');
const aliasesDoc = readJsonl('semcasAliases').find((d) => d.id === 'config') || { aliases: {} };
const hist = readJsonl('semcasHistDB');
const mats = readJsonl('controleMateriais');

const unitIdByFirestore = new Map();
const unitIdByName = new Map();
const lines = [];
lines.push('-- Carga piloto gerada automaticamente');
lines.push('begin;');

for (const u of unidades) {
  const id = randomUUID();
  unitIdByFirestore.set(u.id, id);
  const nome = u.nome || u.unidadeNome || '';
  if (nome) unitIdByName.set(String(nome).toLowerCase(), id);
  lines.push(
    `insert into public.unidades (id, firestore_id, nome, tipo, sigla, atende_agua, atende_gas, atende_materiais, ativo)` +
      ` values (${sqlStr(id)}, ${sqlStr(u.id)}, ${sqlStr(nome)}, ${sqlStr(u.tipo || 'OUTROS')}, ${sqlStr(u.sigla || null)},` +
      ` ${sqlBool(u.atendeAgua ?? true)}, ${sqlBool(u.atendeGas ?? true)}, ${sqlBool(u.atendeMateriais ?? true)},` +
      ` ${sqlBool(u.ativo ?? true)})` +
      ` on conflict (firestore_id) do update set nome = excluded.nome, tipo = excluded.tipo;`
  );
}

const aliases = aliasesDoc.aliases || {};
for (const [k, v] of Object.entries(aliases)) {
  const unidadeId = unitIdByName.get(String(v).toLowerCase());
  if (!unidadeId) continue;
  lines.push(
    `insert into public.aliases_unidades (alias_key, alias_raw, unidade_id)` +
      ` values (${sqlStr(k)}, ${sqlStr(v)}, ${sqlStr(unidadeId)})` +
      ` on conflict (alias_key) do update set unidade_id = excluded.unidade_id;`
  );
}

let histItemCount = 0;
for (const h of hist) {
  const hid = randomUUID();
  lines.push(
    `insert into public.hist_semanas (id, firestore_id, file_name, week_start, week_end, week_label, year, month, year_assumed)` +
      ` values (${sqlStr(hid)}, ${sqlStr(h.id)}, ${sqlStr(h.fileName || null)}, ${sqlStr(h.weekStart || null)},` +
      ` ${sqlStr(h.weekEnd || null)}, ${sqlStr(h.weekLabel || null)}, ${h.year ?? 'NULL'}, ${h.month ?? 'NULL'},` +
      ` ${sqlBool(!!h.yearAssumed)})` +
      ` on conflict (firestore_id) do nothing;`
  );
  for (const unit of h.units || []) {
    const unidadeId =
      unitIdByName.get(String(unit.unitName || '').toLowerCase()) ||
      unitIdByName.get(String(unit.rawUnit || '').toLowerCase()) ||
      null;
    for (const cat of unit.categories || []) {
      for (const it of cat.items || []) {
        const qty = Number(it.qty) || 0;
        if (!it.material || qty <= 0) continue;
        histItemCount++;
        lines.push(
          `insert into public.hist_semana_itens (hist_semana_id, unidade_id, unit_name, raw_unit, categoria, material_nome, qty)` +
            ` values (${sqlStr(hid)}, ${sqlStr(unidadeId)}, ${sqlStr(unit.unitName || null)}, ${sqlStr(unit.rawUnit || null)},` +
            ` ${sqlStr(cat.catName || cat.name || null)}, ${sqlStr(it.material)}, ${qty});`
        );
      }
    }
  }
}

let reqCount = 0;
let itemCount = 0;
for (const m of mats) {
  if (m.deleted) continue;
  const rid = randomUUID();
  const unidadeId =
    (m.unidadeId && unitIdByFirestore.get(m.unidadeId)) ||
    unitIdByName.get(String(m.unidadeNome || m.unidade || '').toLowerCase()) ||
    null;
  const tipos = Array.isArray(m.tipos) ? m.tipos : Array.isArray(m.tiposMaterial) ? m.tiposMaterial : [];
  lines.push(
    `insert into public.requisicoes (id, firestore_id, unidade_id, unidade_nome_snap, status, tipos, formato, file_name,` +
      ` period_label, period_start, period_end, data_requisicao, data_entrega, responsavel, deleted, registrado_em)` +
      ` values (${sqlStr(rid)}, ${sqlStr(m.id)}, ${sqlStr(unidadeId)}, ${sqlStr(m.unidadeNome || m.unidade || null)},` +
      ` ${sqlStr(m.status || 'requisitado')}, ARRAY[${tipos.map(sqlStr).join(',')}]::text[], ${sqlStr(m.formato || null)},` +
      ` ${sqlStr(m.fileName || null)}, ${sqlStr(m.periodLabel || null)}, ${sqlStr(m.periodStart || null)},` +
      ` ${sqlStr(m.periodEnd || null)}, ${sqlStr(m.dataRequisicao || m.dt || null)}, ${sqlStr(m.dataEntrega || null)},` +
      ` ${sqlStr(m.resp || m.responsavel || null)}, false, ${sqlStr(m.registradoEm || new Date().toISOString())})` +
      ` on conflict (firestore_id) do nothing;`
  );
  reqCount++;

  const itemsMap = m.itemsMap || m.items || {};
  for (const it of Object.values(itemsMap)) {
    const nome = it.material || it.nome || it.name;
    if (!nome) continue;
    itemCount++;
    lines.push(
      `insert into public.requisicao_itens (requisicao_id, material_nome, categoria, qtd_solicitada, qtd_atendida, unidade_medida, status)` +
        ` values (${sqlStr(rid)}, ${sqlStr(nome)}, ${sqlStr(it.tipo || it.categoria || null)},` +
        ` ${Number(it.qtdSolicitada || it.qty || 0) || 0}, ${Number(it.qtdAtendida || 0) || 0},` +
        ` ${sqlStr(it.unidade || null)}, ${sqlStr(it.status || null)});`
    );
  }

  // Fallback: parsedData categories
  for (const cat of m.parsedData?.categories || m.parsed?.categories || []) {
    for (const it of cat.items || []) {
      if (!it.material) continue;
      itemCount++;
      lines.push(
        `insert into public.requisicao_itens (requisicao_id, material_nome, categoria, qtd_solicitada, qtd_atendida, unidade_medida, status)` +
          ` values (${sqlStr(rid)}, ${sqlStr(it.material)}, ${sqlStr(cat.name || cat.catName || null)},` +
          ` ${Number(it.qtdSolicitada || it.qty || 0) || 0}, ${Number(it.qtdAtendida || 0) || 0},` +
          ` ${sqlStr(it.unidade || null)}, ${sqlStr(it.status || null)});`
      );
    }
  }
}

lines.push('commit;');
const out = join(OUT_DIR, '002_carga_piloto.sql');
writeFileSync(out, lines.join('\n'), 'utf8');
console.log(`SQL gerado: ${out}`);
console.log(`Unidades: ${unidades.length}`);
console.log(`Aliases: ${Object.keys(aliases).length}`);
console.log(`Hist itens: ${histItemCount}`);
console.log(`Requisições: ${reqCount}`);
console.log(`Itens req: ${itemCount}`);
