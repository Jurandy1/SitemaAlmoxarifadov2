import {
  getDocs,
  onSnapshot,
  query,
  doc,
  writeBatch,
  serverTimestamp,
} from "firebase/firestore";
import { COLLECTIONS, db } from "../services/firestore-service.js";
import { DOM_ELEMENTS, showAlert } from "../utils/dom-helpers.js";
import { getUserRole } from "../utils/cache.js";

let __unsubscribeFeriados = null;
let __feriadosList = [];
let __feriadosSetCache = null;
let __feriadosLoadedAt = 0;
let __autoSeed2026Attempted = false;

const MONTHS_PT = {
  janeiro: 1,
  fevereiro: 2,
  marco: 3,
  março: 3,
  abril: 4,
  maio: 5,
  junho: 6,
  julho: 7,
  agosto: 8,
  setembro: 9,
  outubro: 10,
  novembro: 11,
  dezembro: 12,
};

const DEFAULT_2026 = [
  { date: "2026-01-01", weekday: "Quinta-feira", name: "Confraternização Universal", nature: "Feriado Nacional" },
  { date: "2026-02-16", weekday: "Segunda-feira", name: "Carnaval", nature: "Ponto Facultativo" },
  { date: "2026-02-17", weekday: "Terça-feira", name: "Carnaval", nature: "Ponto Facultativo" },
  { date: "2026-02-18", weekday: "Quarta-feira", name: "Quarta-feira de Cinzas", nature: "Ponto Facultativo" },
  { date: "2026-04-02", weekday: "Quinta-feira", name: "Quinta-feira Santa", nature: "Ponto Facultativo" },
  { date: "2026-04-03", weekday: "Sexta-feira", name: "Paixão de Cristo / Sexta-feira Santa", nature: "Feriado Nacional" },
  { date: "2026-04-21", weekday: "Terça-feira", name: "Tiradentes", nature: "Feriado Nacional" },
  { date: "2026-05-01", weekday: "Sexta-feira", name: "Dia do Trabalho", nature: "Feriado Nacional" },
  { date: "2026-06-04", weekday: "Quinta-feira", name: "Corpus Christi", nature: "Ponto Facultativo" },
  { date: "2026-06-29", weekday: "Segunda-feira", name: "Dia de São Pedro", nature: "Feriado Municipal" },
  { date: "2026-06-30", weekday: "Terça-feira", name: "Dia de São Marçal", nature: "Ponto Facultativo" },
  { date: "2026-07-28", weekday: "Terça-feira", name: "Dia da Adesão do Maranhão à Independência do Brasil", nature: "Feriado Estadual" },
  { date: "2026-09-07", weekday: "Segunda-feira", name: "Independência do Brasil", nature: "Feriado Nacional" },
  { date: "2026-09-08", weekday: "Terça-feira", name: "Natividade de Nossa Senhora/Aniversário da Cidade", nature: "Feriado Municipal" },
  { date: "2026-10-12", weekday: "Segunda-feira", name: "Nossa Senhora Aparecida", nature: "Feriado Nacional" },
  { date: "2026-10-28", weekday: "Quarta-feira", name: "Dia do Servidor Público", nature: "Ponto Facultativo" },
  { date: "2026-11-02", weekday: "Segunda-feira", name: "Finados", nature: "Feriado Nacional" },
  { date: "2026-11-15", weekday: "Domingo", name: "Proclamação da República", nature: "Feriado Nacional" },
  { date: "2026-11-20", weekday: "Sexta-feira", name: "Dia da Consciência Negra", nature: "Feriado Nacional" },
  { date: "2026-12-08", weekday: "Terça-feira", name: "Dia de Nossa Senhora da Conceição", nature: "Feriado Municipal" },
  { date: "2026-12-25", weekday: "Sexta-feira", name: "Natal", nature: "Feriado Nacional" },
];

function toISODate(year, month, day) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function isISODate(str) {
  return typeof str === "string" && /^\d{4}-\d{2}-\d{2}$/.test(str);
}

