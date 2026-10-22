/**
 * Abas "Itens com código" e "Categorias com código" da tela de Correção de Itens.
 * Mostram o código de cada material/categoria e fazem as correções pelo código.
 */
import {
  carregarCatalogo,
  getCatalogo,
  listarMateriais,
  listarCategorias,
  materialPorId,
  categoriaPorId,
  renomearMaterial,
  juntarMateriais,
  mudarCategoriaMaterial,
  renomearCategoria,
  juntarCategorias,
  criarCategoria,
} from "./catalogo.js";
import { fetchAllMateriaisForReport, fetchAllHistForReport } from "../../utils/db-utils.js";

const POR_PAGINA = 50;

// Usos de cada código contados no banco inteiro (a tela da Separação só tem parte dos pedidos na memória)
let _usos = null;
let _usosCarregando = false;
function usosDoBanco() {
  if (_usos || _usosCarregando) return _usos;
  _usosCarregando = true;
  Promise.all([fetchAllMateriaisForReport(), fetchAllHistForReport()])
    .then(([mats, hist]) => {
      const n = new Map();
      const somar = (id) => id && n.set(id, (n.get(id) || 0) + 1);
      for (const d of mats || []) Object.values(d.itemsMap || {}).forEach((it) => somar(it?.materialId));
      for (const e of hist || []) (e.units || []).forEach((u) => (u.categories || []).forEach((c) => (c.items || []).forEach((it) => somar(it?.materialId))));
      _usos = n;
    })
    .catch((e) => console.warn("[Catálogo] usos não contados", e))
    .finally(() => {
      _usosCarregando = false;
      _ctx.rerender();
    });
  return null;
}

// Uso somado do código e dos códigos que foram juntados nele
function usosDe(m, usos) {
  if (!usos) return null;
  let total = usos.get(m.id) || 0;
  for (const outro of listarMateriais()) if (outro.mescladoEm && materialPorId(outro.id)?.id === m.id && outro.id !== m.id) total += usos.get(outro.id) || 0;
  return total;
}
let _ctx = { esc: (s) => String(s ?? ""), rerender: () => {}, toast: () => {}, isAdmin: () => false };
let _pagina = 1;
let _filtroCat = "";
let _verJuntados = false;

export function configurarCatalogoUi(ctx) {
  _ctx = { ..._ctx, ...ctx };
}

const semAcento = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// Busca por código ("MAT-0004", "0004", "4"), nome ou forma escrita
function bate(m, termo) {
  if (!termo) return true;
  const t = semAcento(termo).trim();
  const num = t.replace(/^(mat|cat)-?/, "");
  if (/^\d+$/.test(num) && Number(num) === Number(String(m.id).replace(/\D/g, ""))) return true;
  if (semAcento(m.id).includes(t)) return true;
  if (semAcento(m.nome).includes(t)) return true;
  return (m.variantes || []).some((v) => semAcento(v).includes(t));
}

function badge(txt, cor = "#1d4ed8", fundo = "#dbeafe") {
  return `<span style="display:inline-block;padding:1px 7px;border-radius:5px;font:700 11px/1.6 ui-monospace,Consolas,monospace;color:${cor};background:${fundo};white-space:nowrap">${txt}</span>`;
}

function aguardando() {
  carregarCatalogo().then(() => _ctx.rerender());
  return `<div class="pan-empty">Carregando o catálogo de códigos...</div>`;
}

function paginacao(total) {
  const n = Math.max(1, Math.ceil(total / POR_PAGINA));
  if (n <= 1) return "";
  return (
    `<div style="display:flex;gap:6px;align-items:center;justify-content:center;margin:10px 0;font-size:12px">` +
    `<button class="btn btn-s btn-sm" ${_pagina <= 1 ? "disabled" : ""} onclick="catPagina(${_pagina - 1})">‹ Anterior</button>` +
    `<span>Página ${_pagina} de ${n}</span>` +
    `<button class="btn btn-s btn-sm" ${_pagina >= n ? "disabled" : ""} onclick="catPagina(${_pagina + 1})">Próxima ›</button></div>`
  );
}

