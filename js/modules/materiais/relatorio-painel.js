/**
 * Painel analítico de materiais — consultas sob demanda + agregações.
 * Fonte principal: controleMateriais (itemsMap).
 * Complemento: semcasHistDB só para entradas sem requisição correspondente.
 */
import {
  fetchAllMateriaisForReport,
  fetchAllHistForReport,
  invalidateReportCaches,
} from "../../utils/db-utils.js";
import { getUnidades } from "../../utils/cache.js";

const DAY_NAMES = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

let _deps = {
  classifyUnit: () => ({ id: "outros", label: "Outros", icon: "?", color: "#94a3b8" }),
  getCanonicalCat: (c) => c,
  normalizeCat: (c) => c || "Outros",
  detectTipo: () => "Outros",
  resolveRegisteredUnit: (n) => n,
  extractNum: (s) => Number(s) || 0,
  UNIT_TYPES: [],
  esc: (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])),
  refreshIcons: () => {},
  toast: () => {},
};

let _state = {
  loading: false,
  loaded: false,
  rows: [],
  filters: {
    dateFrom: "",
    dateTo: "",
    unit: "",
    tipo: "",
    cat: "",
    itemQ: "",
    coverage: "all", // all | full | delivery_only
  },
  sub: "geral",
  preset: "mes", // atalho de período ativo (30d | mes | trimestre | ano | personalizado)
  verTodosPedidos: false,
  loadedAt: null,
  lastExportRows: [],
};

export function configureRelatorioPainel(deps = {}) {
  _deps = { ..._deps, ...deps };
}

export function getPainelState() {
  return _state;
}

export function invalidatePainelData() {
  _state.loaded = false;
  _state.rows = [];
  invalidateReportCaches();
}