function parseImportedText(text, year) {
  const y = Number(year);
  if (!Number.isFinite(y) || y < 1900) return [];
  const cleaned = String(text || "").replace(/\r/g, "\n");
  const blocks = cleaned.split("\n").map((l) => l.trim()).filter(Boolean);
  if (blocks.length === 0) return [];

  const out = [];
  const seen = new Set();

  const pushItem = (item) => {
    if (!item?.date || !isISODate(item.date)) return;
    if (seen.has(item.date)) return;
    seen.add(item.date);
    out.push(item);
  };

  const fullText = blocks.join("\n");
  const monthRegex = /(1º|\d{1,2})\s*de\s*(janeiro|fevereiro|março|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)/gi;
  const natureRegex = /(Feriado\s+(Nacional|Municipal|Estadual)|Ponto\s+Facultativo)/i;

  const matches = [];
  for (const m of fullText.matchAll(monthRegex)) {
    matches.push({ index: m.index || 0, dayRaw: m[1], monthRaw: m[2] });
  }

  if (matches.length > 0) {
    for (let i = 0; i < matches.length; i += 1) {
      const cur = matches[i];
      const nextIndex = i + 1 < matches.length ? matches[i + 1].index : fullText.length;
      const slice = fullText.slice(cur.index, nextIndex);
      const day = Number(String(cur.dayRaw).replace(/\D/g, ""));
      const month = MONTHS_PT[String(cur.monthRaw).toLowerCase()] || 0;
      if (!day || !month) continue;

      const date = toISODate(y, month, day);
      const natureMatch = slice.match(natureRegex);
      const nature = natureMatch ? natureMatch[0].replace(/\s+/g, " ").trim() : "Feriado";

      const lines = slice.split("\n").map((x) => x.trim()).filter(Boolean);
      const weekday = lines.find((l) => /(segunda|terça|quarta|quinta|sexta|sábado|domingo)/i.test(l)) || "";
      const nameCandidate = lines.find((l) => !monthRegex.test(l) && !/(segunda|terça|quarta|quinta|sexta|sábado|domingo)/i.test(l) && !natureRegex.test(l) && l.length > 3) || "";
      const name = nameCandidate.replace(/\s+/g, " ").trim() || "Feriado";

      pushItem({ date, weekday, name, nature });
    }
    return out;
  }

  const csvRegex = /^(\d{4}-\d{2}-\d{2}|\d{2}\/\d{2}\/\d{4}|\d{2}\/\d{2})\s*[;,\t]\s*(.+?)(?:\s*[;,\t]\s*(.+))?$/;
  for (const line of blocks) {
    const m = line.match(csvRegex);
    if (!m) continue;
    const rawDate = m[1];
    const name = (m[2] || "").trim();
    const nature = (m[3] || "Feriado").trim();

    let iso = "";
    if (/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
      iso = rawDate;
    } else if (/^\d{2}\/\d{2}\/\d{4}$/.test(rawDate)) {
      const [d, mo, yr] = rawDate.split("/").map(Number);
      iso = toISODate(yr, mo, d);
    } else if (/^\d{2}\/\d{2}$/.test(rawDate)) {
      const [d, mo] = rawDate.split("/").map(Number);
      iso = toISODate(y, mo, d);
    }

    if (!isISODate(iso)) continue;
    pushItem({ date: iso, weekday: "", name, nature });
  }

  return out;
}

async function upsertFeriados(items) {
  if (!Array.isArray(items) || items.length === 0) return { ok: true, count: 0 };
  const batch = writeBatch(db);
  items.forEach((item) => {
    const ref = doc(COLLECTIONS.feriados, item.date);
    batch.set(ref, { ...item, updatedAt: serverTimestamp() }, { merge: true });
  });
  await batch.commit();
  __feriadosSetCache = null;
  __feriadosLoadedAt = 0;
  return { ok: true, count: items.length };
}

function renderFeriadosTable(year) {
  if (!DOM_ELEMENTS.tableFeriados) return;
  const y = Number(year);
  const rows = __feriadosList
    .filter((f) => Number(String(f.date || "").slice(0, 4)) === y)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));

  if (rows.length === 0) {
    DOM_ELEMENTS.tableFeriados.innerHTML = `<tr><td colspan="4" class="text-center py-10 text-slate-500">Nenhum feriado cadastrado para ${y}.</td></tr>`;
    return;
  }

  DOM_ELEMENTS.tableFeriados.innerHTML = rows
    .map((f) => {
      const date = String(f.date || "");
      const name = String(f.name || "");
      const nature = String(f.nature || "");
      const weekday = String(f.weekday || "");
      return `
        <tr>
          <td class="whitespace-nowrap">${date}</td>
          <td class="whitespace-nowrap">${weekday}</td>
          <td>${name}</td>
          <td class="whitespace-nowrap">${nature}</td>
        </tr>
      `;
    })
    .join("");
}

function stopFeriadosListener() {
  if (typeof __unsubscribeFeriados === "function") {
    try { __unsubscribeFeriados(); } catch (_) {}
  }
  __unsubscribeFeriados = null;
}