export function renderItensComCodigo(busca) {
  if (!getCatalogo().carregado) return aguardando();
  const { esc } = _ctx;
  const usos = usosDoBanco();
  const cats = listarCategorias().filter((c) => !c.mescladoEm).sort((a, b) => a.id.localeCompare(b.id));
  const admin = _ctx.isAdmin();
  const todos = listarMateriais()
    .filter((m) => (_verJuntados ? true : !m.mescladoEm))
    .filter((m) => !_filtroCat || categoriaPorId(m.categoriaId)?.id === _filtroCat)
    .filter((m) => bate(m, busca))
    .sort((a, b) => a.id.localeCompare(b.id));
  const nPag = Math.max(1, Math.ceil(todos.length / POR_PAGINA));
  if (_pagina > nPag) _pagina = nPag;
  const pagina = todos.slice((_pagina - 1) * POR_PAGINA, _pagina * POR_PAGINA);
  const opcoesCat = (sel) => cats.map((c) => `<option value="${c.id}"${c.id === sel ? " selected" : ""}>${c.id} · ${esc(c.nome)}</option>`).join("");

  let h =
    `<div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:10px 12px;font-size:12px;color:#1e3a8a;margin-bottom:12px">` +
    `Cada material tem um <b>código fixo</b> (ex.: ${badge("MAT-0004")}) gravado em todos os pedidos. Para corrigir: ` +
    `<b>Renomear</b> muda o nome em todo o sistema; <b>Juntar</b> diz que dois códigos são o mesmo material (o primeiro passa a valer como o segundo); ` +
    `a <b>categoria</b> do material vale para todos os pedidos dele. Busque pelo código (ex.: 4 ou MAT-0004) ou pelo nome.</div>` +
    `<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:10px;font-size:12px">` +
    `<label>Categoria <select class="input" style="width:auto;font-size:12px" onchange="catFiltroCategoria(this.value)"><option value="">Todas</option>${opcoesCat(_filtroCat)}</select></label>` +
    `<label style="display:flex;gap:4px;align-items:center;cursor:pointer"><input type="checkbox" ${_verJuntados ? "checked" : ""} onchange="catVerJuntados(this.checked)"> Mostrar códigos já juntados</label>` +
    `<span style="color:var(--muted)">${todos.length} material(is)</span></div>`;

  if (!todos.length) return h + `<div class="pan-empty">Nenhum material encontrado.</div>`;

  h +=
    `<div class="tbl-wrap"><table class="pan-table"><thead><tr><th>Código</th><th>Nome</th><th>Categoria</th><th style="text-align:right">Usos</th><th>Formas escritas</th>${admin ? "<th>Corrigir</th>" : ""}</tr></thead><tbody>`;
  for (const m of pagina) {
    const cat = categoriaPorId(m.categoriaId);
    const vars = (m.variantes || []).filter((v) => v !== m.nome);
    const juntado = m.mescladoEm ? materialPorId(m.mescladoEm) : null;
    h +=
      `<tr${juntado ? ' style="opacity:.55"' : ""}>` +
      `<td>${badge(m.id)}</td>` +
      `<td style="font-weight:600">${esc(m.nome)}${juntado ? `<div style="font-size:11px;color:#b45309">juntado em ${badge(juntado.id, "#b45309", "#fef3c7")} ${esc(juntado.nome)}</div>` : ""}</td>` +
      `<td>${admin && !juntado ? `<select class="input" style="width:auto;font-size:11px;padding:2px 4px" onchange="catMudarCategoria('${m.id}',this.value)">${opcoesCat(cat?.id)}</select>` : `${badge(cat?.id || "—", "#6d28d9", "#ede9fe")} ${esc(cat?.nome || "")}`}</td>` +
      `<td style="text-align:right">${juntado ? "—" : usos ? usosDe(m, usos).toLocaleString("pt-BR") : "…"}</td>` +
      `<td style="font-size:11px;color:#475569;max-width:320px">${vars.length ? `<details><summary style="cursor:pointer">${vars.length} forma(s)</summary>${vars.map((v) => esc(v)).join("<br>")}</details>` : "—"}</td>` +
      (admin
        ? `<td style="white-space:nowrap">${juntado ? "" : `<button class="btn btn-s btn-sm" onclick="catRenomear('${m.id}')">Renomear</button> <button class="btn btn-s btn-sm" onclick="catJuntar('${m.id}')">Juntar em…</button>`}</td>`
        : "") +
      `</tr>`;
  }
  h += `</tbody></table></div>` + paginacao(todos.length);
  return h;
}