function toDate(val) {
  if (!val) return null;
  if (val instanceof Date) return Number.isNaN(val.getTime()) ? null : val;
  if (typeof val?.toDate === "function") {
    try {
      const d = val.toDate();
      return Number.isNaN(d.getTime()) ? null : d;
    } catch {
      return null;
    }
  }
  if (typeof val === "string" && /^\d{4}-\d{2}-\d{2}/.test(val)) {
    const d = new Date(val.slice(0, 10) + "T12:00:00");
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(val);
  return Number.isNaN(d.getTime()) ? null : d;
}

function isoDay(d) {
  if (!d) return "";
  return (
    d.getFullYear() +
    "-" +
    String(d.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(d.getDate()).padStart(2, "0")
  );
}

function ym(d) {
  if (!d) return "";
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
}

function rmAcc(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function normKey(s) {
  return rmAcc(s).toLowerCase().replace(/\s+/g, " ").trim();
}

function deriveItemStatus(sol, ate, rawStatus) {
  const st = String(rawStatus || "").toLowerCase();
  if (st === "sem_estoque" || st === "nao_atendido" || st === "parcial" || st === "atendido" || st === "excedido") {
    return st;
  }
  if (ate <= 0 && sol > 0) return "nao_atendido";
  if (ate > 0 && ate < sol) return "parcial";
  if (ate > sol) return "excedido";
  if (ate > 0) return "atendido";
  return "nao_atendido";
}

function reqDate(doc) {
  return (
    toDate(doc.dataRequisicao) ||
    toDate(doc.periodStart) ||
    toDate(doc.dataEntrega) ||
    toDate(doc.registradoEm)
  );
}

// Unidade do cadastro pelo id gravado no pedido, seguindo unificações (duplicataDe).
// Assim, renomear/reclassificar a unidade no cadastro vale para todos os pedidos dela.
function unidadeCadastroPorId(id) {
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

function unitNameFromDoc(doc) {
  const cad = unidadeCadastroPorId(doc.unidadeId);
  const nomeCad = String(cad?.nome || cad?.unidadeNome || "").trim();
  if (nomeCad) return nomeCad;
  const raw = doc.unidadeNome || doc.unidade || "";
  const resolved = _deps.resolveRegisteredUnit(raw) || raw;
  return String(resolved || "").trim() || "Desconhecida";
}

function categoryFromItem(it, parsedCats) {
  let raw = it.tipo || it.categoria || it.catName || "";
  if (!raw && parsedCats?.length) {
    for (const c of parsedCats) {
      if ((c.items || []).some((x) => String(x.id) === String(it.id))) {
        raw = c.name || c.catName || "";
        break;
      }
    }
  }
  const normalized = _deps.normalizeCat(raw || "Outros");
  return _deps.getCanonicalCat(normalized) || normalized;
}

/**
 * Constrói linhas analíticas a partir de materiais + hist (sem dupla contagem).
 */
export function buildAnalyticRows(materiaisDocs, histDocs) {
  const rows = [];
  const coveredHistIds = new Set();
  const coveredReqIds = new Set();

  for (const doc of materiaisDocs || []) {
    const isV2 =
      doc._version === 2 ||
      doc.origemFluxo === "v2" ||
      (doc.itemsMap && typeof doc.itemsMap === "object");
    if (!isV2) continue;

    const statusReq = String(doc.status || "").toLowerCase();
    // Relatório foca no que já foi pedido/separado/entregue — exclui só soft-deleted
    if (doc.deleted) continue;

    const items = doc.itemsMap || doc.items || {};
    const itemList = Array.isArray(items) ? items : Object.values(items);
    if (!itemList.length) continue;

    const date = reqDate(doc);
    const unitName = unitNameFromDoc(doc);
    const tipoUnidade =
      doc.tipoUnidade ||
      _deps.classifyUnit(unitName)?.id ||
      "outros";
    const reqId = String(doc.v2Id || doc.id);
    const histId = doc.histEntryId ? String(doc.histEntryId) : "req_" + reqId;
    coveredHistIds.add(histId);
    coveredHistIds.add("req_" + reqId);
    coveredReqIds.add(reqId);

    const parsedCats = doc.parsedData?.categories || doc.parsed?.categories || [];

    for (const it of itemList) {
      if (!it || !it.material) continue;
      const sol = _deps.extractNum(it.qtdSolicitada);
      const ate = _deps.extractNum(it.qtdAtendida);
      const itemStatus = deriveItemStatus(sol, ate, it.status);
      const cat = categoryFromItem(it, parsedCats);
      const tipoItem = it.tipo || _deps.detectTipo(cat);

      let faltante = Math.max(0, sol - ate);
      if (itemStatus === "nao_atendido" || itemStatus === "sem_estoque") {
        faltante = sol > 0 ? sol : Math.max(0, sol - ate);
      }

      rows.push({
        source: "req",
        coverage: "full",
        coverageLabel: "Completo (solicitado + atendido)",
        reqId,
        histEntryId: histId,
        unitName,
        unidadeId: doc.unidadeId || null,
        tipoUnidade,
        date,
        dateIso: isoDay(date),
        weekStart: doc.periodStart || isoDay(date),
        weekEnd: doc.periodEnd || "",
        year: date ? date.getFullYear() : null,
        month: date ? ym(date) : "",
        weekday: date ? date.getDay() : null,
        reqStatus: statusReq,
        cat,
        tipoItem,
        material: String(it.material || "").trim(),
        qtdSolicitada: sol,
        qtdAtendida: ate,
        faltante,
        itemStatus,
        // Ainda não atendido (na fila ou em separação): fica fora das contas, só aparece no calendário
        pendente: statusReq === "requisitado" || statusReq === "separacao",
        dataEntregaIso: isoDay(toDate(doc.dataEntrega) || toDate(doc.dataRetirada)),
        fileName: doc.fileName || "",
      });
    }
  }

  for (const entry of histDocs || []) {
    const eid = String(entry.id || "");
    if (coveredHistIds.has(eid)) continue;
    // Também pula se for req_* e a req já foi coberta
    if (eid.startsWith("req_") && coveredReqIds.has(eid.slice(4))) continue;

    const ws = toDate(entry.weekStart);
    const we = toDate(entry.weekEnd);
    const date = ws || we;

    for (const u of entry.units || []) {
      const unitName =
        _deps.resolveRegisteredUnit(u.unitName || u.rawUnit) ||
        u.unitName ||
        u.rawUnit ||
        "Desconhecida";
      const tipoUnidade = u.tipoUnidade || _deps.classifyUnit(unitName)?.id || "outros";

      for (const c of u.categories || []) {
        const catRaw = c.catName || "Outros";
        const cat = _deps.getCanonicalCat(_deps.normalizeCat(catRaw)) || catRaw;
        for (const it of c.items || []) {
          if (!it?.material) continue;
          const hasSol = it.qtySolicitada != null || it.qtdSolicitada != null;
          const hasAte = it.qtyAtendida != null || it.qtdAtendida != null || it.qty != null;
          const sol = hasSol
            ? _deps.extractNum(it.qtySolicitada ?? it.qtdSolicitada)
            : null;
          const ate = hasAte
            ? _deps.extractNum(it.qtyAtendida ?? it.qtdAtendida ?? it.qty)
            : _deps.extractNum(it.qty);
          const coverage = hasSol ? "full" : "delivery_only";
          const itemStatus = hasSol
            ? deriveItemStatus(sol || 0, ate || 0, it.itemStatus || it.status)
            : "entrega_registrada";

          rows.push({
            source: "hist",
            coverage,
            coverageLabel:
              coverage === "full"
                ? "Completo (solicitado + atendido)"
                : "Somente entrega registrada",
            reqId: entry.reqId || null,
            histEntryId: eid,
            unitName: String(unitName).trim(),
            unidadeId: u.unidadeId || null,
            tipoUnidade,
            date,
            dateIso: isoDay(date),
            weekStart: entry.weekStart || isoDay(date),
            weekEnd: entry.weekEnd || "",
            year: entry.year || (date ? date.getFullYear() : null),
            month: date ? ym(date) : entry.month ? `${entry.year}-${String(entry.month).padStart(2, "0")}` : "",
            weekday: date ? date.getDay() : null,
            reqStatus: "historico",
            cat,
            tipoItem: it.tipoItem || _deps.detectTipo(cat),
            material: String(it.material || "").trim(),
            qtdSolicitada: sol,
            qtdAtendida: ate || 0,
            faltante: hasSol ? Math.max(0, (sol || 0) - (ate || 0)) : null,
            itemStatus,
            fileName: entry.fileName || "",
          });
        }
      }
    }
  }

  return rows;
}

// Filtro de período por dia (AAAA-MM-DD). Aceita também AAAA-MM (filtro antigo, por mês).
function dentroDoPeriodo(r, from, to) {
  const dia = r.dateIso || "";
  const mes = r.month || dia.slice(0, 7);
  // Linha sem data não pertence a nenhum período (antes entrava em todos)
  if ((from || to) && !dia && !mes) return false;
  if (from) {
    if (from.length === 7 ? mes && mes < from : dia ? dia < from : mes && mes < from.slice(0, 7)) return false;
  }
  if (to) {
    if (to.length === 7 ? mes && mes > to : dia ? dia > to : mes && mes > to.slice(0, 7)) return false;
  }
  return true;
}

export function filterAnalyticRows(rows, filters) {
  const f = filters || _state.filters;
  const itemQ = normKey(f.itemQ || "");
  return (rows || []).filter((r) => {
    if (!dentroDoPeriodo(r, f.dateFrom, f.dateTo)) return false;
    if (f.unit && normKey(r.unitName) !== normKey(f.unit)) return false;
    if (f.tipo) {
      const tid = _deps.classifyUnit(r.unitName)?.id || r.tipoUnidade;
      if (tid !== f.tipo) return false;
    }
    if (f.cat && normKey(r.cat) !== normKey(f.cat)) return false;
    if (itemQ && !normKey(r.material).includes(itemQ)) return false;
    if (f.coverage === "full" && r.coverage !== "full") return false;
    if (f.coverage === "delivery_only" && r.coverage !== "delivery_only") return false;
    return true;
  });
}

export function computeMetrics(rows) {
  const full = rows.filter((r) => r.coverage === "full");
  const deliveryOnly = rows.filter((r) => r.coverage === "delivery_only");

  const reqKeys = new Set();
  const days = new Set();
  const weeks = new Set();
  const units = new Set();
  const materials = new Set();

  let sol = 0;
  let ate = 0;
  let ateFull = 0; // atendido só nas linhas completas (comparável ao solicitado)
  let falt = 0;
  const byStatus = {
    atendido: 0,
    parcial: 0,
    nao_atendido: 0,
    sem_estoque: 0,
    excedido: 0,
    entrega_registrada: 0,
  };
  const byWeekday = [0, 0, 0, 0, 0, 0, 0];
  const byMonth = new Map();
  const byUnit = new Map();
  const byMaterial = new Map();
  const byCat = new Map();
  const byExpediente = new Map();

  for (const r of rows) {
    const rk = r.reqId || r.histEntryId || r.dateIso + "|" + r.unitName;
    reqKeys.add(rk);
    if (r.dateIso) days.add(r.dateIso);
    if (r.weekStart) weeks.add(r.weekStart);
    units.add(r.unitName);
    materials.add(normKey(r.material));

    const ateVal = r.qtdAtendida || 0;
    ate += ateVal;

    if (r.coverage === "full") {
      sol += r.qtdSolicitada || 0;
      falt += r.faltante || 0;
      ateFull += ateVal;
    }

    byStatus[r.itemStatus] = (byStatus[r.itemStatus] || 0) + 1;

    if (r.weekday != null) byWeekday[r.weekday] += 1;

    if (r.month) byMonth.set(r.month, (byMonth.get(r.month) || 0) + ateVal);

    if (!byUnit.has(r.unitName)) {
      byUnit.set(r.unitName, {
        unit: r.unitName,
        pedidos: new Set(),
        days: new Set(),
        sol: 0,
        ate: 0,
        ateFull: 0,
        falt: 0,
        fullLines: 0,
        deliveryLines: 0,
        distinctItems: new Set(),
      });
    }
    const u = byUnit.get(r.unitName);
    u.pedidos.add(rk);
    if (r.dateIso) u.days.add(r.dateIso);
    u.ate += ateVal;
    u.distinctItems.add(normKey(r.material));
    if (r.coverage === "full") {
      u.sol += r.qtdSolicitada || 0;
      u.ateFull += ateVal;
      u.falt += r.faltante || 0;
      u.fullLines += 1;
    } else {
      u.deliveryLines += 1;
    }

    const mk = normKey(r.material);
    if (!byMaterial.has(mk)) {
      byMaterial.set(mk, {
        material: r.material,
        cat: r.cat,
        sol: 0,
        ate: 0,
        ateFull: 0,
        falt: 0,
        lines: 0,
        full: false,
        units: new Set(),
      });
    }
    const m = byMaterial.get(mk);
    m.ate += ateVal;
    m.lines += 1;
    m.units.add(r.unitName);
    if (r.coverage === "full") {
      m.sol += r.qtdSolicitada || 0;
      m.ateFull += ateVal;
      m.falt += r.faltante || 0;
      m.full = true;
    }

    const ck = r.cat || "Outros";
    if (!byCat.has(ck)) byCat.set(ck, { cat: ck, ate: 0, ateFull: 0, sol: 0, falt: 0, lines: 0 });
    const c = byCat.get(ck);
    c.ate += ateVal;
    c.lines += 1;
    if (r.coverage === "full") {
      c.sol += r.qtdSolicitada || 0;
      c.ateFull += ateVal;
      c.falt += r.faltante || 0;
    }

    const isExp =
      /expediente/i.test(r.cat || "") ||
      /expediente/i.test(r.tipoItem || "");
    if (isExp) {
      if (!byExpediente.has(mk)) {
        byExpediente.set(mk, { material: r.material, ate: 0, ateFull: 0, sol: 0, falt: 0, lines: 0, full: false });
      }
      const e = byExpediente.get(mk);
      e.ate += ateVal;
      e.lines += 1;
      if (r.coverage === "full") {
        e.sol += r.qtdSolicitada || 0;
        e.ateFull += ateVal;
        e.falt += r.faltante || 0;
        e.full = true;
      }
    }
  }

  const nPedidos = reqKeys.size;
  const nDays = days.size;
  const nWeeks = Math.max(weeks.size, 1);
  const taxa =
    sol > 0 ? Math.round((Math.min(ateFull, sol) / sol) * 1000) / 10 : null;

  const unitStats = [...byUnit.values()]
    .map((u) => ({
      unit: u.unit,
      nPedidos: u.pedidos.size,
      nDays: u.days.size,
      avgPedidosSemana: Math.round((u.pedidos.size / nWeeks) * 100) / 100,
      sol: u.sol,
      ate: u.ate,
      falt: u.falt,
      ateFull: u.ateFull,
      taxa: u.sol > 0 ? Math.round((Math.min(u.ateFull, u.sol) / u.sol) * 1000) / 10 : null,
      distinctItems: u.distinctItems.size,
      fullLines: u.fullLines,
      deliveryLines: u.deliveryLines,
      tipo: _deps.classifyUnit(u.unit),
    }))
    .sort((a, b) => b.ate - a.ate);

  const topMaterials = [...byMaterial.values()]
    .map((m) => ({
      material: m.material,
      cat: m.cat,
      sol: m.sol,
      ate: m.ate,
      falt: m.falt,
      lines: m.lines,
      nUnits: m.units.size,
      full: m.full,
      ateFull: m.ateFull,
      taxa: m.sol > 0 ? Math.round((Math.min(m.ateFull, m.sol) / m.sol) * 1000) / 10 : null,
    }))
    .sort((a, b) => b.ate - a.ate);

  const comTaxa = (x) => ({ ...x, taxa: x.sol > 0 ? Math.round((Math.min(x.ateFull, x.sol) / x.sol) * 1000) / 10 : null });
  const topCats = [...byCat.values()].map(comTaxa).sort((a, b) => b.ate - a.ate);
  const topExpediente = [...byExpediente.values()].map(comTaxa).sort((a, b) => b.ate - a.ate);

  const monthSeries = [...byMonth.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, qty]) => ({ month, qty }));

  return {
    nPedidos,
    nDays,
    nWeeks: weeks.size,
    nUnits: units.size,
    nMaterials: materials.size,
    nLines: rows.length,
    sol,
    ate,
    ateFull,
    falt,
    taxa,
    nFull: full.length,
    nDeliveryOnly: deliveryOnly.length,
    byStatus,
    byWeekday,
    unitStats,
    topMaterials,
    topCats,
    topExpediente,
    monthSeries,
  };
}

function defaultDateRange() {
  const now = new Date();
  return { from: isoDay(new Date(now.getFullYear(), now.getMonth(), 1)), to: isoDay(now) };
}

function marcarPresetAtivo() {
  document.querySelectorAll("#panFilters .pa-chip[data-preset]").forEach((b) => {
    b.classList.toggle("active", b.dataset.preset === _state.preset);
  });
}

function readFiltersFromDom() {
  const f = { ..._state.filters };
  f.dateFrom = document.getElementById("panDateFrom")?.value || "";
  f.dateTo = document.getElementById("panDateTo")?.value || "";
  f.unit = document.getElementById("panUnitSel")?.value || "";
  f.tipo = document.getElementById("panTipoSel")?.value ?? _state.filters.tipo ?? "";
  f.cat = document.getElementById("panCatSel")?.value || "";
  f.itemQ = document.getElementById("panItemQ")?.value || "";
  f.coverage = document.getElementById("panCoverage")?.value || "all";
  _state.filters = f;
  return f;
}

function setDatePreset(preset) {
  const now = new Date();
  let from;
  let to = isoDay(now);
  if (preset === "hoje") {
    from = to;
  } else if (preset === "ontem") {
    const d = new Date(now);
    d.setDate(d.getDate() - 1);
    from = to = isoDay(d);
  } else if (preset === "7d") {
    const d = new Date(now);
    d.setDate(d.getDate() - 6);
    from = isoDay(d);
  } else if (preset === "30d") {
    const d = new Date(now);
    d.setDate(d.getDate() - 30);
    from = isoDay(d);
  } else if (preset === "mes") {
    from = isoDay(new Date(now.getFullYear(), now.getMonth(), 1));
  } else if (preset === "trimestre") {
    from = isoDay(new Date(now.getFullYear(), now.getMonth() - 2, 1));
  } else if (preset === "ano") {
    from = now.getFullYear() + "-01-01";
  } else {
    const d = defaultDateRange();
    from = d.from;
    to = d.to;
  }
  const elFrom = document.getElementById("panDateFrom");
  const elTo = document.getElementById("panDateTo");
  if (elFrom) elFrom.value = from;
  if (elTo) elTo.value = to;
  _state.filters.dateFrom = from;
  _state.filters.dateTo = to;
  _state.preset = preset;
  marcarPresetAtivo();
  atualizarRotuloPeriodo();
}

function panSection(title, sub, body) {
  return (
    `<div class="pan-section" style="margin-bottom:16px">` +
    `<h3 style="font-size:14px;font-weight:800;margin:0 0 2px">${title}</h3>` +
    `<p style="font-size:11px;color:#64748b;margin:0 0 10px">${sub}</p>` +
    body +
    `</div>`
  );
}

function renderTable(headers, bodyRows, emptyMsg) {
  if (!bodyRows.length) {
    return `<div style="padding:20px;text-align:center;color:#64748b;font-size:13px">${_deps.esc(emptyMsg || "Sem dados.")}</div>`;
  }
  return (
    `<div class="tbl-wrap"><table class="pan-table"><thead><tr>` +
    headers.map((h) => `<th>${h}</th>`).join("") +
    `</tr></thead><tbody>${bodyRows.join("")}</tbody></table></div>`
  );
}

// ─── Formatação para exibição (o dado salvo não muda) ─────────────
const SIGLAS_UNIDADE = /^(cras|creas|ct|caps|sede|semcas|mse|pcdif|cmdca|cmas|cmdi|ilpi|aepeti|saps|procad)$/i;

// "Cras Cidade OperáRia" → "CRAS Cidade Operária"
const MINUSCULAS = /^(de|do|da|dos|das|e|em|no|na|nos|nas)$/i;

function nomeUnidade(nome) {
  let n = String(nome || "")
    .replace(/([à-öø-ÿ])([A-ZÀ-ÖØ-Þ])/g, (_, a, b) => a + b.toLowerCase())
    .split(" ")
    .map((w, i) => (SIGLAS_UNIDADE.test(w) ? w.toUpperCase() : i > 0 && MINUSCULAS.test(w) ? w.toLowerCase() : w))
    .join(" ");
  // Conselhos Tutelares aparecem com o prefixo CT (ex.: "CT Coroadinho/João Paulo")
  if (_deps.classifyUnit(nome)?.id === "ct" && !/^CT\b/.test(n)) n = "CT " + n;
  return n;
}

// "RESMA DE PAPEL A4" → "Resma de papel A4" (mantém códigos como A4, 100L, 8/0)
function nomeMaterial(nome) {
  const s = String(nome || "").trim();
  if (!s || s !== s.toUpperCase()) return s;
  const out = s
    .split(" ")
    .map((w) => (/\d/.test(w) ? w : w.toLowerCase()))
    .join(" ");
  return out.charAt(0).toUpperCase() + out.slice(1);
}

// "Material de Expediente" → "Expediente"
function nomeCategoria(cat) {
  return String(cat || "").replace(/^material\s+de\s+/i, "").replace(/^material\s+/i, "") || "—";
}

// Texto seguro dentro de atributo HTML (inclusive aspas)
const attrEsc = (v) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtN = (v) => Number(v || 0).toLocaleString("pt-BR");
const fmtTaxa = (t) => (t == null ? "—" : t.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + "%");
const taxaDe = (ate, sol) => (sol > 0 ? Math.round((Math.min(ate, sol) / sol) * 1000) / 10 : null);
const dataBR = (iso) => (iso ? iso.split("-").reverse().join("/") : "—");

const SITUACAO_LABEL = {
  atendido: "Atendido",
  parcial: "Parcial",
  excedido: "Excedido",
  nao_atendido: "Não atendido",
  sem_estoque: "Sem estoque",
  entrega_registrada: "Entregue",
};

function paTabela(headers, linhas, vazio) {
  if (!linhas.length) return `<div class="pa-empty">${_deps.esc(vazio || "Sem dados no filtro.")}</div>`;
  return (
    `<div class="pa-table-wrap"><table class="pa-table"><thead><tr>` +
    headers.map(([t, cls]) => `<th class="${cls || ""}">${t}</th>`).join("") +
    `</tr></thead><tbody>${linhas.join("")}</tbody></table></div>`
  );
}

function paBloco(titulo, linkTexto, linkAcao, corpo, sub) {
  return (
    `<div class="pa-card pa-block">` +
    `<div class="pa-block-head"><h3>${titulo}</h3>` +
    (linkTexto ? `<button type="button" class="pa-link" onclick="${linkAcao}">${linkTexto}</button>` : "") +
    `</div>` +
    (sub ? `<p class="pa-sub">${sub}</p>` : "") +
    corpo +
    `</div>`
  );
}

function buildGeralHtml(m, filters, filteredRows = []) {
  // Atendido/Faltante/Taxa comparam com o solicitado: usam só linhas completas (sistema novo).
  // Sem nenhuma linha completa no filtro (só histórico antigo), mostra o total entregue.
  const temSol = m.sol > 0;
  const atendido = temSol ? m.ateFull : m.ate;

  let h =
    `<div class="pa-kpis">` +
    `<div class="pa-card pa-kpi"><div class="pa-kpi-label">Pedidos</div><div class="pa-kpi-val">${fmtN(m.nPedidos)}</div></div>` +
    `<div class="pa-card pa-kpi"><div class="pa-kpi-label">Unidades</div><div class="pa-kpi-val">${fmtN(m.nUnits)}</div></div>` +
    `<div class="pa-card pa-kpi"><div class="pa-kpi-label">Solicitado</div><div class="pa-kpi-val">${temSol ? fmtN(m.sol) : "—"}</div></div>` +
    `<div class="pa-card pa-kpi"><div class="pa-kpi-label">Atendido</div><div class="pa-kpi-val pa-green">${fmtN(atendido)}</div></div>` +
    `<div class="pa-card pa-kpi"><div class="pa-kpi-label">Faltante</div><div class="pa-kpi-val pa-red">${temSol ? fmtN(m.falt) : "—"}</div></div>` +
    `<div class="pa-card pa-kpi"><div class="pa-kpi-label">Taxa de atendimento</div><div class="pa-kpi-val pa-green">${fmtTaxa(m.taxa)}</div></div>` +
    `</div>`;

  // Materiais mais solicitados (sem solicitado no filtro: ordena pelo atendido)
  const mats = m.topMaterials
    .slice()
    .sort((a, b) => b.sol - a.sol || b.ate - a.ate)
    .slice(0, 10)
    .map(
      (it, i) =>
        `<tr><td class="c">${i + 1}</td><td class="nm" title="${_deps.esc(nomeMaterial(it.material))}">${_deps.esc(nomeMaterial(it.material))}</td>` +
        `<td class="n">${it.full ? fmtN(it.sol) : "—"}</td>` +
        `<td class="n">${fmtN(it.full ? it.ateFull : it.ate)}</td>` +
        `<td class="n">${it.full ? fmtN(it.falt) : "—"}</td>` +
        `<td class="n">${fmtTaxa(it.taxa)}</td></tr>`
    );

  const unids = m.unitStats
    .slice()
    .sort((a, b) => b.nPedidos - a.nPedidos || b.sol - a.sol)
    .slice(0, _state.verTodasUnidades ? 100 : 10)
    .map(
      (u, i) =>
        `<tr class="pa-click" title="Ver só esta unidade" data-unidade="${attrEsc(u.unit)}" onclick="filtrarPainelPorUnidade(this.dataset.unidade)">` +
        `<td class="c">${i + 1}</td><td class="nm" title="${_deps.esc(nomeUnidade(u.unit))}">${_deps.esc(nomeUnidade(u.unit))}</td>` +
        `<td class="n">${fmtN(u.nPedidos)}</td>` +
        `<td class="n">${u.sol > 0 ? fmtN(u.sol) : "—"}</td>` +
        `<td class="n">${fmtN(u.sol > 0 ? u.ateFull : u.ate)}</td>` +
        `<td class="n">${u.sol > 0 ? fmtN(u.falt) : "—"}</td>` +
        `<td class="n">${fmtTaxa(u.taxa)}</td></tr>`
    );

  h +=
    `<div class="pa-two">` +
    paBloco(
      "Materiais mais solicitados",
      "Ver todos",
      "switchPanSub('itens')",
      paTabela(
        [["#", "c"], ["Material"], ["Solicitado", "n"], ["Atendido", "n"], ["Faltante", "n"], ["Taxa", "n"]],
        mats,
        "Nenhum material no filtro."
      )
    ) +
    paBloco(
      "Unidades com mais pedidos",
      _state.verTodasUnidades ? "Ver menos" : "Ver todas",
      "alternarVerTodosPainel('verTodasUnidades')",
      paTabela(
        [["#", "c"], ["Unidade"], ["Pedidos", "n"], ["Solicitado", "n"], ["Atendido", "n"], ["Faltante", "n"], ["Taxa", "n"]],
        unids,
        "Nenhuma unidade no filtro."
      )
    ) +
    `</div>`;

  // Últimos pedidos: linhas de item mais recentes (só itens pedidos ou entregues)
  const limite = _state.verTodosPedidos ? 200 : 5;
  const ultimos = filteredRows
    .filter((r) => (r.qtdSolicitada || 0) > 0 || (r.qtdAtendida || 0) > 0)
    .sort(
      (a, b) =>
        String(b.dateIso || "").localeCompare(String(a.dateIso || "")) ||
        String(a.unitName).localeCompare(String(b.unitName), "pt-BR")
    )
    .slice(0, limite)
    .map(
      (r) =>
        `<tr><td>${dataBR(r.dateIso)}</td><td class="nm" title="${_deps.esc(nomeUnidade(r.unitName))}">${_deps.esc(nomeUnidade(r.unitName))}</td>` +
        `<td class="nm" title="${_deps.esc(nomeMaterial(r.material))}">${_deps.esc(nomeMaterial(r.material))}</td><td>${_deps.esc(nomeCategoria(r.cat))}</td>` +
        `<td class="n">${fmtQtd(r.qtdSolicitada)}</td><td class="n">${fmtQtd(r.qtdAtendida)}</td>` +
        `<td class="n">${fmtQtd(r.faltante)}</td>` +
        `<td><span class="pa-badge ${_deps.esc(r.itemStatus)}">${_deps.esc(SITUACAO_LABEL[r.itemStatus] || r.itemStatus)}</span></td>` +
        `<td>${r.coverage === "full" ? "Completa" : "Só entrega"}</td></tr>`
    );

  h += paBloco(
    "Últimos pedidos",
    _state.verTodosPedidos ? "Ver menos" : "Ver todos",
    "verTodosPedidosPainel()",
    paTabela(
      [["Data"], ["Unidade"], ["Material"], ["Categoria"], ["Solicitado", "n"], ["Atendido", "n"], ["Faltante", "n"], ["Situação"], ["Cobertura"]],
      ultimos,
      "Nenhum pedido no filtro."
    ),
    _state.verTodosPedidos ? "Mostrando até 200 linhas mais recentes do filtro." : ""
  );

  return h;
}

const ITEM_STATUS = {
  atendido: { label: "Atendido", color: "#16a34a", bg: "#dcfce7" },
  parcial: { label: "Parcial", color: "#b45309", bg: "#fef3c7" },
  excedido: { label: "Excedido", color: "#1d4ed8", bg: "#dbeafe" },
  nao_atendido: { label: "Não atendido", color: "#b91c1c", bg: "#fee2e2" },
  sem_estoque: { label: "Sem estoque", color: "#b91c1c", bg: "#fee2e2" },
  entrega_registrada: { label: "Entregue (registro antigo)", color: "#475569", bg: "#f1f5f9" },
};

function statusBadge(st) {
  const s = ITEM_STATUS[st] || { label: st || "—", color: "#475569", bg: "#f1f5f9" };
  return `<span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:10px;font-weight:700;color:${s.color};background:${s.bg}">${_deps.esc(s.label)}</span>`;
}

function diaBR(iso) {
  if (!iso) return "Sem data";
  const [y, mo, d] = iso.split("-");
  const wd = new Date(`${iso}T12:00:00`).getDay();
  return `${d}/${mo}/${y} (${DAY_NAMES[wd]})`;
}

const fmtQtd = (v) => (v == null ? "—" : Number(v).toLocaleString("pt-BR"));

// Pedidos da unidade agrupados por dia do pedido → pedido → itens solicitados/entregues
function buildPedidosPorDiaHtml(filteredRows, unitName) {
  const pedidos = filteredRows.filter((r) => (r.qtdSolicitada || 0) > 0 || (r.qtdAtendida || 0) > 0);
  if (!pedidos.length) {
    return panSection(
      `Pedidos dia a dia — ${_deps.esc(unitName)}`,
      "Itens solicitados em cada dia do período",
      `<div style="padding:20px;text-align:center;color:#64748b;font-size:13px">Nenhum item pedido por esta unidade no período.</div>`
    );
  }

  const porDia = new Map();
  for (const r of pedidos) {
    const dia = r.dateIso || "";
    if (!porDia.has(dia)) porDia.set(dia, new Map());
    const chave = r.reqId || r.histEntryId || "—";
    const reqs = porDia.get(dia);
    if (!reqs.has(chave)) reqs.set(chave, []);
    reqs.get(chave).push(r);
  }
  const dias = [...porDia.keys()].sort((a, b) => b.localeCompare(a));

  const MAX_DIAS = 120;
  let body = "";
  dias.slice(0, MAX_DIAS).forEach((dia, idx) => {
    const reqs = porDia.get(dia);
    const linhasDia = [...reqs.values()].flat();
    const totSol = linhasDia.reduce((s, r) => s + (r.qtdSolicitada || 0), 0);
    const totAte = linhasDia.reduce((s, r) => s + (r.qtdAtendida || 0), 0);
    const temSol = linhasDia.some((r) => r.qtdSolicitada != null);

    let inner = "";
    for (const itens of reqs.values()) {
      const r0 = itens[0];
      if (reqs.size > 1 || r0.fileName) {
        inner +=
          `<div style="font-size:11px;color:#475569;margin:8px 0 4px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">` +
          `<b>Pedido</b>${r0.fileName ? ` <span>${_deps.esc(r0.fileName)}</span>` : ""}` +
          (r0.reqStatus ? ` <span style="color:#64748b">· situação: ${_deps.esc(r0.reqStatus)}</span>` : "") +
          `</div>`;
      }
      const linhas = itens
        .slice()
        .sort((a, b) => String(a.cat).localeCompare(String(b.cat), "pt-BR") || String(a.material).localeCompare(String(b.material), "pt-BR"))
        .map(
          (r) =>
            `<tr>` +
            `<td style="font-weight:600">${_deps.esc(r.material)}</td>` +
            `<td style="font-size:11px;color:#64748b">${_deps.esc(r.cat)}</td>` +
            `<td style="text-align:right">${fmtQtd(r.qtdSolicitada)}</td>` +
            `<td style="text-align:right">${fmtQtd(r.qtdAtendida)}</td>` +
            `<td>${statusBadge(r.itemStatus)}</td>` +
            `</tr>`
        );
      inner += renderTable(["Material", "Categoria", "Solicitado", "Atendido", "Situação"], linhas);
    }

    body +=
      `<details ${idx < 7 ? "open" : ""} style="border:1px solid #e2e8f0;border-radius:10px;margin-bottom:10px;background:#fff">` +
      `<summary style="cursor:pointer;padding:10px 12px;display:flex;flex-wrap:wrap;gap:10px;align-items:center;font-size:13px">` +
      `<b style="color:#0f172a">${diaBR(dia)}</b>` +
      `<span style="font-size:11px;color:#64748b">${reqs.size} pedido${reqs.size > 1 ? "s" : ""} · ${linhasDia.length} ite${linhasDia.length > 1 ? "ns" : "m"}</span>` +
      `<span style="font-size:11px;margin-left:auto">${temSol ? `Solicitado <b>${fmtQtd(totSol)}</b> · ` : ""}Atendido <b>${fmtQtd(totAte)}</b></span>` +
      `</summary>` +
      `<div style="padding:0 12px 10px">${inner}</div>` +
      `</details>`;
  });

  const aviso =
    dias.length > MAX_DIAS
      ? `<p style="font-size:11px;color:#b45309;margin:4px 0 0">Mostrando os ${MAX_DIAS} dias mais recentes de ${dias.length}. Reduza o período para ver os demais.</p>`
      : "";

  return panSection(
    `Pedidos dia a dia — ${_deps.esc(unitName)}`,
    `${dias.length} dia${dias.length > 1 ? "s" : ""} com pedido no período · mais recente primeiro · clique no dia para abrir/fechar`,
    body + aviso
  );
}

// Quantidade "consumida" comparável ao solicitado: só linhas completas quando houver solicitado
const consumo = (x) => (x.sol > 0 ? x.ateFull : x.ate);

function linhaQtd(x) {
  return (
    `<td class="n">${x.sol > 0 ? fmtN(x.sol) : "—"}</td>` +
    `<td class="n">${fmtN(consumo(x))}</td>` +
    `<td class="n">${x.sol > 0 ? fmtN(x.falt) : "—"}</td>` +
    `<td class="n">${fmtTaxa(x.taxa)}</td>`
  );
}

function graficoCategorias(cats) {
  if (!cats.length) return `<div class="pa-empty">Sem categorias no filtro.</div>`;
  const max = Math.max(...cats.map((c) => Math.max(c.sol, consumo(c))), 1);
  const pct = (v) => Math.max(0.6, (v / max) * 100).toFixed(1) + "%";
  const linhas = cats
    .map(
      (c) =>
        `<div class="pa-bar-row">` +
        `<span class="pa-bar-label" title="${attrEsc(nomeCategoria(c.cat))}">${_deps.esc(nomeCategoria(c.cat))}</span>` +
        `<div class="pa-bars">` +
        (c.sol > 0
          ? `<div class="pa-bar-line"><div class="pa-bar sol" style="width:${pct(c.sol)}"></div><span>${fmtN(c.sol)}</span></div>`
          : "") +
        `<div class="pa-bar-line"><div class="pa-bar ate" style="width:${pct(consumo(c))}"></div><span>${fmtN(consumo(c))}</span></div>` +
        `</div></div>`
    )
    .join("");
  return (
    `<div class="pa-chart">` +
    `<div class="pa-chart-head"><b>Solicitado x Atendido por categoria</b>` +
    `<span class="pa-legend"><i class="sol"></i>Solicitado<i class="ate"></i>Atendido</span></div>` +
    linhas +
    `</div>`
  );
}

function buildItensHtml(m, filteredRows = [], filters = {}) {
  const nMat = _state.verTodosMateriais ? 100 : 10;
  const nExp = _state.verTodosExpediente ? 100 : 10;

  const materiais = m.topMaterials
    .slice()
    .sort((a, b) => consumo(b) - consumo(a) || b.sol - a.sol)
    .slice(0, nMat)
    .map(
      (it, i) =>
        `<tr><td class="c">${i + 1}</td>` +
        `<td class="nm" title="${attrEsc(nomeMaterial(it.material))}">${_deps.esc(nomeMaterial(it.material))}</td>` +
        `<td class="ct" title="${attrEsc(nomeCategoria(it.cat))}">${_deps.esc(nomeCategoria(it.cat))}</td>` +
        linhaQtd(it) +
        `</tr>`
    );

  const expediente = m.topExpediente
    .slice()
    .sort((a, b) => consumo(b) - consumo(a) || b.sol - a.sol)
    .slice(0, nExp)
    .map(
      (it, i) =>
        `<tr><td class="c">${i + 1}</td>` +
        `<td class="nm" title="${attrEsc(nomeMaterial(it.material))}">${_deps.esc(nomeMaterial(it.material))}</td>` +
        linhaQtd(it) +
        `</tr>`
    );

  let h =
    `<div class="pa-two">` +
    paBloco(
      "Materiais mais consumidos no período",
      _state.verTodosMateriais ? "Ver menos" : "Ver todos",
      "alternarVerTodosPainel('verTodosMateriais')",
      paTabela(
        [["#", "c"], ["Material"], ["Categoria"], ["Solicitado", "n"], ["Atendido", "n"], ["Faltante", "n"], ["Taxa", "n"]],
        materiais,
        "Nenhum material no filtro."
      )
    ) +
    paBloco(
      "Materiais de expediente (mais consumidos)",
      _state.verTodosExpediente ? "Ver menos" : "Ver todos",
      "alternarVerTodosPainel('verTodosExpediente')",
      paTabela(
        [["#", "c"], ["Material"], ["Solicitado", "n"], ["Atendido", "n"], ["Faltante", "n"], ["Taxa", "n"]],
        expediente,
        "Nenhum material de expediente no filtro."
      )
    ) +
    `</div>`;

  const cats = m.topCats
    .slice()
    .sort((a, b) => b.sol - a.sol || consumo(b) - consumo(a))
    .slice(0, 10);
  const linhasCat = cats.map(
    (c, i) =>
      `<tr><td class="c">${i + 1}</td><td>${_deps.esc(nomeCategoria(c.cat))}</td>` + linhaQtd(c) + `</tr>`
  );

  h +=
    `<div class="pa-card pa-block">` +
    `<div class="pa-block-head"><h3>Consumo por categoria</h3></div>` +
    `<div class="pa-cat-grid">` +
    paTabela(
      [["#", "c"], ["Categoria"], ["Solicitado", "n"], ["Atendido", "n"], ["Faltante", "n"], ["Taxa", "n"]],
      linhasCat,
      "Sem categorias no filtro."
    ) +
    graficoCategorias(cats) +
    `</div></div>`;

  // Com uma unidade escolhida, mostra também o que ela pediu dia a dia
  if (filters.unit) h += buildPedidosPorDiaHtml(filteredRows, filters.unit);

  return h;
}

function preencherUnidades() {
  const unitSel = document.getElementById("panUnitSel");
  if (!unitSel) return;
  const tipo = document.getElementById("panTipoSel")?.value || "";
  const prev = unitSel.value || _state.filters.unit || "";
  const units = [...new Set((_state.rows || []).map((r) => r.unitName).filter(Boolean))]
    .filter((u) => !tipo || _deps.classifyUnit(u)?.id === tipo)
    .sort((a, b) => nomeUnidade(a).localeCompare(nomeUnidade(b), "pt-BR"));
  unitSel.innerHTML =
    `<option value="">Todas</option>` +
    units.map((u) => `<option value="${_deps.esc(u)}">${_deps.esc(nomeUnidade(u))}</option>`).join("");
  unitSel.value = units.includes(prev) ? prev : "";
}

function populateFilterOptions(allRows) {
  const units = [...new Set(allRows.map((r) => r.unitName).filter(Boolean))];
  const cats = [...new Set(allRows.map((r) => r.cat).filter(Boolean))].sort((a, b) =>
    nomeCategoria(a).localeCompare(nomeCategoria(b), "pt-BR")
  );

  const typeCounts = {};
  units.forEach((u) => {
    const t = _deps.classifyUnit(u);
    typeCounts[t.id] = (typeCounts[t.id] || 0) + 1;
  });

  const tipoSel = document.getElementById("panTipoSel");
  if (tipoSel) {
    tipoSel.innerHTML =
      `<option value="">Todos</option>` +
      (_deps.UNIT_TYPES || [])
        .filter((t) => typeCounts[t.id])
        .map((t) => `<option value="${_deps.esc(t.id)}">${_deps.esc(t.label)} (${typeCounts[t.id]})</option>`)
        .join("");
    tipoSel.value = _state.filters.tipo || "";
  }

  preencherUnidades();

  const catSel = document.getElementById("panCatSel");
  if (catSel) {
    const prev = _state.filters.cat || catSel.value || "";
    catSel.innerHTML =
      `<option value="">Todas</option>` +
      cats.map((c) => `<option value="${_deps.esc(c)}">${_deps.esc(nomeCategoria(c))}</option>`).join("");
    if (prev && [...catSel.options].some((o) => o.value === prev)) catSel.value = prev;
  }

  marcarPresetAtivo();
}

function ensureDefaultDates() {
  const elFrom = document.getElementById("panDateFrom");
  const elTo = document.getElementById("panDateTo");
  if (elFrom && !elFrom.value) {
    const d = defaultDateRange();
    elFrom.value = d.from;
    if (elTo && !elTo.value) elTo.value = d.to;
  }
  atualizarRotuloPeriodo();
}

// Dados com mais de 2 minutos são buscados de novo, para pedidos novos/atendidos aparecerem sem "Atualizar dados"
const DADOS_VALIDOS_MS = 2 * 60 * 1000;

async function ensureDataLoaded(force = false) {
  const velhos = !_state.loadedAt || Date.now() - _state.loadedAt.getTime() > DADOS_VALIDOS_MS;
  if (_state.loaded && !force && !velhos && _state.rows.length) return _state.rows;
  if (velhos) force = true;
  _state.loading = true;
  try {
    const [mats, hist] = await Promise.all([
      fetchAllMateriaisForReport({ force }),
      fetchAllHistForReport({ force }),
    ]);
    _state.rows = buildAnalyticRows(mats, hist);
    _state.loaded = true;
    _state.loadedAt = new Date();
    return _state.rows;
  } finally {
    _state.loading = false;
  }
}

function renderSubTabsActive() {
  document.querySelectorAll(".pan-sub-tab").forEach((btn) => {
    btn.classList.toggle("active", btn.getAttribute("data-pansub") === _state.sub);
  });
}

function mostrarAtualizacao() {
  const el = document.getElementById("panUpdatedAt");
  if (!el || !_state.loadedAt) return;
  const d = _state.loadedAt;
  el.textContent =
    "Última atualização: " +
    d.toLocaleDateString("pt-BR") +
    " " +
    d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

export async function buildPainelRelatorio(opts = {}) {
  const el = document.getElementById("panContent");
  if (!el) return;

  ensureDefaultDates();
  if (opts.preset) setDatePreset(opts.preset);

  renderSubTabsActive();
  marcarPresetAtivo();
  el.innerHTML = `<div class="pa-card pa-empty">Carregando os pedidos de materiais...</div>`;

  try {
    const allRows = await ensureDataLoaded(!!opts.force);
    // Aberto logo após entrar, a consulta pode voltar vazia (login/coleção ainda carregando): tenta de novo sozinho
    const tentativa = opts._tentativa || 0;
    if (!allRows.length && tentativa < 5) {
      setTimeout(() => {
        const painel = document.getElementById("content-painel");
        if (painel && !painel.classList.contains("hidden")) buildPainelRelatorio({ ...opts, _tentativa: tentativa + 1 });
      }, 2000);
    }
    // Lê o que está escolhido na tela antes de recriar as listas (senão a escolha se perde)
    const filters = readFiltersFromDom();
    populateFilterOptions(allRows);
    const noPeriodo = filterAnalyticRows(allRows, filters);
    // Pedidos ainda não atendidos não entram nas contas (senão viram "não atendido" e inflam o faltante)
    const filtered = noPeriodo.filter((r) => !r.pendente);
    const nPendentes = new Set(noPeriodo.filter((r) => r.pendente).map((r) => r.reqId)).size;
    const metrics = computeMetrics(filtered);
    atualizarRotuloPeriodo();
    if (document.getElementById("panCal")?.classList.contains("open")) renderCalendarioPainel();
    _state.lastExportRows = filtered;

    renderSubTabsActive();

    mostrarAtualizacao();

    let html = "";
    if (_state.sub === "itens") html = buildItensHtml(metrics, filtered, filters);
    else html = buildGeralHtml(metrics, filters, filtered);

    if (!filtered.length) {
      html =
        `<div class="pa-card pa-empty"><b style="color:#0f172a">Nenhum dado no filtro.</b> ` +
        `Ajuste o período, a unidade, o tipo ou a categoria.</div>` + html;
    }
    if (nPendentes) {
      html =
        `<div class="pa-card pa-note">${nPendentes} pedido${nPendentes > 1 ? "s" : ""} do período ainda ` +
        `aguarda${nPendentes > 1 ? "m" : ""} atendimento e não entra${nPendentes > 1 ? "m" : ""} nas contas até ser separado.</div>` +
        html;
    }

    el.innerHTML = html;
    _deps.refreshIcons?.();
  } catch (e) {
    console.error(e);
    el.innerHTML =
      `<div style="padding:40px;text-align:center;color:#b91c1c">` +
      `<b>Falha ao carregar relatório.</b><br><span style="font-size:12px">${_deps.esc(e?.message || e)}</span>` +
      `<br><button class="btn btn-s btn-sm" style="margin-top:12px" onclick="buildPainel({force:true})">Tentar de novo</button></div>`;
  }
}

export function switchPanSubRelatorio(sub) {
  const allowed = new Set(["geral", "itens"]);
  _state.sub = allowed.has(sub) ? sub : "geral";
  return buildPainelRelatorio();
}

// exato=true vem do select (define o tipo); os chips alternam (clicar de novo desmarca)
export function setPanTipoRelatorio(id, exato = false) {
  _state.filters.tipo = exato ? id || "" : _state.filters.tipo === id ? "" : id;
  const tipoSel = document.getElementById("panTipoSel");
  if (tipoSel) tipoSel.value = _state.filters.tipo;
  _state.filters.unit = "";
  const unitSel = document.getElementById("panUnitSel");
  if (unitSel) unitSel.value = "";
  return buildPainelRelatorio();
}

export function clearPanFiltersRelatorio() {
  _state.filters = {
    dateFrom: "",
    dateTo: "",
    unit: "",
    tipo: "",
    cat: "",
    itemQ: "",
    coverage: "all",
  };
  const ids = ["panDateFrom", "panDateTo", "panTipoSel", "panUnitSel", "panCatSel", "panItemQ"];
  ids.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (el.tagName === "SELECT" || el.tagName === "INPUT") el.value = "";
  });
  const cob = document.getElementById("panCoverage");
  if (cob) cob.value = "all";
  _state.verTodosPedidos = false;
  _state.verTodosMateriais = false;
  _state.verTodosExpediente = false;
  _state.verTodasUnidades = false;
  setDatePreset("mes");
  return buildPainelRelatorio();
}

export function applyPanDatePreset(preset) {
  setDatePreset(preset);
  return buildPainelRelatorio();
}

export function exportarPainelCSV() {
  const rows = _state.lastExportRows || [];
  if (!rows.length) {
    _deps.toast?.("Nenhum dado para exportar. Ajuste os filtros.", "red");
    return;
  }
  const data = rows.map((r) => ({
    Unidade: r.unitName,
    TipoUnidade: _deps.classifyUnit(r.unitName)?.label || r.tipoUnidade || "",
    Data: r.dateIso || "",
    SemanaInicio: r.weekStart || "",
    Categoria: r.cat,
    Material: r.material,
    Solicitado: r.qtdSolicitada != null ? r.qtdSolicitada : "",
    Atendido: r.qtdAtendida != null ? r.qtdAtendida : "",
    Faltante: r.faltante != null ? r.faltante : "",
    Status: r.itemStatus,
    Cobertura: r.coverageLabel,
    Arquivo: r.fileName || "",
  }));

  if (typeof XLSX !== "undefined") {
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Painel");
    XLSX.writeFile(wb, "Relatorio_Materiais_Painel.xlsx");
    _deps.toast?.("Exportado com " + data.length + " linhas.", "green");
    return;
  }

  // Fallback CSV
  const headers = Object.keys(data[0]);
  const csv = [
    headers.join(";"),
    ...data.map((row) =>
      headers
        .map((h) => {
          const v = row[h] == null ? "" : String(row[h]);
          return `"${v.replace(/"/g, '""')}"`;
        })
        .join(";")
    ),
  ].join("\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "Relatorio_Materiais_Painel.csv";
  a.click();
  URL.revokeObjectURL(a.href);
  _deps.toast?.("CSV exportado.", "green");
}

export function imprimirPainelRelatorio() {
  const el = document.getElementById("panContent");
  if (!el) return;
  const w = window.open("", "_blank", "width=1100,height=900");
  if (!w) {
    _deps.toast?.("Permita pop-ups para imprimir.", "red");
    return;
  }
  w.document.write(`<!DOCTYPE html><html><head><title>Relatório Materiais</title>
    <style>
      body{font-family:system-ui,sans-serif;padding:20px;color:#0f172a}
      table{width:100%;border-collapse:collapse;font-size:11px}
      th,td{border:1px solid #e2e8f0;padding:4px 6px;text-align:left}
      th{background:#f1f5f9}
      .pan-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:12px}
      .pan-kpi{border:1px solid #e2e8f0;border-radius:8px;padding:10px}
      .pan-kpi-val{font-size:20px;font-weight:800}
      .pan-kpi-label{font-size:11px;font-weight:700}
      .pan-kpi-sub{font-size:10px;color:#64748b}
      h2,h3{margin:12px 0 6px}
      button{display:none!important}
      input{display:none!important}
      @media print{body{padding:0}}
    </style></head><body>${el.innerHTML}
    <script>window.onload=function(){setTimeout(function(){window.print()},200)}<\/script>
    </body></html>`);
  w.document.close();
}

/** Popula filtros do Relatório de Consumo (aba Banco) — selects que estavam vazios. */
export function populateConsumoFilters(histDb, helpers = {}) {
  const getCat = helpers.getCanonicalCat || _deps.getCanonicalCat;
  const allUnits = new Set();
  const allCats = new Set();
  const allYears = new Set();
  (histDb || []).forEach((e) => {
    if (e.year) allYears.add(e.year);
    (e.units || []).forEach((u) => {
      if (u.unitName) allUnits.add(u.unitName);
      (u.categories || []).forEach((c) => {
        const cat = getCat(c.catName) || c.catName;
        if (cat) allCats.add(cat);
      });
    });
  });

  const unitsEl = document.getElementById("rFiltUnits");
  if (unitsEl) {
    const prev = [...unitsEl.selectedOptions].map((o) => o.value);
    const sorted = [...allUnits].sort((a, b) => a.localeCompare(b, "pt-BR"));
    unitsEl.innerHTML = sorted
      .map((u) => `<option value="${_deps.esc(u)}"${prev.includes(u) ? " selected" : ""}>${_deps.esc(u)}</option>`)
      .join("");
  }

  const catsEl = document.getElementById("rFiltCats");
  if (catsEl) {
    const prev = [...catsEl.selectedOptions].map((o) => o.value);
    const sorted = [...allCats].sort((a, b) => a.localeCompare(b, "pt-BR"));
    catsEl.innerHTML = sorted
      .map((c) => `<option value="${_deps.esc(c)}"${prev.includes(c) ? " selected" : ""}>${_deps.esc(c)}</option>`)
      .join("");
  }

  const yearsEl = document.getElementById("rYearChecks");
  if (yearsEl) {
    const prev = new Set(
      [...yearsEl.querySelectorAll("input:checked")].map((i) => String(i.value))
    );
    const sorted = [...allYears].sort((a, b) => b - a);
    if (!sorted.length) {
      yearsEl.innerHTML = `<span style="font-size:11px;color:var(--muted)">Sem anos no banco</span>`;
    } else {
      const hadChecks = yearsEl.querySelectorAll("input[type=checkbox]").length > 0;
      yearsEl.innerHTML = sorted
        .map((y) => {
          // Primeira população: marca todos. Depois: preserva seleção.
          const ck = !hadChecks || prev.has(String(y)) ? " checked" : "";
          return `<label style="font-size:11px;display:inline-flex;align-items:center;gap:3px;cursor:pointer"><input type="checkbox" value="${y}"${ck}> ${y}</label>`;
        })
        .join("");
    }
  }
}

export function listUnidadesCadastroMateriais() {
  return (getUnidades() || [])
    .filter((u) => (u?.atendeMateriais ?? true) === true && !u?.duplicataDe)
    .map((u) => ({
      nome: String(u.nome || u.unidadeNome || "").trim(),
      tipo: String(u.tipoUnidade || u.tipo || "OUTROS").trim(),
      sigla: String(u.sigla || "").trim(),
    }))
    .filter((u) => u.nome);
}

// ─── Ações dos botões do painel (chamadas pelo HTML) ──────────────
function atualizarUnidadesDoTipo() {
  preencherUnidades();
}

function marcarPeriodoPersonalizado() {
  _state.preset = "personalizado";
  marcarPresetAtivo();
}

function verTodosPedidosPainel() {
  _state.verTodosPedidos = !_state.verTodosPedidos;
  buildPainelRelatorio();
}

function filtrarPainelPorUnidade(unidade) {
  const sel = document.getElementById("panUnitSel");
  if (sel) {
    if (![...sel.options].some((o) => o.value === unidade)) {
      const tipoSel = document.getElementById("panTipoSel");
      if (tipoSel) tipoSel.value = "";
      preencherUnidades();
    }
    sel.value = unidade;
  }
  buildPainelRelatorio();
}

function alternarVerTodosPainel(chave) {
  _state[chave] = !_state[chave];
  buildPainelRelatorio();
}

// Filtros aplicam sozinhos ao mudar; a busca por material espera a pessoa parar de digitar
let __filtroTimer = null;
function aplicarFiltrosPainel(atraso = 0) {
  clearTimeout(__filtroTimer);
  __filtroTimer = setTimeout(() => buildPainelRelatorio(), atraso);
}

// ─── Calendário do período (marca os dias que tiveram pedido) ─────
const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
let _cal = { mes: null, inicio: null };

function atualizarRotuloPeriodo() {
  const el = document.getElementById("panCalLabel");
  if (!el) return;
  const from = document.getElementById("panDateFrom")?.value || "";
  const to = document.getElementById("panDateTo")?.value || "";
  if (!from && !to) el.textContent = "Todo o período";
  else if (from === to) el.textContent = dataBR(from);
  else el.textContent = `${from ? dataBR(from) : "início"} até ${to ? dataBR(to) : "hoje"}`;
}

// Dia → pedidos (respeita unidade/tipo/categoria escolhidos, ignora o período)
function pedidosPorDia() {
  const base = filterAnalyticRows(_state.rows, { ..._state.filters, dateFrom: "", dateTo: "" });
  const dias = new Map();
  for (const r of base) {
    if (!r.dateIso) continue;
    if (!dias.has(r.dateIso)) dias.set(r.dateIso, { pedidos: new Set(), pendentes: new Set() });
    const d = dias.get(r.dateIso);
    const chave = r.reqId || r.histEntryId;
    d.pedidos.add(chave);
    if (r.pendente) d.pendentes.add(chave);
  }
  return dias;
}

function renderCalendarioPainel() {
  const el = document.getElementById("panCal");
  if (!el) return;
  const mes = _cal.mes;
  const from = document.getElementById("panDateFrom")?.value || "";
  const to = document.getElementById("panDateTo")?.value || "";
  const hoje = isoDay(new Date());
  const dias = pedidosPorDia();

  const primeiro = new Date(mes.getFullYear(), mes.getMonth(), 1);
  const nDias = new Date(mes.getFullYear(), mes.getMonth() + 1, 0).getDate();
  let cels = "";
  for (let i = 0; i < primeiro.getDay(); i++) cels += `<span></span>`;
  let pedidosMes = 0;
  for (let n = 1; n <= nDias; n++) {
    const iso = isoDay(new Date(mes.getFullYear(), mes.getMonth(), n));
    const info = dias.get(iso);
    const cls = ["pa-cal-dia"];
    let titulo = "Sem pedido";
    if (info) {
      const tot = info.pedidos.size;
      const pend = info.pendentes.size;
      pedidosMes += tot;
      cls.push(pend ? "pend" : "tem");
      titulo = `${tot} pedido${tot > 1 ? "s" : ""}` + (pend ? ` · ${pend} aguardando atendimento` : ` · atendido${tot > 1 ? "s" : ""}`);
    }
    if (iso === hoje) cls.push("hoje");
    const inicio = _cal.inicio || from;
    const fim = _cal.inicio ? "" : to;
    if (inicio && iso === inicio) cls.push("ini");
    if (fim && iso === fim) cls.push("fim");
    if (inicio && fim && iso > inicio && iso < fim) cls.push("meio");
    cels += `<button type="button" class="${cls.join(" ")}" title="${titulo}" onclick="escolherDiaPainel('${iso}')">${n}</button>`;
  }

  el.innerHTML =
    `<div class="pa-cal-head">` +
    `<button type="button" onclick="navMesPainel(-1)" aria-label="Mês anterior">‹</button>` +
    `<b>${MESES[mes.getMonth()]} ${mes.getFullYear()}</b>` +
    `<button type="button" onclick="navMesPainel(1)" aria-label="Próximo mês">›</button></div>` +
    `<div class="pa-cal-grid">${["D", "S", "T", "Q", "Q", "S", "S"].map((d) => `<span class="pa-cal-sem">${d}</span>`).join("")}${cels}</div>` +
    `<p class="pa-cal-dica">${_cal.inicio ? "Agora clique no último dia do período." : "Clique no primeiro dia e depois no último. Para um dia só, clique duas vezes nele."}</p>` +
    `<div class="pa-cal-leg"><span><i class="tem"></i>Dia com pedido atendido</span><span><i class="pend"></i>Aguardando atendimento</span></div>` +
    `<div class="pa-cal-rodape"><span>${pedidosMes} pedido${pedidosMes === 1 ? "" : "s"} no mês</span>` +
    `<button type="button" class="pa-link" onclick="fecharCalendarioPainel()">Fechar</button></div>`;
}

function abrirCalendarioPainel() {
  const el = document.getElementById("panCal");
  if (!el) return;
  if (el.classList.contains("open")) return fecharCalendarioPainel();
  readFiltersFromDom();
  const ref = document.getElementById("panDateTo")?.value || document.getElementById("panDateFrom")?.value;
  const base = ref ? new Date(ref + "T12:00:00") : new Date();
  _cal = { mes: new Date(base.getFullYear(), base.getMonth(), 1), inicio: null };
  el.classList.add("open");
  renderCalendarioPainel();
  setTimeout(() => document.addEventListener("mousedown", fecharCalendarioAoClicarFora), 0);
}

function fecharCalendarioPainel() {
  document.getElementById("panCal")?.classList.remove("open");
  document.removeEventListener("mousedown", fecharCalendarioAoClicarFora);
  _cal.inicio = null;
}

function fecharCalendarioAoClicarFora(e) {
  if (!e.target.closest?.(".pa-cal-wrap")) fecharCalendarioPainel();
}

function navMesPainel(delta) {
  _cal.mes = new Date(_cal.mes.getFullYear(), _cal.mes.getMonth() + delta, 1);
  renderCalendarioPainel();
}

function escolherDiaPainel(iso) {
  if (!_cal.inicio) {
    _cal.inicio = iso;
    renderCalendarioPainel();
    return;
  }
  const [from, to] = iso < _cal.inicio ? [iso, _cal.inicio] : [_cal.inicio, iso];
  document.getElementById("panDateFrom").value = from;
  document.getElementById("panDateTo").value = to;
  _state.preset = "personalizado";
  marcarPresetAtivo();
  fecharCalendarioPainel();
  buildPainelRelatorio();
}

Object.assign(window, {
  atualizarUnidadesDoTipo,
  marcarPeriodoPersonalizado,
  verTodosPedidosPainel,
  filtrarPainelPorUnidade,
  alternarVerTodosPainel,
  aplicarFiltrosPainel,
  abrirCalendarioPainel,
  fecharCalendarioPainel,
  navMesPainel,
  escolherDiaPainel,
});
