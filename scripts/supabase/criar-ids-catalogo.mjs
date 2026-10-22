/**
 * Cria o catálogo de materiais (MAT-0001...) e de categorias (CAT-01...) e grava os códigos
 * em cada item dos pedidos (controleMateriais.itemsMap) e do histórico (semcasHistDB).
 * Só ACRESCENTA materialId/categoriaId — nome, quantidade, unidade e datas não mudam.
 * Pode rodar de novo: reaproveita os códigos que já existem e só cria os que faltam.
 *
 * Uso (chaves em .env.local):
 *   node --env-file=.env.local scripts/supabase/criar-ids-catalogo.mjs            (simulação)
 *   node --env-file=.env.local scripts/supabase/criar-ids-catalogo.mjs --apply    (backup + grava)
 *   node --env-file=.env.local scripts/supabase/criar-ids-catalogo.mjs --restaurar scripts/supabase/out/backup-ids-AAAA-MM-DD-HHMM
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  chaveMaterial,
  chaveCategoria,
  categoriaPadrao,
  CATEGORIAS_PADRAO,
  codigoMaterial,
  codigoCategoria,
  numeroDoCodigo,
} from "../../js/modules/materiais/catalogo-regras.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(__dirname, "..", "..");
const BASE = "artifacts/default-app-id/public/data";
const COL = {
  materiais: `${BASE}/controleMateriais`,
  hist: `${BASE}/semcasHistDB`,
  aliases: `${BASE}/semcasAliases`,
  catMat: `${BASE}/catalogoMateriais`,
  catCat: `${BASE}/catalogoCategorias`,
};

const URL = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) {
  console.error("Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY (.env.local).");
  process.exit(1);
}
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };
const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const iRest = args.indexOf("--restaurar");

async function lerColecao(col) {
  const out = [];
  for (let off = 0; ; off += 1000) {
    const r = await fetch(`${URL}/rest/v1/fs_docs?select=col,id,data&col=eq.${encodeURIComponent(col)}&order=id&offset=${off}&limit=1000`, { headers: H });
    if (!r.ok) throw new Error(`Falha ao ler ${col}: ${r.status} ${await r.text()}`);
    const b = await r.json();
    out.push(...b);
    if (b.length < 1000) break;
  }
  return out;
}

async function lote(ops) {
  for (let i = 0; i < ops.length; i += 100) {
    const r = await fetch(`${URL}/rest/v1/rpc/fs_batch`, { method: "POST", headers: H, body: JSON.stringify({ p_ops: ops.slice(i, i + 100) }) });
    if (!r.ok) throw new Error(`fs_batch falhou: ${r.status} ${await r.text()}`);
    process.stdout.write(`\r  gravados ${Math.min(i + 100, ops.length)}/${ops.length}`);
  }
  if (ops.length) process.stdout.write("\n");
}

// ─── Restaurar backup ─────────────────────────────────────────────
if (iRest >= 0) {
  const pasta = args[iRest + 1];
  if (!pasta || !existsSync(pasta)) {
    console.error("Informe a pasta do backup: --restaurar <pasta>");
    process.exit(1);
  }
  for (const nome of ["controleMateriais", "semcasHistDB"]) {
    const rows = JSON.parse(readFileSync(join(pasta, `${nome}.json`), "utf8"));
    console.log(`Restaurando ${nome}: ${rows.length} documentos`);
    await lote(rows.map((r) => ({ op: "set", col: r.col, id: r.id, data: r.data })));
  }
  for (const col of [COL.catMat, COL.catCat]) {
    const rows = await lerColecao(col);
    console.log(`Apagando ${rows.length} documentos de ${col.split("/").pop()}`);
    await lote(rows.map((r) => ({ op: "delete", col, id: r.id })));
  }
  console.log("Backup restaurado.");
  process.exit(0);
}

// ─── Catálogo padrão e regras de correção que já existem no sistema ─
function lerCatalogoPadrao() {
  const src = readFileSync(join(RAIZ, "js/modules/separacao.js"), "utf8");
  const ini = src.indexOf("const MATERIAL_CATALOG = {");
  const fim = src.indexOf("\n};", ini);
  if (ini < 0 || fim < 0) return {};
  return new Function(`return ${src.slice(ini + "const MATERIAL_CATALOG = ".length, fim + 2)}`)();
}

console.log("Lendo dados...");
const [mats, hist, aliasDocs, catMatAntigo, catCatAntigo] = await Promise.all([
  lerColecao(COL.materiais),
  lerColecao(COL.hist),
  lerColecao(COL.aliases),
  lerColecao(COL.catMat),
  lerColecao(COL.catCat),
]);
const MAT_ALIASES = aliasDocs.find((d) => d.id === "matConfig")?.data?.matAliases || {};
const CATALOGO_PADRAO = lerCatalogoPadrao();
console.log(`  pedidos ${mats.length} · histórico ${hist.length} · regras de correção ${Object.keys(MAT_ALIASES).length} · catálogo padrão ${Object.keys(CATALOGO_PADRAO).length}`);
console.log(`  catálogo já existente: ${catMatAntigo.length} materiais, ${catCatAntigo.length} categorias`);

// Nome que vale para um material escrito de um jeito (regras de correção têm prioridade)
const nomeCanonico = (k, escrito) => MAT_ALIASES[k] || CATALOGO_PADRAO[k] || escrito;

// ─── Categorias ───────────────────────────────────────────────────
const catPorNome = new Map(); // nome → doc
const catPorId = new Map();
for (const r of catCatAntigo) {
  catPorId.set(r.id, r.data);
  catPorNome.set(chaveCategoria(r.data.nome), r.id);
}
let proxCat = Math.max(0, ...catCatAntigo.map((r) => numeroDoCodigo(r.id))) + 1;
const novasCats = [];
function idCategoria(nomePadrao) {
  const k = chaveCategoria(nomePadrao);
  if (catPorNome.has(k)) return catPorNome.get(k);
  const id = codigoCategoria(proxCat++);
  const d = { codigo: id, nome: nomePadrao, variantes: [] };
  catPorId.set(id, d);
  catPorNome.set(k, id);
  novasCats.push(id);
  return id;
}
CATEGORIAS_PADRAO.forEach(idCategoria);

// Categoria de um item: o tipo do item; se ele for genérico ("Outros"), o título da seção do pedido
function categoriaDoItem(it, secao) {
  const doItem = it.tipo || it.categoria || it.catName || "";
  const escrito = categoriaPadrao(doItem) === "Outros" && secao ? secao : doItem || secao || "Outros";
  return { escrito, padrao: categoriaPadrao(escrito) };
}

// ─── Ocorrências de cada material ─────────────────────────────────
const grupos = new Map(); // chave do nome canônico → { nome, variantes:Map(k→n), cats:Map(catId→n), n }
const ocorrencias = []; // para carimbar depois: { ref, k, catId }
function registrar(material, cat, ref) {
  const escrito = String(material || "").trim();
  const k = chaveMaterial(escrito);
  if (!k) return;
  const canon = nomeCanonico(k, escrito);
  const g = chaveMaterial(canon);
  if (!grupos.has(g)) grupos.set(g, { nome: canon, escritas: new Map(), variantes: new Map(), cats: new Map(), n: 0, temRegra: canon !== escrito });
  const gr = grupos.get(g);
  gr.n++;
  gr.variantes.set(k, (gr.variantes.get(k) || 0) + 1);
  gr.escritas.set(escrito, (gr.escritas.get(escrito) || 0) + 1);
  const catId = idCategoria(cat.padrao);
  gr.cats.set(catId, (gr.cats.get(catId) || 0) + 1);
  const ck = chaveCategoria(cat.escrito);
  const cd = catPorId.get(catId);
  if (ck && !cd.variantes.includes(ck)) cd.variantes.push(ck);
  ocorrencias.push({ ref, k, g, catId });
}

for (const r of mats) {
  const d = r.data;
  if (d.deleted || !d.itemsMap || typeof d.itemsMap !== "object") continue;
  const secaoDoItem = new Map();
  for (const c of d.parsedData?.categories || d.parsed?.categories || []) {
    for (const it of c.items || []) secaoDoItem.set(String(it.id), c.name || c.catName || "");
  }
  for (const [chave, it] of Object.entries(d.itemsMap)) {
    if (!it?.material) continue;
    registrar(it.material, categoriaDoItem(it, secaoDoItem.get(String(it.id ?? chave))), { tipo: "req", id: r.id, chave });
  }
}
hist.forEach((r) => {
  (r.data.units || []).forEach((u, iu) =>
    (u.categories || []).forEach((c, ic) =>
      (c.items || []).forEach((it, ii) => {
        if (!it?.material) return;
        registrar(it.material, { escrito: c.catName || "Outros", padrao: categoriaPadrao(c.catName) }, { tipo: "hist", id: r.id, iu, ic, ii });
      })
    )
  );
});

// ─── Códigos dos materiais ────────────────────────────────────────
const varAntiga = new Map(); // variante → id já existente
const matPorId = new Map();
for (const r of catMatAntigo) {
  matPorId.set(r.id, r.data);
  for (const v of r.data.variantes || []) varAntiga.set(v, r.id);
}
let proxMat = Math.max(0, ...catMatAntigo.map((r) => numeroDoCodigo(r.id))) + 1;
const idDoGrupo = new Map();
const novosMats = [];
const atualizados = new Set();
// Mais usados primeiro: MAT-0001 é o material que mais aparece
for (const [g, gr] of [...grupos.entries()].sort((a, b) => b[1].n - a[1].n || a[0].localeCompare(b[0]))) {
  let id = [...gr.variantes.keys()].map((v) => varAntiga.get(v)).find(Boolean) || varAntiga.get(g);
  const catId = [...gr.cats.entries()].sort((a, b) => b[1] - a[1])[0][0];
  if (!id) {
    id = codigoMaterial(proxMat++);
    // Sem regra de correção, o nome é a forma escrita mais comum
    const nome = gr.temRegra ? gr.nome : [...gr.escritas.entries()].sort((a, b) => b[1] - a[1])[0][0];
    matPorId.set(id, { codigo: id, nome, categoriaId: catId, variantes: [], ocorrencias: 0 });
    novosMats.push(id);
  }
  const m = matPorId.get(id);
  for (const v of gr.variantes.keys()) {
    if (!m.variantes.includes(v)) {
      m.variantes.push(v);
      atualizados.add(id);
    }
  }
  if (!m.variantes.includes(g)) m.variantes.push(g);
  m.ocorrencias = (m.ocorrencias || 0) + gr.n;
  idDoGrupo.set(g, id);
}

// ─── Carimbar os itens ────────────────────────────────────────────
const patchReq = new Map(); // id do pedido → { itemsMap: { chave: {materialId, categoriaId} } }
const histNovo = new Map(); // id do histórico → units (cópia com os códigos)
const histPorId = new Map(hist.map((r) => [r.id, r.data]));
let jaTinha = 0;
for (const o of ocorrencias) {
  const materialId = idDoGrupo.get(o.g);
  // Cada material tem uma categoria só (a do catálogo); trocar a categoria do material vale para todos os pedidos
  const categoriaId = matPorId.get(materialId).categoriaId;
  if (o.ref.tipo === "req") {
    const atual = mats.find((x) => x.id === o.ref.id)?.data.itemsMap[o.ref.chave];
    if (atual?.materialId === materialId && atual?.categoriaId === categoriaId) {
      jaTinha++;
      continue;
    }
    if (!patchReq.has(o.ref.id)) patchReq.set(o.ref.id, { itemsMap: {} });
    patchReq.get(o.ref.id).itemsMap[o.ref.chave] = { materialId, categoriaId };
  } else {
    const it0 = histPorId.get(o.ref.id).units[o.ref.iu].categories[o.ref.ic].items[o.ref.ii];
    if (it0.materialId === materialId && it0.categoriaId === categoriaId) {
      jaTinha++;
      continue;
    }
    if (!histNovo.has(o.ref.id)) histNovo.set(o.ref.id, structuredClone(histPorId.get(o.ref.id).units));
    const it = histNovo.get(o.ref.id)[o.ref.iu].categories[o.ref.ic].items[o.ref.ii];
    it.materialId = materialId;
    it.categoriaId = categoriaId;
  }
}

// ─── Resumo ───────────────────────────────────────────────────────
const nItens = ocorrencias.length;
console.log("\nRESULTADO");
console.log(`  itens encontrados: ${nItens} (pedidos ${ocorrencias.filter((o) => o.ref.tipo === "req").length} · histórico ${ocorrencias.filter((o) => o.ref.tipo === "hist").length})`);
console.log(`  materiais no catálogo: ${matPorId.size} (novos ${novosMats.length}) · categorias: ${catPorId.size} (novas ${novasCats.length})`);
console.log(`  pedidos a atualizar: ${patchReq.size} · históricos a atualizar: ${histNovo.size} · itens que já tinham o código: ${jaTinha}`);
console.log("  categorias:");
for (const [id, c] of [...catPorId.entries()].sort()) {
  const n = ocorrencias.filter((o) => o.catId === id).length;
  console.log(`    ${id}  ${c.nome.padEnd(24)} ${String(n).padStart(6)} itens · variações: ${c.variantes.slice(0, 8).join(" | ")}${c.variantes.length > 8 ? ` (+${c.variantes.length - 8})` : ""}`);
}
console.log("  primeiros materiais:");
for (const id of [...matPorId.keys()].sort().slice(0, 12)) {
  const m = matPorId.get(id);
  console.log(`    ${id}  ${m.nome.padEnd(34)} ${m.categoriaId} · ${m.ocorrencias} usos · ${m.variantes.length} variação(ões)`);
}

const pastaOut = join(__dirname, "out");
mkdirSync(pastaOut, { recursive: true });
writeFileSync(
  join(pastaOut, "catalogo-materiais.csv"),
  ["codigo;nome;categoria;usos;variacoes", ...[...matPorId.entries()].sort().map(([id, m]) => `${id};"${m.nome}";${m.categoriaId} ${catPorId.get(m.categoriaId)?.nome || ""};${m.ocorrencias};"${m.variantes.join(" | ")}"`)].join("\n"),
  "utf8"
);
console.log(`  lista completa: ${join(pastaOut, "catalogo-materiais.csv")}`);

if (!APPLY) {
  console.log("\nSIMULAÇÃO — nada foi gravado. Use --apply para fazer o backup e gravar.");
  process.exit(0);
}

// ─── Backup ───────────────────────────────────────────────────────
const agora = new Date();
const carimbo = `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, "0")}-${String(agora.getDate()).padStart(2, "0")}-${String(agora.getHours()).padStart(2, "0")}${String(agora.getMinutes()).padStart(2, "0")}`;
const pastaBackup = join(pastaOut, `backup-ids-${carimbo}`);
mkdirSync(pastaBackup, { recursive: true });
writeFileSync(join(pastaBackup, "controleMateriais.json"), JSON.stringify(mats));
writeFileSync(join(pastaBackup, "semcasHistDB.json"), JSON.stringify(hist));
writeFileSync(join(pastaBackup, "semcasAliases.json"), JSON.stringify(aliasDocs));
const confere = JSON.parse(readFileSync(join(pastaBackup, "controleMateriais.json"), "utf8")).length === mats.length &&
  JSON.parse(readFileSync(join(pastaBackup, "semcasHistDB.json"), "utf8")).length === hist.length;
if (!confere) {
  console.error("Backup não conferiu — nada foi gravado.");
  process.exit(1);
}
console.log(`\nBackup salvo e conferido em ${pastaBackup}`);

// ─── Gravar ───────────────────────────────────────────────────────
const ts = { __ts: agora.toISOString() };
console.log("Gravando categorias...");
await lote(
  [...catPorId.entries()].map(([id, c]) => ({
    op: catCatAntigo.some((r) => r.id === id) ? "merge" : "set",
    col: COL.catCat,
    id,
    data: { codigo: id, nome: c.nome, variantes: c.variantes, ...(catCatAntigo.some((r) => r.id === id) ? {} : { criadoEm: ts, criadoPor: "migração" }) },
  }))
);
console.log("Gravando materiais...");
await lote(
  [...matPorId.entries()]
    .filter(([id]) => novosMats.includes(id) || atualizados.has(id))
    .map(([id, m]) => ({
      op: novosMats.includes(id) ? "set" : "merge",
      col: COL.catMat,
      id,
      data: novosMats.includes(id)
        ? { codigo: id, nome: m.nome, categoriaId: m.categoriaId, variantes: m.variantes, ocorrencias: m.ocorrencias, criadoEm: ts, criadoPor: "migração" }
        : { variantes: m.variantes },
    }))
);
console.log("Gravando códigos nos pedidos...");
await lote([...patchReq.entries()].map(([id, data]) => ({ op: "merge", col: COL.materiais, id, data })));
console.log("Gravando códigos no histórico...");
// A lista de unidades do histórico é gravada inteira: relê cada lote logo antes de gravar
// e carimba de novo, para não desfazer uma edição feita enquanto o script rodava
const idPorVariante = new Map();
for (const [g, id] of idDoGrupo) {
  for (const v of matPorId.get(id).variantes) idPorVariante.set(v, id);
  idPorVariante.set(g, id);
}
const idsHist = [...histNovo.keys()];
for (let i = 0; i < idsHist.length; i += 100) {
  const ids = idsHist.slice(i, i + 100);
  const r = await fetch(
    `${URL}/rest/v1/fs_docs?select=id,data&col=eq.${encodeURIComponent(COL.hist)}&id=in.(${ids.map((x) => `"${x}"`).join(",")})`,
    { headers: H }
  );
  const frescos = await r.json();
  const ops = frescos.map((row) => {
    const units = structuredClone(row.data.units || []);
    for (const u of units)
      for (const c of u.categories || []) {
        delete c.categoriaId; // a categoria fica em cada item (a do material), não no título da seção
        for (const it of c.items || []) {
          const k = chaveMaterial(it.material);
          const id = idPorVariante.get(k) || idPorVariante.get(chaveMaterial(nomeCanonico(k, it.material)));
          if (id) {
            it.materialId = id;
            it.categoriaId = matPorId.get(id).categoriaId;
          }
        }
      }
    return { op: "merge", col: COL.hist, id: row.id, data: { units } };
  });
  await lote(ops);
}
console.log("\nPronto.");
