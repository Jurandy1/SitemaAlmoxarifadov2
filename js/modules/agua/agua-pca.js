/**
 * Relatório PCA da Água — quantidade atendida (galões entregues) por unidade, tipo e mês.
 * A água não tem "solicitado": a base é o que foi entregue. A quantidade para o PCA de cada
 * unidade começa com a estimativa anual e pode ser ajustada à mão (fica salva em pcaAjustes).
 * As unidades da sede entram juntas, numa linha só ("SEDE").
 */
import { getDocs, query, orderBy, doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { COLLECTIONS } from "../../services/firestore-service.js";
import { getUnidades } from "../../utils/cache.js";
import { periodoPca, nomeUnidade, unidadesCadastroAtivas, carregarFeriadosPainel } from "../materiais/relatorio-painel.js";

const SETOR = "Coordenação de Almoxarifado e Patrimônio";
const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const ROTULO_TIPO = { SEDE: "Sede", SEMCAS: "Sede", CRAS: "CRAS", CREAS: "CREAS", CT: "Conselho Tutelar", ABRIGO: "Abrigo/Acolhimento", "CENTRO POP": "Centro Pop" };

let _movs = null; // movimentações carregadas (todas)
let _carregadoEm = 0;
let _ajustes = {}; // chave da unidade → quantidade digitada para o PCA
let _ajustesAno = null;
let _ultimo = null; // último relatório montado (para exportar)
let _verTodas = false;

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtN = (v) => Number(v || 0).toLocaleString("pt-BR");
const fmtMedia = (v) => Number(v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const dataBR = (iso) => (iso ? iso.split("-").reverse().join("/") : "—");
const nomeMes = (m) => `${MESES[Number(m.slice(5, 7)) - 1]}/${m.slice(0, 4)}`;
const isoDia = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const anoPca = () => new Date().getFullYear() + 1;

function toast(msg, ok = true) {
  const t = document.createElement("div");
  t.textContent = msg;
  Object.assign(t.style, {
    position: "fixed", bottom: "20px", left: "50%", transform: "translateX(-50%)", background: ok ? "#059669" : "#dc2626",
    color: "#fff", padding: "10px 24px", borderRadius: "10px", fontSize: "13px", fontWeight: "700", zIndex: "100000",
  });
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2500);
}

function paraData(v) {
  if (!v) return null;
  const d = typeof v.toDate === "function" ? v.toDate() : new Date(v);
  return Number.isNaN(d?.getTime?.()) ? null : d;
}

// Unidade do cadastro pelo id gravado, seguindo unificações (duplicataDe)
function cadastroPorId(id) {
  if (!id) return null;
  const lista = getUnidades() || [];
  let u = lista.find((x) => x?.id === id);
  const visto = new Set();
  while (u?.duplicataDe && !visto.has(u.id)) {
    visto.add(u.id);
    const alvo = lista.find((x) => x?.id === u.duplicataDe);
    if (!alvo) break;
    u = alvo;
  }
  return u || null;
}

function unidadeDe(m) {
  const cad = cadastroPorId(m.unidadeId);
  const nome = String(cad?.nome || cad?.unidadeNome || m.unidadeNome || "Desconhecida").trim();
  const tipoRaw = String(cad?.tipo || m.tipoUnidade || "").toUpperCase().trim();
  const sede = tipoRaw === "SEDE" || tipoRaw === "SEMCAS";
  return {
    // "Furo de estoque" (tipo Sistema) é ajuste de estoque, não consumo de unidade
    ajuste: /^SI(S)?TEMA$/.test(tipoRaw) || /furo\s*de\s*estoque/i.test(nome),
    chave: sede ? "__sede__" : cad?.id || "nome:" + nome.toLowerCase(),
    nome: sede ? "SEDE (todas as unidades da sede)" : nomeUnidade(nome),
    nomeReal: nome,
    tipo: ROTULO_TIPO[tipoRaw] || (tipoRaw ? tipoRaw.charAt(0) + tipoRaw.slice(1).toLowerCase() : "Outros"),
  };
}

async function carregarMovs(force = false) {
  if (_movs && !force && Date.now() - _carregadoEm < 2 * 60 * 1000) return _movs;
  const snap = await getDocs(query(COLLECTIONS.aguaMov, orderBy("data", "asc")));
  _movs = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((m) => !m.deleted && m.tipo === "entrega")
    .map((m) => {
      const d = paraData(m.data);
      const dateIso = d ? isoDia(d) : "";
      return { tipo: m.tipo, qtd: Number(m.quantidade) || 0, dateIso, month: dateIso.slice(0, 7), un: unidadeDe(m) };
    })
    .filter((m) => m.dateIso && m.qtd > 0 && !m.un.ajuste);
  _carregadoEm = Date.now();
  return _movs;
}

async function carregarAjustes() {
  const ano = anoPca();
  if (_ajustesAno === ano) return _ajustes;
  try {
    const snap = await getDoc(doc(COLLECTIONS.pcaAjustes, `agua-${ano}`));
    _ajustes = (snap.exists() && snap.data()?.valores) || {};
  } catch (e) {
    console.warn("[PCA Água] ajustes não carregados", e);
    _ajustes = {};
  }
  _ajustesAno = ano;
  return _ajustes;
}

function periodoDaTela() {
  return {
    dateFrom: document.getElementById("aguaPcaDe")?.value || "",
    dateTo: document.getElementById("aguaPcaAte")?.value || "",
  };
}

function montar(movs, f) {
  const noPeriodo = movs.filter((m) => (!f.dateFrom || m.dateIso >= f.dateFrom) && (!f.dateTo || m.dateIso <= f.dateTo));
  const entregas = noPeriodo.filter((m) => m.tipo === "entrega");
  const periodo = periodoPca(entregas, f);
  const mensal = (v) => (periodo.meses > 0 ? v / periodo.meses : 0);

  // "ent" = quantidade atendida (galões entregues)
  const tot = { ent: 0 };
  const porTipo = new Map();
  const porUn = new Map();
  const porMes = new Map();
  for (const m of noPeriodo) {
    tot.ent += m.qtd;
    if (!porTipo.has(m.un.tipo)) porTipo.set(m.un.tipo, { tipo: m.un.tipo, unidades: new Set(), ent: 0 });
    const t = porTipo.get(m.un.tipo);
    t.ent += m.qtd;
    t.unidades.add(m.un.nomeReal);
    if (!porUn.has(m.un.chave)) porUn.set(m.un.chave, { chave: m.un.chave, unidade: m.un.nome, tipo: m.un.tipo, ent: 0, meses: new Map() });
    const u = porUn.get(m.un.chave);
    u.ent += m.qtd;
    u.meses.set(m.month, (u.meses.get(m.month) || 0) + m.qtd);
    porMes.set(m.month, (porMes.get(m.month) || 0) + m.qtd);
  }

  // Unidades do cadastro que atendem água e não receberam no período também entram (com zero),
  // para todas terem a linha de "Quantidade para o PCA"
  for (const cad of unidadesCadastroAtivas("atendeAgua")) {
    const un = unidadeDe({ unidadeId: cad.id, unidadeNome: cad.nome, tipoUnidade: cad.tipo });
    if (un.ajuste) continue;
    if (!porTipo.has(un.tipo)) porTipo.set(un.tipo, { tipo: un.tipo, unidades: new Set(), ent: 0 });
    porTipo.get(un.tipo).unidades.add(un.nomeReal);
    if (!porUn.has(un.chave)) porUn.set(un.chave, { chave: un.chave, unidade: un.nome, tipo: un.tipo, ent: 0, meses: new Map() });
  }

  const comMedia = (x) => ({ ...x, media: mensal(x.ent), estimativa: Math.ceil(mensal(x.ent) * 12) });
  const tipos = [...porTipo.values()].map((t) => comMedia({ tipo: t.tipo, unidades: t.unidades.size, ent: t.ent })).sort((a, b) => b.ent - a.ent);
  const unidades = [...porUn.values()]
    .map((u) => {
      const x = comMedia({ chave: u.chave, unidade: u.unidade, tipo: u.tipo, ent: u.ent, maiorMes: Math.max(0, ...u.meses.values()) });
      const manual = _ajustes[u.chave];
      return { ...x, pca: manual != null && manual !== "" ? Number(manual) : x.estimativa, ajustado: manual != null && manual !== "" };
    })
    .sort((a, b) => b.ent - a.ent);
  let acum = 0;
  const meses = [...porMes.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([mes, ent]) => ({ mes, ent, acum: (acum += ent) }));
  const total = comMedia({ ent: tot.ent, maiorMes: Math.max(0, ...meses.map((m) => m.ent)) });

  return { periodo, total, tipos, unidades, meses, totalPca: unidades.reduce((s, u) => s + (u.pca || 0), 0), nAjustadas: unidades.filter((u) => u.ajustado).length };
}

// Mesma estrutura de seções do PCA de materiais (tela, PDF e Word)
const cel = (s, num = false) => ({ v: s, s: num ? fmtN(s) : String(s ?? ""), num });
function secoes(rel) {
  return [
    {
      id: "tipos",
      titulo: "Consumo por tipo de unidade",
      cols: [{ t: "Tipo" }, { t: "Unidades", num: true }, { t: "Quantidade atendida", num: true }, { t: "Média por mês", num: true }, { t: "Estimativa anual", num: true }],
      linhas: rel.tipos.map((t) => ({ cels: [cel(t.tipo), cel(t.unidades, true), cel(t.ent, true), { v: Math.round(t.media * 10) / 10, s: fmtMedia(t.media), num: true }, cel(t.estimativa, true)] })),
    },
    {
      id: "unidades",
      titulo: "Consumo por unidade",
      sub: "As unidades da sede aparecem juntas, numa linha só.",
      cols: [
        { t: "Unidade" }, { t: "Tipo" }, { t: "Quantidade atendida", num: true }, { t: "Média por mês", num: true },
        { t: "Maior mês", num: true }, { t: "Estimativa anual", num: true }, { t: `Quantidade para o PCA ${anoPca()}`, num: true, destaque: true },
      ],
      linhas: [
        ...rel.unidades.map((u) => ({
          chave: u.chave,
          cels: [cel(u.unidade), cel(u.tipo), cel(u.ent, true), { v: Math.round(u.media * 10) / 10, s: fmtMedia(u.media), num: true }, cel(u.maiorMes, true), cel(u.estimativa, true), { ...cel(u.pca, true), destaque: true, ajustado: u.ajustado }],
        })),
        { total: true, cels: [cel("Total"), cel(""), cel(rel.total.ent, true), { v: Math.round(rel.total.media * 10) / 10, s: fmtMedia(rel.total.media), num: true }, cel(""), cel(rel.total.estimativa, true), cel(rel.totalPca, true)] },
      ],
    },
    {
      id: "meses",
      titulo: "Mês a mês e acumulado",
      cols: [{ t: "Mês" }, { t: "Quantidade atendida", num: true }, { t: "Atendida acumulada", num: true }],
      linhas: rel.meses.map((m) => ({ cels: [cel(nomeMes(m.mes)), cel(m.ent, true), cel(m.acum, true)] })),
    },
  ];
}

function descricao(rel) {
  const p = rel.periodo;
  const base = p.meses >= 1 ? `média calculada sobre ${fmtMedia(p.meses).replace(/,0$/, "")} ${p.meses >= 1.95 ? "meses" : "mês"} com entregas; meses incompletos contados em dias úteis` : `${p.dias} dia${p.dias > 1 ? "s" : ""}`;
  return { periodo: `${dataBR(p.from)} até ${dataBR(p.to)}`, base };
}

function tabelaHtml(sec, limite) {
  const linhas = (limite ? sec.linhas.filter((l) => l.total).concat(sec.linhas.filter((l) => !l.total).slice(0, limite)) : sec.linhas)
    .sort((a, b) => (a.total ? 1 : 0) - (b.total ? 1 : 0))
    .map(
      (l) =>
        `<tr${l.total ? ' class="pa-total"' : ""}>` +
        l.cels
          .map((c) => {
            if (c.destaque && l.chave && !l.total) {
              return `<td class="n"><input type="number" min="0" step="1" class="pa-pca-input${c.ajustado ? " ajustado" : ""}" value="${c.v}" ` +
                `data-chave="${esc(l.chave)}" onchange="salvarQtdPcaAgua(this)" title="Digite a quantidade para o PCA"></td>`;
            }
            return `<td class="${c.num ? "n" : ""}">${c.destaque ? `<b>${esc(c.s)}</b>` : esc(c.s)}</td>`;
          })
          .join("") +
        `</tr>`
    );
  return (
    `<div class="pa-table-wrap"><table class="pa-table"><thead><tr>` +
    sec.cols.map((c) => `<th class="${c.num ? "n" : ""}">${esc(c.t)}</th>`).join("") +
    `</tr></thead><tbody>${linhas.join("")}</tbody></table></div>`
  );
}

function bloco(titulo, corpo, sub, link) {
  return (
    `<div class="pa-card pa-block"><div class="pa-block-head"><h3>${titulo}</h3>${link || ""}</div>` +
    (sub ? `<p class="pa-sub">${sub}</p>` : "") +
    corpo +
    `</div>`
  );
}

function render(rel) {
  const el = document.getElementById("aguaPcaConteudo");
  if (!el) return;
  const d = descricao(rel);
  const t = rel.total;
  if (!t.ent) {
    el.innerHTML = `<div class="pa-card pa-empty">Nenhuma entrega de água no período escolhido.</div>`;
    return;
  }
  let h =
    `<div class="pa-card pa-block"><div class="pa-block-head"><h3>Relatório para o PCA ${anoPca()} — Água mineral (galões de 20 L)</h3>` +
    `<div class="pa-pca-acoes">` +
    `<button type="button" class="pa-btn" onclick="exportarPcaAgua('pdf')"><i data-lucide="file-text"></i> Baixar PDF</button>` +
    `<button type="button" class="pa-btn" onclick="exportarPcaAgua('word')"><i data-lucide="file-type"></i> Baixar Word</button>` +
    `<button type="button" class="pa-btn" onclick="exportarPcaAgua('excel')"><i data-lucide="file-spreadsheet"></i> Baixar Excel</button>` +
    `</div></div>` +
    `<p class="pa-sub">A base é a <b>quantidade atendida</b> (galões entregues às unidades). A <b>estimativa anual</b> é a média mensal × 12. ` +
    `Na coluna <b>Quantidade para o PCA</b> você pode digitar o número que vai para o PCA de cada unidade; ela começa com a estimativa e o que você digitar fica salvo.</p>` +
    `<p class="pa-pca-resumo">Período: <b>${d.periodo}</b> (${d.base}) · <b>${fmtN(rel.unidades.length)}</b> linhas de unidade` +
    (rel.nAjustadas ? ` · <b>${rel.nAjustadas}</b> quantidade${rel.nAjustadas > 1 ? "s" : ""} ajustada${rel.nAjustadas > 1 ? "s" : ""} à mão` : "") +
    `</p></div>`;

  h +=
    `<div class="pa-kpis">` +
    `<div class="pa-card pa-kpi"><div class="pa-kpi-label">Quantidade atendida</div><div class="pa-kpi-val">${fmtN(t.ent)}</div></div>` +
    `<div class="pa-card pa-kpi"><div class="pa-kpi-label">Média por mês</div><div class="pa-kpi-val">${fmtMedia(t.media)}</div></div>` +
    `<div class="pa-card pa-kpi"><div class="pa-kpi-label">Maior mês</div><div class="pa-kpi-val">${fmtN(t.maiorMes)}</div></div>` +
    `<div class="pa-card pa-kpi"><div class="pa-kpi-label">Estimativa anual</div><div class="pa-kpi-val pa-green">${fmtN(t.estimativa)}</div></div>` +
    `<div class="pa-card pa-kpi"><div class="pa-kpi-label">Quantidade para o PCA</div><div class="pa-kpi-val pa-blue">${fmtN(rel.totalPca)}</div></div>` +
    `</div>`;

  for (const sec of secoes(rel)) {
    if (sec.id === "unidades") {
      const n = sec.linhas.length - 1;
      const link =
        `<span class="pa-pca-acoes">` +
        (rel.nAjustadas ? `<button type="button" class="pa-link" onclick="limparQtdPcaAgua()">Voltar todas para a estimativa</button>` : "") +
        (n > 20 ? `<button type="button" class="pa-link" onclick="verTodasPcaAgua()">${_verTodas ? "Ver menos" : `Ver todas (${n})`}</button>` : "") +
        `</span>`;
      h += bloco(sec.titulo, tabelaHtml(sec, _verTodas ? 0 : 20), sec.sub + " Os números com fundo amarelo foram digitados à mão.", link);
    } else {
      h += bloco(sec.titulo, tabelaHtml(sec), sec.sub);
    }
  }
  el.innerHTML = h;
  try { window.lucide?.createIcons?.(); } catch (_) {}
}

export async function renderPcaAgua(opts = {}) {
  const el = document.getElementById("aguaPcaConteudo");
  if (!el) return;
  if (!document.getElementById("aguaPcaDe")?.value) aplicarPresetPcaAgua("12m", false);
  if (!_ultimo || opts.force) el.innerHTML = `<div class="pa-card pa-empty">Carregando as entregas de água...</div>`;
  try {
    const [movs] = await Promise.all([carregarMovs(!!opts.force), carregarAjustes(), carregarFeriadosPainel()]);
    _ultimo = montar(movs, periodoDaTela());
    render(_ultimo);
  } catch (e) {
    console.error(e);
    el.innerHTML = `<div class="pa-card pa-empty" style="color:#b91c1c"><b>Falha ao carregar.</b> ${esc(e?.message || e)}</div>`;
  }
}

function aplicarPresetPcaAgua(preset, recarregar = true) {
  const hoje = new Date();
  let de;
  let ate = isoDia(hoje);
  if (preset === "ano") de = `${hoje.getFullYear()}-01-01`;
  else if (preset === "anoPassado") {
    de = `${hoje.getFullYear() - 1}-01-01`;
    ate = `${hoje.getFullYear() - 1}-12-31`;
  } else {
    const d = new Date(hoje);
    d.setFullYear(d.getFullYear() - 1);
    d.setDate(d.getDate() + 1);
    de = isoDia(d);
  }
  document.getElementById("aguaPcaDe").value = de;
  document.getElementById("aguaPcaAte").value = ate;
  document.querySelectorAll("#aguaPcaFiltros .pa-chip[data-preset]").forEach((b) => b.classList.toggle("active", b.dataset.preset === preset));
  if (recarregar) renderPcaAgua();
}

function periodoPersonalizadoPcaAgua() {
  document.querySelectorAll("#aguaPcaFiltros .pa-chip[data-preset]").forEach((b) => b.classList.remove("active"));
  renderPcaAgua();
}

async function gravarAjustes(valores, merge) {
  await setDoc(doc(COLLECTIONS.pcaAjustes, `agua-${anoPca()}`), { valores, atualizadoEm: serverTimestamp() }, { merge });
}

async function salvarQtdPcaAgua(input) {
  const chave = input.dataset.chave;
  const txt = String(input.value || "").trim();
  const valor = txt === "" ? null : Math.max(0, Math.round(Number(txt)));
  if (txt !== "" && Number.isNaN(valor)) return;
  const antes = _ajustes[chave];
  if (valor == null) delete _ajustes[chave];
  else _ajustes[chave] = valor;
  try {
    // Gravar o documento inteiro evita depender de apagar um campo isolado
    await gravarAjustes({ ..._ajustes }, false);
    toast("Quantidade salva.");
  } catch (e) {
    console.error(e);
    if (antes == null) delete _ajustes[chave];
    else _ajustes[chave] = antes;
    toast("Não foi possível salvar (é preciso ser editor ou administrador).", false);
  }
  _ultimo = montar(_movs || [], periodoDaTela());
  render(_ultimo);
}

async function limparQtdPcaAgua() {
  if (!confirm("Voltar todas as quantidades digitadas para a estimativa calculada?")) return;
  const antes = _ajustes;
  _ajustes = {};
  try {
    await gravarAjustes({}, false);
    toast("Quantidades voltaram para a estimativa.");
  } catch (e) {
    console.error(e);
    _ajustes = antes;
    toast("Não foi possível salvar (é preciso ser editor ou administrador).", false);
  }
  _ultimo = montar(_movs || [], periodoDaTela());
  render(_ultimo);
}

function verTodasPcaAgua() {
  _verTodas = !_verTodas;
  if (_ultimo) render(_ultimo);
}

function exportarExcel(rel) {
  if (typeof XLSX === "undefined") return toast("Não foi possível carregar o Excel. Recarregue a página.", false);
  const wb = XLSX.utils.book_new();
  const d = descricao(rel);
  for (const sec of secoes(rel)) {
    const linhas = sec.linhas.map((l) => Object.fromEntries(sec.cols.map((c, i) => [c.t, l.cels[i].v])));
    const ws = XLSX.utils.json_to_sheet(linhas);
    ws["!cols"] = sec.cols.map((c, i) => ({ wch: i === 0 ? 40 : Math.max(14, c.t.length + 2) }));
    if (sec.id === "tipos") {
      XLSX.utils.sheet_add_aoa(ws, [[], [`${SETOR} — PCA ${anoPca()} — Água mineral (galões de 20 L)`], [`Período: ${d.periodo} (${d.base})`]], { origin: -1 });
    }
    XLSX.utils.book_append_sheet(wb, ws, sec.titulo.replace("Consumo por ", "Por ").slice(0, 31));
  }
  XLSX.writeFile(wb, `PCA_Agua_${rel.periodo.from}_a_${rel.periodo.to}.xlsx`);
  toast("Excel gerado.");
}

async function exportarPcaAgua(formato) {
  const rel = _ultimo;
  if (!rel?.total?.ent) return toast("Nenhuma entrega no período para exportar.", false);
  if (formato === "excel") return exportarExcel(rel);
  try {
    toast(`Gerando ${formato === "pdf" ? "PDF" : "Word"}...`);
    const mod = await import("../materiais/pca-documento.js");
    const d = descricao(rel);
    const info = {
      setor: SETOR,
      anoPca: anoPca(),
      titulo: "Relatório de Consumo de Água Mineral",
      periodo: d.periodo,
      base: d.base,
      categorias: "Água mineral - galão de 20 litros",
      filtros: rel.nAjustadas ? `${rel.nAjustadas} quantidade(s) para o PCA ajustada(s) manualmente` : "",
      geradoEm: new Date().toLocaleString("pt-BR"),
      legenda:
        "Quantidade atendida = galões de água entregues às unidades. " +
        "Estimativa anual = média mensal da quantidade atendida × 12. Quantidade para o PCA = estimativa anual ou o valor ajustado manualmente. " +
        "As unidades da sede aparecem juntas, numa linha só.",
      kpis: [
        ["Quantidade atendida", fmtN(rel.total.ent)],
        ["Média por mês", fmtMedia(rel.total.media)],
        ["Maior mês", fmtN(rel.total.maiorMes)],
        ["Estimativa anual", fmtN(rel.total.estimativa)],
        [`Quantidade para o PCA ${anoPca()}`, fmtN(rel.totalPca)],
      ],
      kpiDestaque: 4,
      nomeArquivo: `PCA_Agua_${rel.periodo.from}_a_${rel.periodo.to}`,
    };
    const s = secoes(rel);
    if (formato === "pdf") await mod.gerarPdfPca(info, s);
    else await mod.gerarWordPca(info, s);
  } catch (e) {
    console.error(e);
    toast("Não foi possível gerar o documento: " + (e?.message || e), false);
  }
}

Object.assign(window, {
  renderPcaAgua,
  aplicarPresetPcaAgua,
  periodoPersonalizadoPcaAgua,
  salvarQtdPcaAgua,
  limparQtdPcaAgua,
  verTodasPcaAgua,
  exportarPcaAgua,
});
