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
  materialPorNome,
  categoriaPorId,
  renomearMaterial,
  juntarMateriais,
  ignorarSugestaoMaterial,
  vincularFormaMaterial,
  ignorarFormaSugerida,
  mudarCategoriaMaterial,
  renomearCategoria,
  juntarCategorias,
  criarCategoria,
} from "./catalogo.js";
import { chaveMaterial, pontuarSimilaridadeMaterial } from "./catalogo-regras.js";
import { fetchAllMateriaisForReport, fetchAllHistForReport } from "../../utils/db-utils.js";

const POR_PAGINA = 50;

// Usos de cada código contados no banco inteiro (a tela da Separação só tem parte dos pedidos na memória)
let _usos = null;
let _legadoSemCodigo = new Map();
let _usosCarregando = false;
function usosDoBanco() {
  if (_usos || _usosCarregando) return _usos;
  _usosCarregando = true;
  Promise.all([fetchAllMateriaisForReport(), fetchAllHistForReport()])
    .then(([mats, hist]) => {
      const n = new Map();
      const legado = new Map();
      const somar = (it, categoria = "") => {
        if (!it) return;
        const conhecido = (it.materialId && materialPorId(it.materialId)) || materialPorNome(it.material);
        if (conhecido) {
          n.set(conhecido.id, (n.get(conhecido.id) || 0) + 1);
          return;
        }
        const forma = String(it.material || "").trim();
        const k = chaveMaterial(forma);
        if (!k) return;
        const x = legado.get(k) || { chave: k, nome: forma, ocorrencias: 0, categorias: new Set() };
        x.ocorrencias++;
        if (categoria) x.categorias.add(categoria);
        legado.set(k, x);
      };
      for (const d of mats || []) Object.values(d.itemsMap || {}).forEach((it) => somar(it, it?.tipo || it?.categoria));
      for (const e of hist || []) (e.units || []).forEach((u) => (u.categories || []).forEach((c) => (c.items || []).forEach((it) => somar(it, c.catName))));
      _usos = n;
      _legadoSemCodigo = legado;
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
  return [...(m.formasEscritas || []), ...(m.variantes || [])].some((v) => semAcento(v).includes(t));
}

function formasMaterial(m) {
  return [...new Set([m.nome, ...(m.formasEscritas || []), ...(m.variantes || [])].filter(Boolean))];
}

function melhorSimilaridade(a, b) {
  let melhor = 0;
  for (const x of formasMaterial(a)) for (const y of formasMaterial(b)) melhor = Math.max(melhor, pontuarSimilaridadeMaterial(x, y));
  return melhor;
}

function sugestoesMateriais(materiais, usos, limite = 20) {
  const pares = [];
  for (let i = 0; i < materiais.length; i++) for (let j = i + 1; j < materiais.length; j++) {
    const a = materiais[i], b = materiais[j];
    if (a.mescladoEm || b.mescladoEm) continue;
    if ((a.naoMesclarCom || []).includes(b.id) || (b.naoMesclarCom || []).includes(a.id)) continue;
    const nota = melhorSimilaridade(a, b);
    if (nota < 0.72) continue;
    const mesmaCat = categoriaPorId(a.categoriaId)?.id === categoriaPorId(b.categoriaId)?.id;
    const ua = usos ? usosDe(a, usos) : 0, ub = usos ? usosDe(b, usos) : 0;
    const [de, para] = ub > ua || (ub === ua && b.id.localeCompare(a.id) < 0) ? [a, b] : [b, a];
    pares.push({ de, para, nota, mesmaCat, usosDe: de === a ? ua : ub, usosPara: para === a ? ua : ub });
  }
  return pares.sort((x, y) => y.nota - x.nota || Number(y.mesmaCat) - Number(x.mesmaCat) || y.usosPara - x.usosPara).slice(0, limite);
}

function renderSugestoes(materiais, usos, admin, esc) {
  const sugestoes = sugestoesMateriais(materiais, usos);
  const legadas = [];
  for (const antiga of _legadoSemCodigo.values()) {
    let melhor = null;
    for (const m of materiais) {
      if ((m.sugestoesIgnoradas || []).includes(antiga.chave)) continue;
      let nota = 0;
      for (const forma of formasMaterial(m)) nota = Math.max(nota, pontuarSimilaridadeMaterial(antiga.nome, forma));
      if (nota >= 0.72 && (!melhor || nota > melhor.nota)) melhor = { antiga, material: m, nota };
    }
    if (melhor) legadas.push(melhor);
  }
  legadas.sort((a, b) => b.nota - a.nota || b.antiga.ocorrencias - a.antiga.ocorrencias);
  let h = `<div style="border:1px solid #fde68a;background:#fffbeb;border-radius:10px;padding:12px;margin-bottom:14px">` +
    `<div style="display:flex;justify-content:space-between;gap:8px;align-items:center;flex-wrap:wrap"><div><b style="color:#92400e">Sugestões de itens possivelmente iguais</b>` +
    `<div style="font-size:11px;color:#78716c;margin-top:2px">O sistema apenas sugere. Nada é juntado automaticamente e os nomes originais das planilhas são preservados.</div></div>` +
    `<span style="font-size:11px;color:#92400e">${sugestoes.length + legadas.length} para revisar</span></div>`;
  if (!sugestoes.length && !legadas.length) return h + `<div style="font-size:12px;color:#64748b;margin-top:10px">Nenhuma sugestão forte encontrada neste filtro.</div></div>`;
  h += `<div style="display:grid;gap:8px;margin-top:10px">`;
  for (const s of legadas.slice(0, 20)) {
    const pct = Math.round(s.nota * 100);
    const formaArg = encodeURIComponent(s.antiga.nome).replace(/'/g, "%27");
    h += `<div style="background:#fff;border:1px solid #bfdbfe;border-radius:8px;padding:9px 10px;display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap">` +
      `<div style="font-size:12px;min-width:260px"><div><span style="background:#f1f5f9;color:#475569;padding:2px 7px;border-radius:5px">SEM CÓDIGO</span> <b>${esc(s.antiga.nome)}</b> <span style="color:#94a3b8">→</span> ${badge(s.material.id)} <b>${esc(s.material.nome)}</b></div>` +
      `<div style="font-size:10px;color:#64748b;margin-top:3px">Semelhança ${pct}% · ${s.antiga.ocorrencias} ocorrência(s) antiga(s)${s.antiga.categorias.size ? ` · ${[...s.antiga.categorias].slice(0, 2).map(esc).join(" / ")}` : ""}</div></div>` +
      (admin ? `<div style="display:flex;gap:5px"><button class="btn btn-p btn-sm" onclick="catVincularForma('${s.material.id}','${formaArg}')">Vincular ao ${s.material.id}</button>` +
      `<button class="btn btn-s btn-sm" onclick="catIgnorarForma('${s.material.id}','${formaArg}')">Não corresponde</button></div>` : "") + `</div>`;
  }
  for (const s of sugestoes) {
    const pct = Math.round(s.nota * 100);
    h += `<div style="background:#fff;border:1px solid #f3e8c8;border-radius:8px;padding:9px 10px;display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap">` +
      `<div style="font-size:12px;min-width:260px"><div>${badge(s.de.id)} <b>${esc(s.de.nome)}</b> <span style="color:#94a3b8">↔</span> ${badge(s.para.id)} <b>${esc(s.para.nome)}</b></div>` +
      `<div style="font-size:10px;color:#64748b;margin-top:3px">Semelhança ${pct}% · ${s.mesmaCat ? "mesma categoria" : "categorias diferentes"}${usos ? ` · usos ${s.usosDe}/${s.usosPara}` : ""}</div></div>` +
      (admin ? `<div style="display:flex;gap:5px"><button class="btn btn-p btn-sm" onclick="catJuntarSugestao('${s.de.id}','${s.para.id}')">Juntar ${s.de.id} em ${s.para.id}</button>` +
      `<button class="btn btn-s btn-sm" onclick="catIgnorarSugestao('${s.de.id}','${s.para.id}')">Não são iguais</button></div>` : "") + `</div>`;
  }
  return h + `</div></div>`;
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

  h += renderSugestoes(todos.filter((m) => !m.mescladoEm), usos, admin, esc);

  if (!todos.length) return h + `<div class="pan-empty">Nenhum material encontrado.</div>`;

  h +=
    `<div class="tbl-wrap"><table class="pan-table"><thead><tr><th>Código</th><th>Nome</th><th>Categoria</th><th style="text-align:right">Usos</th><th>Formas escritas</th>${admin ? "<th>Corrigir</th>" : ""}</tr></thead><tbody>`;
  for (const m of pagina) {
    const cat = categoriaPorId(m.categoriaId);
    const vars = [...new Set([...(m.formasEscritas || []), ...(m.variantes || [])])].filter((v) => v !== m.nome);
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
  catJuntarSugestao(deId, paraId) {
    const de = materialPorId(deId), para = materialPorId(paraId);
    if (!de || !para || de.id === para.id) return;
    if (!confirm(`Confirmar que estes itens são o mesmo material?\n\n${de.id} · ${de.nome}\nserá juntado em\n${para.id} · ${para.nome}\n\nOs nomes antigos continuarão guardados como formas escritas.`)) return;
    executar(() => juntarMateriais(de.id, para.id), `${de.id} juntado em ${para.id}`);
  },
  catIgnorarSugestao(aId, bId) {
    executar(() => ignorarSugestaoMaterial(aId, bId), "Sugestão descartada");
  },
  catVincularForma(id, nomeCodificado) {
    const nome = decodeURIComponent(nomeCodificado || "");
    const m = materialPorId(id);
    if (!m || !nome) return;
    if (!confirm(`Vincular a forma antiga\n\n"${nome}"\n\nao código ${m.id} · ${m.nome}?\n\nOs pedidos antigos não serão alterados; passarão apenas a ser agrupados por este código.`)) return;
    executar(async () => {
      await vincularFormaMaterial(id, nome);
      const antiga = _legadoSemCodigo.get(chaveMaterial(nome));
      if (antiga && _usos) _usos.set(m.id, (_usos.get(m.id) || 0) + antiga.ocorrencias);
      _legadoSemCodigo.delete(chaveMaterial(nome));
    }, `Forma antiga vinculada a ${m.id}`);
  },
  catIgnorarForma(id, nomeCodificado) {
    const nome = decodeURIComponent(nomeCodificado || "");
    executar(() => ignorarFormaSugerida(id, nome), "Sugestão descartada");
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
