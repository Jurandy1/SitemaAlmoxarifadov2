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
      m.falt += r.faltante || 0;
      m.full = true;
    }

    const ck = r.cat || "Outros";
    if (!byCat.has(ck)) byCat.set(ck, { cat: ck, ate: 0, sol: 0, lines: 0 });
    const c = byCat.get(ck);
    c.ate += ateVal;
    c.lines += 1;
    if (r.coverage === "full") c.sol += r.qtdSolicitada || 0;

    const isExp =
      /expediente/i.test(r.cat || "") ||
      /expediente/i.test(r.tipoItem || "");
    if (isExp) {
      if (!byExpediente.has(mk)) {
        byExpediente.set(mk, { material: r.material, ate: 0, sol: 0, lines: 0 });
      }
      const e = byExpediente.get(mk);
      e.ate += ateVal;
      e.lines += 1;
      if (r.coverage === "full") e.sol += r.qtdSolicitada || 0;
    }
  }

  const nPedidos = reqKeys.size;
  const nDays = days.size;
  const nWeeks = Math.max(weeks.size, 1);
  const taxa =
    sol > 0 ? Math.round((Math.min(ate, sol) / sol) * 1000) / 10 : null;

  const unitStats = [...byUnit.values()]
    .map((u) => ({
      unit: u.unit,
      nPedidos: u.pedidos.size,
      nDays: u.days.size,
      avgPedidosSemana: Math.round((u.pedidos.size / nWeeks) * 100) / 100,
      sol: u.sol,
      ate: u.ate,
      falt: u.falt,
      taxa: u.sol > 0 ? Math.round((Math.min(u.ate, u.sol) / u.sol) * 1000) / 10 : null,
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
      taxa: m.sol > 0 ? Math.round((Math.min(m.ate, m.sol) / m.sol) * 1000) / 10 : null,
    }))
    .sort((a, b) => b.ate - a.ate);

  const topCats = [...byCat.values()].sort((a, b) => b.ate - a.ate);
  const topExpediente = [...byExpediente.values()].sort((a, b) => b.ate - a.ate);

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
  return { from: isoDay(new Date(now.getFullYear(), now.getMonth() - 2, 1)), to: isoDay(now) };
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
  if (preset === "30d") {
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
}