export function renderCategoriasComCodigo(busca) {
  if (!getCatalogo().carregado) return aguardando();
  const { esc } = _ctx;
  const admin = _ctx.isAdmin();
  const porCat = new Map();
  for (const m of listarMateriais()) {
    if (m.mescladoEm) continue;
    const id = categoriaPorId(m.categoriaId)?.id;
    porCat.set(id, (porCat.get(id) || 0) + 1);
  }
  const cats = listarCategorias()
    .filter((c) => bate(c, busca))
    .sort((a, b) => a.id.localeCompare(b.id));
  let h =
    `<div style="background:#f5f3ff;border:1px solid #ddd6fe;border-radius:8px;padding:10px 12px;font-size:12px;color:#4c1d95;margin-bottom:12px">` +
    `Cada categoria tem um código (ex.: ${badge("CAT-01", "#6d28d9", "#ede9fe")}). <b>Renomear</b> muda o nome em todo o sistema; <b>Juntar</b> faz uma categoria valer como outra. ` +
    `Para mudar a categoria de um material, use a aba <b>Itens com código</b>.</div>` +
    (admin ? `<div style="margin-bottom:10px"><button class="btn btn-p btn-sm" onclick="catNovaCategoria()">+ Nova categoria</button></div>` : "") +
    `<div class="tbl-wrap"><table class="pan-table"><thead><tr><th>Código</th><th>Nome</th><th style="text-align:right">Materiais</th><th>Nomes escritos nos pedidos</th>${admin ? "<th>Corrigir</th>" : ""}</tr></thead><tbody>`;
  for (const c of cats) {
    const juntada = c.mescladoEm ? categoriaPorId(c.mescladoEm) : null;
    h +=
      `<tr${juntada ? ' style="opacity:.55"' : ""}>` +
      `<td>${badge(c.id, "#6d28d9", "#ede9fe")}</td>` +
      `<td style="font-weight:600">${esc(c.nome)}${juntada ? `<div style="font-size:11px;color:#b45309">juntada em ${badge(juntada.id, "#b45309", "#fef3c7")} ${esc(juntada.nome)}</div>` : ""}</td>` +
      `<td style="text-align:right">${juntada ? "—" : (porCat.get(c.id) || 0).toLocaleString("pt-BR")}</td>` +
      `<td style="font-size:11px;color:#475569;max-width:420px">${(c.variantes || []).length ? `<details><summary style="cursor:pointer">${c.variantes.length} nome(s)</summary>${c.variantes.map((v) => esc(v)).join("<br>")}</details>` : "—"}</td>` +
      (admin ? `<td style="white-space:nowrap">${juntada ? "" : `<button class="btn btn-s btn-sm" onclick="catRenomearCategoria('${c.id}')">Renomear</button> <button class="btn btn-s btn-sm" onclick="catJuntarCategoria('${c.id}')">Juntar em…</button>`}</td>` : "") +
      `</tr>`;
  }
  h += `</tbody></table></div>`;
  return h;
}

// ─── Ações ────────────────────────────────────────────────────────
async function executar(acao, msgOk) {
  if (!_ctx.isAdmin()) return _ctx.toast("Apenas administradores podem corrigir.", "red");
  try {
    await acao();
    _ctx.toast(msgOk, "green");
  } catch (e) {
    console.error(e);
    _ctx.toast("Não foi possível: " + (e?.message || e), "red");
  }
  _ctx.rerender();
}

const lerCodigo = (txt, prefixo, tam) => {
  const n = String(txt || "").replace(/\D/g, "");
  return n ? `${prefixo}-${n.padStart(tam, "0")}` : "";
};

Object.assign(window, {
  catPagina(p) {
    _pagina = p;
    _ctx.rerender();
  },
  catFiltroCategoria(v) {
    _filtroCat = v;
    _pagina = 1;
    _ctx.rerender();
  },
  catVerJuntados(v) {
    _verJuntados = !!v;
    _ctx.rerender();
  },
  catRenomear(id) {
    const m = materialPorId(id);
    const nome = prompt(`Novo nome para ${m.id}:`, m.nome);
    if (!nome || nome.trim() === m.nome) return;
    executar(() => renomearMaterial(id, nome), `${m.id} agora se chama "${nome.trim()}"`);
  },
  catJuntar(id) {
    const m = materialPorId(id);
    const txt = prompt(`${m.id} · ${m.nome}\n\nJuntar em qual código? (o material certo, ex.: MAT-0004 ou só 4)`);
    const alvo = lerCodigo(txt, "MAT", 4);
    if (!alvo) return;
    const para = materialPorId(alvo);
    if (!para) return _ctx.toast(`Código ${alvo} não existe.`, "red");
    if (!confirm(`Juntar ${m.id} (${m.nome}) em ${para.id} (${para.nome})?\n\nTodos os pedidos de ${m.id} passam a contar como ${para.id}.`)) return;
    executar(() => juntarMateriais(id, para.id), `${m.id} juntado em ${para.id}`);
  },
  catMudarCategoria(id, catId) {
    const c = categoriaPorId(catId);
    executar(() => mudarCategoriaMaterial(id, catId), `${id} agora é da categoria ${c?.nome || catId}`);
  },
  catRenomearCategoria(id) {
    const c = categoriaPorId(id);
    const nome = prompt(`Novo nome para ${c.id}:`, c.nome);
    if (!nome || nome.trim() === c.nome) return;
    executar(() => renomearCategoria(id, nome), `${c.id} agora se chama "${nome.trim()}"`);
  },
  catJuntarCategoria(id) {
    const c = categoriaPorId(id);
    const txt = prompt(`${c.id} · ${c.nome}\n\nJuntar em qual categoria? (ex.: CAT-01 ou só 1)`);
    const alvo = lerCodigo(txt, "CAT", 2);
    if (!alvo) return;
    const para = categoriaPorId(alvo);
    if (!para) return _ctx.toast(`Código ${alvo} não existe.`, "red");
    if (!confirm(`Juntar ${c.id} (${c.nome}) em ${para.id} (${para.nome})?`)) return;
    executar(() => juntarCategorias(id, para.id), `${c.id} juntada em ${para.id}`);
  },
  catNovaCategoria() {
    const nome = prompt("Nome da nova categoria:");
    if (!nome) return;
    executar(() => criarCategoria(nome), `Categoria "${nome.trim()}" criada`);
  },
});