function startFeriadosListener() {
  stopFeriadosListener();
  try {
    __unsubscribeFeriados = onSnapshot(
      query(COLLECTIONS.feriados),
      (snap) => {
        __feriadosList = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        __feriadosSetCache = null;
        __feriadosLoadedAt = Date.now();

        if (!__autoSeed2026Attempted && getUserRole() === "admin") {
          __autoSeed2026Attempted = true;
          const has2026 = __feriadosList.some((f) => String(f.date || f.id || "").startsWith("2026-"));
          if (!has2026) {
            upsertFeriados(DEFAULT_2026)
              .then((res) => {
                showAlert("alert-feriados", `Calendário 2026 cadastrado automaticamente (${res.count}).`, "success");
              })
              .catch((e) => {
                console.error("Falha auto-seed 2026:", e);
              });
          }
        }

        const year = DOM_ELEMENTS.feriadosAno?.value || new Date().getFullYear();
        renderFeriadosTable(year);
      },
      (err) => {
        console.error("Erro listener feriados:", err);
        showAlert("alert-feriados", "Erro ao carregar feriados.", "error");
      }
    );
  } catch (err) {
    console.error("Erro ao iniciar listener feriados:", err);
    showAlert("alert-feriados", "Erro ao iniciar feriados.", "error");
  }
}

async function getFeriadosISOSetCached() {
  const fresh = __feriadosSetCache && (Date.now() - __feriadosLoadedAt) < 5 * 60 * 1000;
  if (fresh) return __feriadosSetCache;
  try {
    const snap = await getDocs(query(COLLECTIONS.feriados));
    const set = new Set();
    snap.docs.forEach((d) => {
      const date = d.id || d.data()?.date;
      if (isISODate(date)) set.add(date);
    });
    if (set.size === 0) {
      DEFAULT_2026.forEach((f) => { if (isISODate(f.date)) set.add(f.date); });
    }
    __feriadosSetCache = set;
    __feriadosLoadedAt = Date.now();
    return set;
  } catch (err) {
    console.error("Erro ao buscar feriados:", err);
    const set = new Set();
    DEFAULT_2026.forEach((f) => { if (isISODate(f.date)) set.add(f.date); });
    return set;
  }
}

async function handleSeed2026() {
  if (getUserRole() !== "admin") {
    showAlert("alert-feriados", "Apenas administradores podem cadastrar feriados.", "error");
    return;
  }
  try {
    const y = 2026;
    const existing = __feriadosList.some((f) => String(f.date || "").startsWith(`${y}-`));
    if (existing) {
      showAlert("alert-feriados", "Calendário 2026 já está cadastrado.", "info");
      return;
    }
    const res = await upsertFeriados(DEFAULT_2026);
    showAlert("alert-feriados", `Calendário 2026 cadastrado (${res.count}).`, "success");
  } catch (err) {
    console.error(err);
    showAlert("alert-feriados", "Falha ao cadastrar calendário 2026.", "error");
  }
}

async function handleImport(e) {
  e?.preventDefault?.();
  if (getUserRole() !== "admin") {
    showAlert("alert-feriados", "Apenas administradores podem importar feriados.", "error");
    return;
  }
  const year = Number(DOM_ELEMENTS.feriadosAno?.value || new Date().getFullYear());
  const text = DOM_ELEMENTS.feriadosImportText?.value || "";
  const items = parseImportedText(text, year);
  if (items.length === 0) {
    showAlert("alert-feriados", "Nenhum feriado válido encontrado no texto.", "warning");
    return;
  }
  try {
    const res = await upsertFeriados(items);
    showAlert("alert-feriados", `Importação concluída (${res.count}).`, "success");
  } catch (err) {
    console.error(err);
    showAlert("alert-feriados", "Falha ao importar feriados.", "error");
  }
}

function handleYearChange() {
  const year = DOM_ELEMENTS.feriadosAno?.value || new Date().getFullYear();
  renderFeriadosTable(year);
}

function initFeriadosListeners() {
  if (!DOM_ELEMENTS.contentFeriados) return;

  if (DOM_ELEMENTS.feriadosAno) {
    const currentYear = new Date().getFullYear();
    const years = [2026, 2027, 2028, 2029, 2030];
    if (!years.includes(currentYear)) years.unshift(currentYear);
    DOM_ELEMENTS.feriadosAno.innerHTML = years
      .sort((a, b) => a - b)
      .map((y) => `<option value="${y}">${y}</option>`)
      .join("");
    DOM_ELEMENTS.feriadosAno.value = String(2026);
    DOM_ELEMENTS.feriadosAno.addEventListener("change", handleYearChange);
  }

  if (DOM_ELEMENTS.btnFeriadosSeed2026) DOM_ELEMENTS.btnFeriadosSeed2026.addEventListener("click", handleSeed2026);
  if (DOM_ELEMENTS.formFeriadosImport) DOM_ELEMENTS.formFeriadosImport.addEventListener("submit", handleImport);

  const navBtn = document.querySelector('.nav-btn[data-tab="feriados"]');
  if (navBtn) {
    navBtn.addEventListener("click", () => {
      if (!__unsubscribeFeriados) startFeriadosListener();
    });
  }

  const year = DOM_ELEMENTS.feriadosAno?.value || 2026;
  renderFeriadosTable(year);
}

export { initFeriadosListeners, getFeriadosISOSetCached };