function kpi(val, label, sub, tip, color) {
  return (
    `<div class="pan-kpi" title="${_deps.esc(tip || "")}" style="border-top:3px solid ${color || "#2563eb"}">` +
    `<div class="pan-kpi-val" style="color:${color || "#0f172a"}">${val}</div>` +
    `<div class="pan-kpi-label">${_deps.esc(label)}</div>` +
    (sub ? `<div class="pan-kpi-sub">${_deps.esc(sub)}</div>` : "") +
    `</div>`
  );
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

function coverageBanner(m) {
  const total = m.nFull + m.nDeliveryOnly;
  if (!total) return "";
  const pct = Math.round((m.nFull / total) * 100);
  return (
    `<div class="alert-card alert-blue" style="margin-bottom:12px">` +
    `<div class="alert-icon"></div>` +
    `<div class="alert-body"><b>Cobertura dos dados:</b> ${m.nFull.toLocaleString("pt-BR")} linhas completas ` +
    `(solicitado + atendido) · ${m.nDeliveryOnly.toLocaleString("pt-BR")} só com entrega registrada. ` +
    `Taxa de atendimento usa apenas linhas completas (${pct}%). ` +
    `Dados antigos sem pedido/atendido aparecem como “somente entrega registrada”.</div></div>`
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

function buildGeralHtml(m, filters) {
  let h = coverageBanner(m);
  const scope =
    filters.unit ||
    (filters.tipo
      ? _deps.UNIT_TYPES.find((t) => t.id === filters.tipo)?.label || filters.tipo
      : "Todas as unidades");

  h += `<h2 style="font-size:16px;font-weight:800;margin:0 0 4px">Visão geral — ${_deps.esc(scope)}</h2>`;
  h += `<p style="font-size:12px;color:#64748b;margin:0 0 12px">Pedidos, consumo e atendimento no período filtrado.</p>`;

  h +=
    `<div class="pan-grid">` +
    kpi(m.nPedidos.toLocaleString("pt-BR"), "Pedidos", "requisições / planilhas", "", "#6366f1") +
    kpi(m.nDays.toLocaleString("pt-BR"), "Dias com pedido", "dias distintos", "", "#0891b2") +
    kpi(
      m.nWeeks ? (Math.round((m.nPedidos / Math.max(m.nWeeks, 1)) * 100) / 100).toLocaleString("pt-BR") : "—",
      "Média pedidos/semana",
      m.nWeeks + " semanas no filtro",
      "",
      "#0284c7"
    ) +
    kpi(m.nUnits.toLocaleString("pt-BR"), "Unidades", "com movimento", "", "#059669") +
    kpi(m.nMaterials.toLocaleString("pt-BR"), "Materiais distintos", "itens únicos", "", "#7c3aed") +
    kpi(m.ate.toLocaleString("pt-BR"), "Qtd. atendida", "unidades físicas", "", "#dc2626") +
    kpi(
      m.sol > 0 ? m.sol.toLocaleString("pt-BR") : "—",
      "Qtd. solicitada",
      m.sol > 0 ? "só linhas completas" : "sem dados de pedido",
      "",
      "#1d4ed8"
    ) +
    kpi(
      m.taxa != null ? m.taxa + "%" : "—",
      "Taxa de atendimento",
      m.taxa != null ? "atendido ÷ solicitado" : "indisponível nos antigos",
      "",
      "#16a34a"
    ) +
    `</div>`;

  if (m.unitStats.length) {
    const rows = m.unitStats.slice(0, 25).map((u) => {
      const tip = u.tipo || _deps.classifyUnit(u.unit);
      return (
        `<tr style="cursor:pointer" onclick="document.getElementById('panUnitSel').value='${_deps.esc(u.unit)}';buildPainel()">` +
        `<td style="font-weight:700">${tip?.icon || ""} ${_deps.esc(u.unit)}</td>` +
        `<td>${u.nPedidos}</td>` +
        `<td>${u.nDays}</td>` +
        `<td>${u.avgPedidosSemana}</td>` +
        `<td>${u.ate.toLocaleString("pt-BR")}</td>` +
        `<td>${u.sol > 0 ? u.sol.toLocaleString("pt-BR") : "—"}</td>` +
        `<td>${u.taxa != null ? u.taxa + "%" : "—"}</td>` +
        `<td>${u.distinctItems}</td>` +
        `</tr>`
      );
    });
    h += panSection(
      "Unidades no filtro",
      "Clique numa unidade para detalhar",
      renderTable(
        ["Unidade", "Pedidos", "Dias", "Méd/sem", "Atendido", "Solicitado", "Taxa", "Itens"],
        rows
      )
    );
  }

  if (m.topCats.length) {
    const rows = m.topCats.slice(0, 12).map(
      (c) =>
        `<tr><td style="font-weight:600">${_deps.esc(c.cat)}</td>` +
        `<td>${c.ate.toLocaleString("pt-BR")}</td>` +
        `<td>${c.sol > 0 ? c.sol.toLocaleString("pt-BR") : "—"}</td>` +
        `<td>${c.lines}</td></tr>`
    );
    h += panSection(
      "Consumo por categoria",
      "Inclui Material de Expediente e demais",
      renderTable(["Categoria", "Atendido", "Solicitado", "Linhas"], rows)
    );
  }

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

function buildItensHtml(m, filteredRows = [], filters = {}) {
  let h = `<h2 style="font-size:16px;font-weight:800;margin:0 0 4px">Itens consumidos</h2>`;

  if (filters.unit) {
    h += `<p style="font-size:12px;color:#64748b;margin:0 0 12px">Tudo o que <b>${_deps.esc(filters.unit)}</b> pediu, dia a dia, e o total do período no final.</p>`;
    h += buildPedidosPorDiaHtml(filteredRows, filters.unit);
  } else {
    h += `<p style="font-size:12px;color:#64748b;margin:0 0 12px">Ranking do que mais saiu do almoxarifado no período.</p>`;
    h +=
      `<div class="alert-card alert-blue" style="margin-bottom:12px"><div class="alert-icon"></div>` +
      `<div class="alert-body">Escolha o <b>tipo de unidade</b> e a <b>unidade</b> nos filtros para ver os itens pedidos <b>dia a dia</b>.</div></div>`;
  }

  const top = m.topMaterials.slice(0, 40).map(
    (it, i) =>
      `<tr><td style="color:#94a3b8">${i + 1}</td>` +
      `<td style="font-weight:700">${_deps.esc(it.material)}</td>` +
      `<td style="font-size:11px;color:#64748b">${_deps.esc(it.cat)}</td>` +
      `<td>${it.ate.toLocaleString("pt-BR")}</td>` +
      `<td>${it.full ? it.sol.toLocaleString("pt-BR") : "—"}</td>` +
      `<td>${it.full && it.taxa != null ? it.taxa + "%" : "—"}</td>` +
      `<td>${it.nUnits}</td></tr>`
  );
  h += panSection(
    filters.unit ? "Total do período por item" : "Top materiais",
    "Quantidade física atendida · “—” = só entrega antiga sem solicitado",
    renderTable(["#", "Material", "Categoria", "Atendido", "Solicitado", "Taxa", "Unids."], top, "Nenhum item no filtro.")
  );

  if (m.topExpediente.length) {
    const exp = m.topExpediente.slice(0, 25).map(
      (it, i) =>
        `<tr><td>${i + 1}</td><td style="font-weight:700">${_deps.esc(it.material)}</td>` +
        `<td>${it.ate.toLocaleString("pt-BR")}</td>` +
        `<td>${it.sol > 0 ? it.sol.toLocaleString("pt-BR") : "—"}</td>` +
        `<td>${it.lines}</td></tr>`
    );
    h += panSection(
      "Material de Expediente — mais consumidos",
      "Filtrado por categoria/tipo Expediente",
      renderTable(["#", "Material", "Atendido", "Solicitado", "Linhas"], exp)
    );
  }

  return h;
}

function buildAtendimentoHtml(m, filteredRows) {
  let h = coverageBanner(m);
  h += `<h2 style="font-size:16px;font-weight:800;margin:0 0 4px">Atendimento</h2>`;
  h += `<p style="font-size:12px;color:#64748b;margin:0 0 12px">Atendidos, parciais, não atendidos e sem estoque (linhas completas).</p>`;

  h +=
    `<div class="pan-grid">` +
    kpi(m.byStatus.atendido || 0, "Atendidos", "linhas", "", "#059669") +
    kpi(m.byStatus.parcial || 0, "Parciais", "linhas", "", "#d97706") +
    kpi(m.byStatus.nao_atendido || 0, "Não atendidos", "linhas", "", "#7c3aed") +
    kpi(m.byStatus.sem_estoque || 0, "Sem estoque", "linhas", "", "#dc2626") +
    kpi(m.byStatus.excedido || 0, "Excedidos", "linhas", "", "#b45309") +
    kpi(m.byStatus.entrega_registrada || 0, "Só entrega", "históricos antigos", "", "#64748b") +
    kpi(m.falt > 0 ? m.falt.toLocaleString("pt-BR") : "—", "Faltante (qtd)", "solicitado − atendido", "", "#ef4444") +
    kpi(m.taxa != null ? m.taxa + "%" : "—", "Taxa geral", "", "", "#16a34a") +
    `</div>`;

  const detailStatuses = new Set(["nao_atendido", "parcial", "sem_estoque", "excedido"]);
  const problemRows = filteredRows
    .filter((r) => r.coverage === "full" && detailStatuses.has(r.itemStatus))
    .sort((a, b) => (b.faltante || 0) - (a.faltante || 0))
    .slice(0, 80);

  const body = problemRows.map(
    (r) =>
      `<tr>` +
      `<td style="font-weight:600">${_deps.esc(r.unitName)}</td>` +
      `<td style="font-size:11px">${_deps.esc(r.dateIso || "—")}</td>` +
      `<td>${_deps.esc(r.material)}</td>` +
      `<td style="font-size:11px;color:#64748b">${_deps.esc(r.cat)}</td>` +
      `<td>${r.qtdSolicitada ?? "—"}</td>` +
      `<td>${r.qtdAtendida ?? "—"}</td>` +
      `<td>${r.faltante ?? "—"}</td>` +
      `<td><span class="badge-status badge-${_deps.esc(r.itemStatus)}">${_deps.esc(r.itemStatus)}</span></td>` +
      `</tr>`
  );

  h += panSection(
    "Itens com gap de atendimento",
    "Somente linhas com solicitado/atendido conhecidos",
    renderTable(
      ["Unidade", "Data", "Material", "Cat.", "Sol.", "Ate.", "Falta", "Status"],
      body,
      "Nenhum gap no filtro (ou só há entregas antigas sem solicitado)."
    )
  );

  return h;
}

function buildFrequenciaHtml(m, filteredRows) {
  let h = `<h2 style="font-size:16px;font-weight:800;margin:0 0 4px">Frequência de pedidos</h2>`;
  h += `<p style="font-size:12px;color:#64748b;margin:0 0 12px">Em quais dias e com que regularidade as unidades pedem.</p>`;

  const maxWd = Math.max(...m.byWeekday, 1);
  const wdBars = m.byWeekday
    .map((n, i) => {
      const pct = Math.round((n / maxWd) * 100);
      return (
        `<div style="flex:1;text-align:center">` +
        `<div style="height:90px;display:flex;align-items:flex-end;justify-content:center">` +
        `<div style="width:70%;height:${Math.max(4, pct)}%;background:#2563eb;border-radius:6px 6px 0 0" title="${n} linhas"></div>` +
        `</div>` +
        `<div style="font-size:11px;font-weight:700;margin-top:4px">${DAY_NAMES[i]}</div>` +
        `<div style="font-size:10px;color:#64748b">${n}</div></div>`
      );
    })
    .join("");

  h += panSection(
    "Distribuição por dia da semana",
    "Contagem de linhas de item por dia do pedido",
    `<div style="display:flex;gap:6px;align-items:flex-end;background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:12px">${wdBars}</div>`
  );

  if (m.monthSeries.length) {
    const rows = m.monthSeries.map(
      (x) =>
        `<tr><td style="font-weight:600">${_deps.esc(x.month)}</td><td>${x.qty.toLocaleString("pt-BR")}</td></tr>`
    );
    h += panSection(
      "Volume mensal (qtd. atendida)",
      "Série do período filtrado",
      renderTable(["Mês", "Qtd. atendida"], rows)
    );
  }

  const freqUnits = m.unitStats.slice(0, 30).map((u) => {
    return (
      `<tr>` +
      `<td style="font-weight:700">${_deps.esc(u.unit)}</td>` +
      `<td>${u.nPedidos}</td>` +
      `<td>${u.nDays}</td>` +
      `<td>${u.avgPedidosSemana}</td>` +
      `<td>${u.nDays && u.nPedidos ? (Math.round((u.nPedidos / Math.max(u.nDays, 1)) * 100) / 100) : "—"}</td>` +
      `</tr>`
    );
  });

  h += panSection(
    "Frequência por unidade",
    "Pedidos, dias ativos e média semanal no período",
    renderTable(["Unidade", "Pedidos", "Dias", "Méd/semana", "Pedidos/dia ativo"], freqUnits)
  );

  // Pedidos distintos por unidade/semana (amostra)
  const weekMap = new Map();
  for (const r of filteredRows) {
    const key = (r.weekStart || r.dateIso || "") + "\0" + r.unitName;
    if (!weekMap.has(key)) weekMap.set(key, { week: r.weekStart || r.dateIso, unit: r.unitName, lines: 0, ate: 0 });
    const e = weekMap.get(key);
    e.lines += 1;
    e.ate += r.qtdAtendida || 0;
  }
  const weekRows = [...weekMap.values()]
    .sort((a, b) => String(b.week).localeCompare(String(a.week)))
    .slice(0, 40)
    .map(
      (w) =>
        `<tr><td>${_deps.esc(w.week || "—")}</td><td style="font-weight:600">${_deps.esc(w.unit)}</td>` +
        `<td>${w.lines}</td><td>${w.ate.toLocaleString("pt-BR")}</td></tr>`
    );
  h += panSection(
    "Últimos envios por semana/unidade",
    "Amostra recente do filtro",
    renderTable(["Semana", "Unidade", "Linhas", "Qtd."], weekRows)
  );

  return h;
}

function buildDetailTable(filteredRows) {
  const q = normKey(document.getElementById("panDetailSearch")?.value || "");
  let rows = filteredRows;
  if (q) {
    rows = rows.filter(
      (r) =>
        normKey(r.unitName).includes(q) ||
        normKey(r.material).includes(q) ||
        normKey(r.cat).includes(q) ||
        normKey(r.itemStatus).includes(q)
    );
  }
  rows = rows
    .slice()
    .sort((a, b) => String(b.dateIso || "").localeCompare(String(a.dateIso || "")))
    .slice(0, 200);

  const body = rows.map(
    (r) =>
      `<tr>` +
      `<td style="font-weight:600">${_deps.esc(r.unitName)}</td>` +
      `<td style="font-size:11px">${_deps.esc(r.dateIso || "—")}</td>` +
      `<td style="font-size:11px;color:#64748b">${_deps.esc(r.cat)}</td>` +
      `<td>${_deps.esc(r.material)}</td>` +
      `<td>${r.qtdSolicitada != null ? r.qtdSolicitada : "—"}</td>` +
      `<td>${r.qtdAtendida != null ? r.qtdAtendida : "—"}</td>` +
      `<td>${r.faltante != null ? r.faltante : "—"}</td>` +
      `<td style="font-size:11px">${_deps.esc(r.itemStatus)}</td>` +
      `<td style="font-size:10px;color:#64748b">${_deps.esc(r.coverageLabel)}</td>` +
      `</tr>`
  );

  return panSection(
    "Tabela detalhada",
    "Até 200 linhas · use a busca abaixo · exportação CSV usa o filtro completo",
    `<div style="margin-bottom:8px"><input class="input" id="panDetailSearch" placeholder="Buscar na tabela..." style="font-size:12px;padding:6px 10px;max-width:320px" oninput="buildPainel()"></div>` +
      renderTable(
        ["Unidade", "Data", "Categoria", "Material", "Sol.", "Ate.", "Falta", "Status", "Cobertura"],
        body,
        "Nenhuma linha no filtro."
      )
  );
}

function populateFilterOptions(allRows) {
  const units = [...new Set(allRows.map((r) => r.unitName).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "pt-BR")
  );
  const cats = [...new Set(allRows.map((r) => r.cat).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "pt-BR")
  );

  const unitSel = document.getElementById("panUnitSel");
  if (unitSel) {
    const prev = _state.filters.unit || unitSel.value || "";
    const tipo = _state.filters.tipo;
    const filteredUnits = tipo
      ? units.filter((u) => _deps.classifyUnit(u)?.id === tipo)
      : units;
    unitSel.innerHTML =
      `<option value="">— Todas` +
      (tipo ? ` do tipo` : "") +
      ` —</option>` +
      filteredUnits.map((u) => `<option value="${_deps.esc(u)}">${_deps.esc(u)}</option>`).join("");
    if (prev && [...unitSel.options].some((o) => o.value === prev)) unitSel.value = prev;
    else unitSel.value = "";
  }

  const catSel = document.getElementById("panCatSel");
  if (catSel) {
    const prev = _state.filters.cat || catSel.value || "";
    catSel.innerHTML =
      `<option value="">— Todas —</option>` +
      cats.map((c) => `<option value="${_deps.esc(c)}">${_deps.esc(c)}</option>`).join("");
    if (prev && [...catSel.options].some((o) => o.value === prev)) catSel.value = prev;
  }

  const typeCounts = {};
  units.forEach((u) => {
    const t = _deps.classifyUnit(u);
    typeCounts[t.id] = (typeCounts[t.id] || 0) + 1;
  });

  const tipoSel = document.getElementById("panTipoSel");
  if (tipoSel) {
    tipoSel.innerHTML =
      `<option value="">— Todos —</option>` +
      (_deps.UNIT_TYPES || [])
        .filter((t) => typeCounts[t.id])
        .map((t) => `<option value="${_deps.esc(t.id)}">${_deps.esc(t.label)} (${typeCounts[t.id]})</option>`)
        .join("");
    tipoSel.value = _state.filters.tipo || "";
  }

  // Chips de tipo
  const chipsEl = document.getElementById("panTipoChips");
  if (chipsEl) {
    chipsEl.innerHTML =
      `<span class="tipo-chip${!_state.filters.tipo ? " active" : ""}" onclick="clearPanFilters()">Geral</span>` +
      (_deps.UNIT_TYPES || [])
        .filter((t) => typeCounts[t.id])
        .map(
          (t) =>
            `<span class="tipo-chip${_state.filters.tipo === t.id ? " active" : ""}" onclick="setPanTipo('${t.id}')" style="${
              _state.filters.tipo === t.id ? "background:" + t.color + ";border-color:" + t.color : ""
            }">${t.icon} ${t.label} <span class="cnt">(${typeCounts[t.id] || 0})</span></span>`
        )
        .join("");
  }

  const filtersEl = document.getElementById("panFilters");
  if (filtersEl) filtersEl.style.display = "block";
}

function ensureDefaultDates() {
  const elFrom = document.getElementById("panDateFrom");
  const elTo = document.getElementById("panDateTo");
  if (elFrom && !elFrom.value) {
    const d = defaultDateRange();
    elFrom.value = d.from;
    if (elTo && !elTo.value) elTo.value = d.to;
  }
}

async function ensureDataLoaded(force = false) {
  if (_state.loaded && !force && _state.rows.length) return _state.rows;
  _state.loading = true;
  try {
    const [mats, hist] = await Promise.all([
      fetchAllMateriaisForReport({ force }),
      fetchAllHistForReport({ force }),
    ]);
    _state.rows = buildAnalyticRows(mats, hist);
    _state.loaded = true;
    return _state.rows;
  } finally {
    _state.loading = false;
  }
}

function renderSubTabsActive() {
  document.querySelectorAll(".pan-sub-tab").forEach((btn) => {
    const active = btn.getAttribute("data-pansub") === _state.sub;
    btn.style.background = active ? "#2563eb" : "transparent";
    btn.style.color = active ? "#fff" : "#64748b";
  });
}

export async function buildPainelRelatorio(opts = {}) {
  const el = document.getElementById("panContent");
  if (!el) return;

  ensureDefaultDates();
  if (opts.preset) setDatePreset(opts.preset);

  el.innerHTML =
    `<div style="text-align:center;padding:40px;color:#64748b">` +
    `<div style="font-size:24px;margin-bottom:8px"></div>Carregando dados completos para o relatório...</div>`;

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
    populateFilterOptions(allRows);
    const filters = readFiltersFromDom();
    const filtered = filterAnalyticRows(allRows, filters);
    const metrics = computeMetrics(filtered);
    _state.lastExportRows = filtered;

    renderSubTabsActive();

    let html = "";
    if (_state.sub === "itens") html = buildItensHtml(metrics, filtered, filters);
    else if (_state.sub === "atendimento") html = buildAtendimentoHtml(metrics, filtered);
    else if (_state.sub === "frequencia") html = buildFrequenciaHtml(metrics, filtered);
    else html = buildGeralHtml(metrics, filters);

    html += buildDetailTable(filtered);

    html +=
      `<div style="display:flex;gap:8px;flex-wrap:wrap;margin:16px 0 8px">` +
      `<button class="btn btn-p btn-sm" type="button" onclick="exportarPainelCSV()" style="display:inline-flex;align-items:center;gap:4px">⬇ Exportar CSV</button>` +
      `<button class="btn btn-s btn-sm" type="button" onclick="imprimirPainelRelatorio()" style="display:inline-flex;align-items:center;gap:4px">Imprimir / PDF</button>` +
      `<button class="btn btn-s btn-sm" type="button" onclick="buildPainel({force:true})" style="display:inline-flex;align-items:center;gap:4px">↻ Atualizar dados</button>` +
      `</div>`;

    if (!filtered.length) {
      html =
        coverageBanner(metrics) +
        `<div style="text-align:center;padding:48px 20px;color:#64748b">` +
        `<b style="font-size:15px;color:#0f172a">Nenhum dado no filtro</b>` +
        `<br><span style="font-size:13px">Ajuste período, unidade, tipo ou categoria.</span></div>` +
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
  const allowed = new Set(["geral", "itens", "atendimento", "frequencia"]);
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
  const ids = ["panDateFrom", "panDateTo", "panTipoSel", "panUnitSel", "panCatSel", "panItemQ", "panCoverage"];
  ids.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (el.tagName === "SELECT" || el.tagName === "INPUT") el.value = "";
  });
  ensureDefaultDates();
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
