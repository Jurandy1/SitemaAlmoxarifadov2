import { setDoc, deleteDoc, doc, writeBatch, getDocs, query, orderBy, limit, startAfter, serverTimestamp, Timestamp, documentId } from "firebase/firestore";
import { auth, COLLECTIONS } from "../services/firestore-service.js";
import { getMateriais, getUnidades, getUserRole, getSemcasHistDB, getSemcasAliases } from "../utils/cache.js";
import { showAlert } from "../utils/dom-helpers.js";
import { isReady } from "./auth.js";
import { getFeriadosISOSetCached } from "./feriados.js";

let __stylesInjected = false;

function prefixCss(cssText, scope) {
  const SPECIAL = new Set([":root", "body", "html"]);
  const isAt = (s) => s.startsWith("@");
  const splitSelectors = (sel) => {
    const out = [];
    let cur = "";
    let depth = 0;
    for (let i = 0; i < sel.length; i++) {
      const ch = sel[i];
      if (ch === "(") depth++;
      if (ch === ")") depth = Math.max(0, depth - 1);
      if (ch === "," && depth === 0) {
        out.push(cur.trim());
        cur = "";
        continue;
      }
      cur += ch;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  };
  const prefixSelector = (sel) => {
    if (!sel) return sel;
    if (SPECIAL.has(sel)) return scope;
    if (sel.startsWith(scope)) return sel;
    if (sel.startsWith("@")) return sel;
    if (sel.startsWith("from") || sel.startsWith("to") || /^[0-9.]+%$/.test(sel)) return sel;
    return scope + " " + sel;
  };
  const walk = (text) => {
    let i = 0;
    let out = "";
    while (i < text.length) {
      const open = text.indexOf("{", i);
      if (open === -1) {
        out += text.slice(i);
        break;
      }
      const selector = text.slice(i, open).trim();
      let depth = 1;
      let j = open + 1;
      while (j < text.length && depth > 0) {
        const ch = text[j];
        if (ch === "{") depth++;
        else if (ch === "}") depth--;
        j++;
      }
      const block = text.slice(open + 1, j - 1);
      if (isAt(selector)) {
        if (selector.startsWith("@media") || selector.startsWith("@supports")) {
          out += selector + "{" + walk(block) + "}";
        } else {
          out += selector + "{" + block + "}";
        }
      } else {
        const sels = splitSelectors(selector).map(prefixSelector).join(",");
        out += sels + "{" + block + "}";
      }
      i = j;
    }
    return out;
  };
  return walk(cssText);
}

function ensureSeparacaoStyles() {
  if (__stylesInjected) return;

  // ── FIX 1: Extract @import (font) and load via <link> instead ──
  // @import inside dynamically injected <style> is unreliable.
  if (!document.querySelector('link[data-separacao-font]')) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,700;9..40,800&display=swap";
    link.setAttribute("data-separacao-font", "1");
    document.head.appendChild(link);
  }

  // ── FIX 2: Strip @import from CSS_RAW before prefixing ──
  // The @import + global * reset would leak outside .separacao-module
  let rawCss = CSS_RAW.replace(/@import\s+url\([^)]*\)\s*;?\s*/g, "");

  // ── FIX 3: Replace global * reset with scoped version ──
  // The `*,*::before,*::after{box-sizing:...;margin:0;padding:0}` leaks globally
  rawCss = rawCss.replace(
    /\*\s*,\s*\*::before\s*,\s*\*::after\s*\{[^}]*\}/,
    "" // Remove it; we add a scoped version below
  );

  const css = prefixCss(rawCss, ".separacao-module");

  const extra = `
/* ── Scoped reset (prevents leak to main system) ── */
.separacao-module, .separacao-module *,
.separacao-module *::before, .separacao-module *::after {
  box-sizing: border-box;
}

/* ── FIX 4: Hide redundant inner topbar (main system already has one) ── */
.separacao-module > .topbar {
  display: none !important;
}

/* ── Layout fixes for inside the main system shell ── */
.separacao-module {
  font-family: 'DM Sans', system-ui, -apple-system, sans-serif;
  color: var(--text, #0f172a);
  min-height: 0;
}
.separacao-module .view {
  max-width: 100%;
  padding: 16px 0;
}
.separacao-module .view.active {
  display: block;
}

/* ── Responsive: Row grid ── */
.separacao-module .row {
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
}
.separacao-module .row > div { min-width: 0; }
.separacao-module .sel,
.separacao-module .input { max-width: 100%; min-width: 0; }
.separacao-module #detectInfo { overflow-wrap: anywhere; word-break: break-word; }

/* ── Tabs: scrollable on mobile ── */
.separacao-module .tabs {
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
  border-radius: 10px;
  overflow-x: auto;
  gap: 0;
}
.separacao-module .tabs::-webkit-scrollbar { display: none; }

/* ── Cards and inputs inherit main system radius ── */
.separacao-module .card {
  border-radius: 12px;
}

/* ── Tables: horizontal scroll wrapper ── */
.separacao-module .tbl-wrap {
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  margin: 0 -4px;
  padding: 0 4px;
}

/* ── Mobile-first responsive ── */
@media (max-width: 900px) {
  .separacao-module .row { grid-template-columns: 1fr !important; }
  .separacao-module .rel-layout { grid-template-columns: 1fr !important; }
  .separacao-module .two-col { grid-template-columns: 1fr !important; }
  .separacao-module .filter-grid { grid-template-columns: 1fr !important; }
}

@media (max-width: 640px) {
  .separacao-module .tabs { gap: 0; }
  .separacao-module .tab {
    padding: 10px 10px;
    font-size: 11px;
    min-width: 0;
    flex-shrink: 0;
  }
  .separacao-module .card { padding: 12px; }
  .separacao-module .view { padding: 10px 0; }
  .separacao-module .qt th,
  .separacao-module .qt td { padding: 6px 5px; font-size: 11px; }
  .separacao-module .btn { padding: 8px 14px; font-size: 12px; }
  .separacao-module .ficha-a4 { padding: 14px; font-size: 11px; }
  .separacao-module .ficha-table th,
  .separacao-module .ficha-table td { padding: 3px 3px; font-size: 9px; }
  .separacao-module .ficha-sigs { grid-template-columns: 1fr; gap: 10px; }
  .separacao-module .modal-toolbar { flex-direction: column; gap: 6px; }
  .separacao-module .pan-grid { grid-template-columns: repeat(2, 1fr); }
  .separacao-module .kpi-val { font-size: 20px; }
  .separacao-module .kpi { padding: 10px; }
  .separacao-module .comp-grid { grid-template-columns: 1fr; }
  .separacao-module .unif-grid { grid-template-columns: 1fr; }
  .separacao-module .gap-tl-block { max-width: none; min-width: 0; width: 100%; }
  .separacao-module .db-stats { flex-direction: column; }
  .separacao-module .db-stat { min-width: 0; }
  .separacao-module .file-item { flex-direction: column; align-items: stretch; width: 100%; }
  .separacao-module .file-actions { justify-content: flex-end; }
  .separacao-module .rel-table th,
  .separacao-module .rel-table td { padding: 5px 4px; font-size: 10px; }
  .separacao-module .ficha-info-bar { flex-direction: column; gap: 6px; }
}

/* ── Modals must break out of the module scope ── */
.modal-ficha, .editor-modal, .mo {
  font-family: 'DM Sans', system-ui, -apple-system, sans-serif;
}

/* ── Print: inherit module styles ── */
@media print {
  .separacao-module .tabs,
  .separacao-module .topbar { display: none !important; }
}
`;
  const el = document.createElement("style");
  el.setAttribute("data-separacao", "1");
  el.textContent = css + extra;
  document.head.appendChild(el);
  __stylesInjected = true;
}

const DataStore = {
  async get(key) {
    if (key === "hist_v4") return getSemcasHistDB() || [];
    if (key === "aliases") return getSemcasAliases() || {};
    if (key === "reqs") {
      const mats = (getMateriais() || []).filter((m) => {
        if (m?.deleted) return false;
        if (m?._version === 2) return true;
        if (m?.origemFluxo === "v2") return true;
        if (m?.itemsMap && typeof m.itemsMap === "object") return true;
        return false;
      });
      return mats.map((m) => {
        const st = String(m.status || "").toLowerCase();
        const status = st === "separacao" ? "separando" : st === "retirada" ? "pronto" : st;
        return {
          id: m.id,
          v2Id: m.v2Id || null,
          unidade: m.unidade || m.unidadeNome || "Unidade",
          tipos: m.tipos || m.tiposMaterial || (m.tipoMaterial ? [m.tipoMaterial] : ["Outros"]),
          formato: m.formato || "padrao",
          resp: m.resp || m.lancadoPor || m.responsavelLancamento || "",
          obs: m.obs || m.itens || "",
          dt: (m.dataRequisicao || m.registradoEm || null)?.toDate
            ? (m.dataRequisicao || m.registradoEm).toDate().toISOString()
            : null,
          fileName: m.fileName || "",
          periodLabel: m.periodLabel || m.periodoLabel || "",
          periodStart: m.periodStart || m.periodoStart || "",
          periodEnd: m.periodEnd || m.periodoEnd || "",
          parsed: m.parsedData || m.parsed || null,
          items: m.itemsMap || m.items || {},
          status,
          separador: m.separador || m.responsavelSeparador || null,
          entreguePor: m.entreguePor || m.responsavelEntregaAlmox || null,
          retiradoPor: m.retiradoPor || m.responsavelRecebimento || null,
          dtEntrega: (m.dataEntrega || null)?.toDate ? m.dataEntrega.toDate().toISOString() : null,
          histEntryId: m.histEntryId || null,
          dbAdded: !!m.dbAdded
        };
      });
    }
    return null;
  },

  async set(key, value) {
    if (!isReady()) throw new Error("Não autenticado");
    if (key === "aliases") {
      await setDoc(doc(COLLECTIONS.semcasAliases, "config"), {
        aliases: value || {},
        updatedAt: serverTimestamp(),
        updatedBy: auth.currentUser?.email || "Sistema"
      });
      return;
    }
    if (key === "hist_v4") {
      const entries = Array.isArray(value) ? value : [];
      try { console.info("[FM] saveHist bulk:", entries.length, "entries"); } catch (_) {}
      const db = COLLECTIONS.semcasHistDB.firestore;
      for (let i = 0; i < entries.length; i += 450) {
        const b = writeBatch(db);
        entries.slice(i, i + 450).forEach((e) => {
          const id = String(e?.id || "");
          if (!id) return;
          b.set(
            doc(COLLECTIONS.semcasHistDB, id),
            { ...e, id, updatedAt: serverTimestamp(), updatedBy: auth.currentUser?.email || "Sistema" },
            { merge: true }
          );
        });
        await b.commit();
      }
      return;
    }
    if (key === "reqs") {
      const reqs = Array.isArray(value) ? value : [];
      try { console.info("[FM] save reqs:", reqs.length); } catch (_) {}
      for (const r of reqs) {
        const id = String(r?.id ?? "");
        if (!id) continue;
        const internalStatus = String(r.status || "").toLowerCase();
        const status =
          internalStatus === "separando"
            ? "separacao"
            : internalStatus === "pronto"
              ? "retirada"
              : internalStatus;
        const unidadeNome = r.unidade || "Unidade";
        const unidades = getUnidades() || [];
        const u = unidades.find(
          (x) =>
            String(x.nome || x.unidadeNome || "").toLowerCase() === String(unidadeNome).toLowerCase()
        );
        const unidadeId = u?.id || r.unidadeId || "";
        const tipoUnidade = u?.tipo || u?.tipoUnidade || r.tipoUnidade || "";
        const tiposMaterial = Array.isArray(r.tipos) ? r.tipos : [];
        const tipoMaterial = String(tiposMaterial[0] || "outros").toLowerCase();
        const dataRequisicao = r.dt ? Timestamp.fromDate(new Date(r.dt)) : serverTimestamp();
        const dataEntrega = r.dtEntrega ? Timestamp.fromDate(new Date(r.dtEntrega)) : null;
        const parsedData = deepCleanForFirestore(stripVolatileParsed(r.parsed));
        const itemsMap = deepCleanForFirestore(r.items || {});
        const docData = omitUndefinedShallow({
          _version: 2,
          origemFluxo: "v2",
          v2Id: r.id,
          unidadeId,
          unidadeNome,
          tipoUnidade,
          tipoMaterial,
          tiposMaterial,
          formato: r.formato || "padrao",
          fileName: r.fileName || "",
          periodLabel: r.periodLabel || "",
          periodStart: r.periodStart || "",
          periodEnd: r.periodEnd || "",
          parsedData: parsedData || null,
          itemsMap: itemsMap || {},
          itens: r.obs || "",
          status,
          responsavelLancamento: r.resp || "",
          responsavelSeparador: r.separador || null,
          responsavelEntregaAlmox: r.entreguePor || null,
          responsavelRecebimento: r.retiradoPor || null,
          dataRequisicao,
          dataEntrega,
          histEntryId: r.histEntryId || null,
          dbAdded: !!r.dbAdded,
          registradoEm: serverTimestamp()
        });
        try { console.info("[FM] saveReq doc:", id, "status:", status, "histEntryId:", docData.histEntryId||null); } catch (_) {}
        await setDoc(
          doc(COLLECTIONS.materiais, id),
          docData,
          { merge: true }
        );
        try { console.info("[FM] saveReq ok:", id); } catch (_) {}
      }
    }
  },

  async del(key) {
    if (!isReady()) throw new Error("Não autenticado");
    if (key === "hist_v4") {
      await deleteAllSemcasHistDB();
    }
  },

  async exportAll() {
    return {
      version: 2,
      exportedAt: new Date().toISOString(),
      hist_db: await this.get("hist_v4"),
      hist_aliases: await this.get("aliases"),
      reqs: await this.get("reqs")
    };
  },

  async importAll(data) {
    if (!data || !data.version) throw new Error("Arquivo de backup inválido");
    if (data.hist_db) await this.set("hist_v4", data.hist_db);
    if (data.hist_aliases && typeof data.hist_aliases === "object") await this.set("aliases", data.hist_aliases);
    if (Array.isArray(data.reqs)) await this.set("reqs", data.reqs);
  }
};

async function deleteAllSemcasHistDB(onProgress) {
  const db = COLLECTIONS.semcasHistDB.firestore;
  let last = null;
  let deleted = 0;
  while (true) {
    const q = last
      ? query(COLLECTIONS.semcasHistDB, orderBy(documentId()), startAfter(last), limit(450))
      : query(COLLECTIONS.semcasHistDB, orderBy(documentId()), limit(450));
    const snap = await getDocs(q);
    if (snap.empty) break;
    const b = writeBatch(db);
    snap.docs.forEach((d) => b.delete(d.ref));
    await b.commit();
    deleted += snap.docs.length;
    last = snap.docs[snap.docs.length - 1];
    if (typeof onProgress === "function") onProgress(deleted);
    if (snap.docs.length < 450) break;
  }
  return deleted;
}

async function deleteAllMateriaisDB(onProgress) {
  const db = COLLECTIONS.materiais.firestore;
  let last = null;
  let deleted = 0;
  while (true) {
    const q = last
      ? query(COLLECTIONS.materiais, orderBy(documentId()), startAfter(last), limit(450))
      : query(COLLECTIONS.materiais, orderBy(documentId()), limit(450));
    const snap = await getDocs(q);
    if (snap.empty) break;
    const b = writeBatch(db);
    snap.docs.forEach((d) => b.delete(d.ref));
    await b.commit();
    deleted += snap.docs.length;
    last = snap.docs[snap.docs.length - 1];
    if (typeof onProgress === "function") onProgress(deleted);
    if (snap.docs.length < 450) break;
  }
  return deleted;
}

const CSS_RAW = "@import url('https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,700;9..40,800&display=swap');\n*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}\n:root{--navy:#0f172a;--accent:#2563eb;--accent2:#1d4ed8;--green:#10b981;--red:#ef4444;--bg:#f1f5f9;--surface:#fff;--border:#e2e8f0;--muted:#64748b;--text:#0f172a}\nbody{font-family:'DM Sans',system-ui,sans-serif;background:var(--bg);color:var(--text);min-height:100vh}\n.topbar{background:var(--navy);color:#fff;padding:10px 20px;display:flex;align-items:center;gap:12px;font-size:13px;position:sticky;top:0;z-index:100;box-shadow:0 2px 12px rgba(0,0,0,.3)}\n.topbar b{font-size:14px}\n.tabs{display:flex;background:var(--surface);border-bottom:1px solid var(--border);overflow-x:auto}\n.tab{padding:12px 18px;font-size:12px;font-weight:700;color:var(--muted);border-bottom:3px solid transparent;white-space:nowrap;cursor:pointer;display:flex;align-items:center;gap:6px;transition:.2s}\n.tab:hover{color:var(--text);background:#f8fafc}\n.tab.active{color:var(--accent);border-bottom-color:var(--accent)}\n.bc{font-size:9px;font-weight:800;padding:1px 6px;border-radius:10px;min-width:18px;text-align:center}\n.bc.has{background:var(--red);color:#fff}.bc.zero{background:#cbd5e1;color:#64748b}\n.view{display:none;padding:20px;max-width:960px;margin:0 auto}.view.active{display:block}\n.card{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:20px;box-shadow:0 2px 8px rgba(0,0,0,.04);margin-bottom:16px}\n.card h2{font-size:17px;font-weight:800;margin-bottom:4px;letter-spacing:-.3px}\n.card .desc{font-size:13px;color:var(--muted);margin-bottom:14px}\nlabel.lbl{display:block;font-size:12px;font-weight:700;color:#475569;margin-bottom:4px}\n.input,.sel{width:100%;padding:9px 12px;border:1.5px solid var(--border);border-radius:8px;font-size:14px;font-family:inherit;outline:none;transition:.15s}\n.input:focus,.sel:focus{border-color:var(--accent);box-shadow:0 0 0 3px rgba(37,99,235,.1)}\n.sel{appearance:none;background:url(\"data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%2394a3b8' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e\") right 8px center/1.2em no-repeat var(--surface);padding-right:2.5em;cursor:pointer}\n.row{display:grid;grid-template-columns:1fr 1fr;gap:12px}\n.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:10px 20px;border:none;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;transition:.15s}\n.btn-p{background:linear-gradient(135deg,var(--accent),var(--accent2));color:#fff;box-shadow:0 4px 12px rgba(37,99,235,.3)}.btn-p:hover{transform:translateY(-1px)}\n.btn-s{background:#fff;color:var(--text);border:1.5px solid var(--border)}.btn-s:hover{background:#f8fafc}\n.btn-g{background:linear-gradient(135deg,#10b981,#059669);color:#fff;box-shadow:0 4px 12px rgba(16,185,129,.3)}.btn-g:hover{transform:translateY(-1px)}\n.btn-r{background:linear-gradient(135deg,#8b5cf6,#7c3aed);color:#fff;box-shadow:0 4px 12px rgba(139,92,246,.3)}.btn-r:hover{transform:translateY(-1px)}\n.btn-sm{padding:6px 14px;font-size:12px;border-radius:7px}\n.btn:disabled{opacity:.5;cursor:not-allowed;transform:none!important}\n.w-full{width:100%}.mb-3{margin-bottom:12px}\n.fd{border:2px dashed var(--border);border-radius:12px;padding:28px;text-align:center;cursor:pointer;transition:.2s;background:rgba(37,99,235,.02)}\n.fd:hover,.fd.over{border-color:var(--accent);background:rgba(37,99,235,.04)}\n.fn{font-size:12px;color:var(--green);font-weight:600;margin-top:6px}\n.qt{width:100%;border-collapse:collapse;font-size:13px}\n.qt th{background:#f8fafc;padding:10px 12px;text-align:left;font-size:10px;font-weight:700;text-transform:uppercase;color:var(--muted);letter-spacing:.5px;border-bottom:2px solid var(--border)}\n.qt td{padding:10px 12px;border-bottom:1px solid #f1f5f9;vertical-align:middle}\n.qt tr:hover td{background:#f8fafc}\n.pill{display:inline-block;padding:3px 10px;border-radius:20px;font-size:10px;font-weight:800;letter-spacing:.3px;text-transform:uppercase}\n.pr{background:#f3e8ff;color:#7c3aed;border:1px solid #ddd6fe}\n.empty{text-align:center;padding:40px 20px;color:var(--muted)}.empty .ic{font-size:36px;margin-bottom:8px}\n.first-row td{background:#eff6ff!important}\n/* A4 */\n.ficha-a4{background:#fff;padding:28px;box-shadow:0 4px 30px rgba(0,0,0,.1);border-radius:4px;min-height:400px;color:#0f172a;font-size:12px;max-width:794px;margin:0 auto}\n.ficha-header{border-bottom:3px solid #0f172a;padding-bottom:10px;margin-bottom:12px;display:flex;justify-content:space-between}\n.ficha-header h1{font-size:15px;font-weight:800;margin:0}.ficha-unit{font-size:12px;color:#475569;font-weight:600;margin-top:2px}\n.ficha-cat{background:#0f172a;color:#fff;padding:4px 10px;font-size:10px;font-weight:800;letter-spacing:.5px;text-transform:uppercase;border-radius:4px 4px 0 0;margin-top:10px}\n.ficha-table{width:100%;border-collapse:collapse;font-size:11px;margin-bottom:2px;table-layout:fixed}\n.ficha-table th{padding:4px 6px;font-size:9px;font-weight:800;color:#475569;text-align:center;border-bottom:2px solid #cbd5e1;text-transform:uppercase;background:#f1f5f9}\n.ficha-table th:nth-child(2){text-align:left}\n.ficha-table td{padding:4px 6px;border-bottom:1px solid #f1f5f9;vertical-align:middle;overflow:hidden;text-overflow:ellipsis}\n.col-num{width:4%;text-align:center}.col-mat{width:28%;text-align:left}.col-unid{width:7%;text-align:center}.col-sol{width:9%;text-align:center}.col-ate{width:14%;text-align:center}.col-status{width:10%;text-align:center}.col-obs{width:22%}\n.row-atendido{background:#f0fdf4}.row-parcial{background:#fffbeb}.row-sem_estoque{background:#fff1f2}.row-nao_atendido{background:#f5f3ff}\n.row-excedido{background:#fffbeb}\n.ficha-input-qty{width:100%;border:1px solid #e2e8f0;border-radius:3px;padding:3px 5px;font-family:inherit;outline:none;text-align:center;font-size:11px;font-weight:700;box-sizing:border-box}\n.ficha-input-qty.no-stock{color:#dc2626;background:#fee2e2}\n.ficha-input-obs{width:100%;border:1px solid #e2e8f0;border-radius:3px;padding:3px 5px;font-family:inherit;outline:none;font-size:10px;color:#475569;box-sizing:border-box}\n.badge-status{display:inline-block;padding:2px 7px;border-radius:4px;font-size:9px;font-weight:800;letter-spacing:.3px;text-transform:uppercase;cursor:pointer;border:1px solid;user-select:none;white-space:nowrap}\n.badge-nao_atendido{background:#ede9fe;color:#5b21b6;border-color:#c4b5fd}\n.badge-atendido{background:#d1fae5;color:#065f46;border-color:#6ee7b7}\n.badge-parcial{background:#fef3c7;color:#92400e;border-color:#fcd34d}\n.badge-sem_estoque{background:#fee2e2;color:#991b1b;border-color:#fca5a5}\n.badge-excedido{background:#fef3c7;color:#92400e;border-color:#fcd34d;border:1px solid}\n.tipo-pill{display:inline-block;padding:3px 10px;border-radius:10px;font-size:10px;font-weight:700;white-space:nowrap}\n.tipo-expediente{background:#dbeafe;color:#1e40af}.tipo-limpeza{background:#d1fae5;color:#065f46}.tipo-higiene{background:#fce7f3;color:#9d174d}.tipo-alimenticio{background:#fef3c7;color:#92400e}.tipo-descartavel{background:#e0e7ff;color:#3730a3}.tipo-atividades{background:#f3e8ff;color:#6b21a8}.tipo-outros{background:#f1f5f9;color:#475569}\n.ficha-summary{margin-top:14px;padding:8px 10px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;font-size:11px}\n.ficha-sigs{margin-top:24px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;font-size:10px}\n.ficha-sig{text-align:center}.ficha-sig-line{border-bottom:1px solid #0f172a;padding-bottom:3px;margin-bottom:3px;min-height:16px;font-weight:500}.ficha-sig-label{font-size:9px;color:#64748b;font-weight:600}\n.ficha-info-bar{display:flex;gap:12px;margin-bottom:10px;font-size:12px;align-items:center;flex-wrap:wrap}\n/* MODAL FULLSCREEN */\n.modal-ficha{display:none;position:fixed;inset:0;z-index:9999;background:rgba(2,6,23,.7);backdrop-filter:blur(4px);overflow-y:auto;padding:20px}\n.modal-ficha.open{display:block}\n.modal-inner{max-width:850px;margin:0 auto}\n.modal-toolbar{background:#0f172a;padding:10px 16px;border-radius:10px;margin-bottom:12px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;position:sticky;top:0;z-index:10}\n.modal-toolbar .title{color:#f8fafc;font-weight:700;font-size:13px}\n.fstats{display:flex;gap:4px;font-size:11px}\n.fstat{padding:3px 8px;border-radius:5px;font-weight:600}\n.fs-t{background:#1e293b;color:#94a3b8}.fs-ok{background:#052e16;color:#86efac}.fs-pa{background:#451a03;color:#fcd34d}.fs-se{background:#450a0a;color:#fca5a5}.fs-na{background:#2e1065;color:#c4b5fd}\n.legend{display:flex;gap:6px;align-items:center;margin-bottom:10px;font-size:10px;color:#64748b;flex-wrap:wrap}\n.mo{display:none;position:fixed;inset:0;z-index:99999;background:rgba(2,6,23,.6);backdrop-filter:blur(4px);align-items:center;justify-content:center}\n.mo.open{display:flex}\n.mbox{background:#fff;border-radius:16px;width:90%;max-width:420px;box-shadow:0 25px 50px rgba(0,0,0,.2);overflow:hidden;animation:ms .25s ease}\n.mhd{padding:18px 22px;border-bottom:1px solid #f1f5f9}.mhd h3{font-size:15px;font-weight:800}.mhd p{font-size:12px;color:#64748b;margin-top:3px}\n.mbd{padding:18px 22px}.mft{padding:12px 22px;background:#f8fafc;border-top:1px solid #f1f5f9;display:flex;gap:8px;justify-content:flex-end}\n@keyframes ms{from{opacity:0;transform:translateY(16px) scale(.96)}to{opacity:1;transform:translateY(0) scale(1)}}\n\n/* ─── RELATÓRIO ───────────────────────────────────── */\n.rel-layout{display:grid;grid-template-columns:300px 1fr;gap:16px;align-items:start}\n@media(max-width:700px){.rel-layout{grid-template-columns:1fr}}\n.rel-panel{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:16px;box-shadow:0 2px 8px rgba(0,0,0,.04)}\n.rel-panel h3{font-size:13px;font-weight:800;margin-bottom:10px;display:flex;align-items:center;gap:6px}\n.file-item{display:flex;align-items:flex-start;justify-content:space-between;padding:7px 10px;background:#f8fafc;border:1px solid var(--border);border-radius:8px;margin-bottom:6px;font-size:12px;gap:6px}\n.file-item-name{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}\n.file-item-date{font-size:10px;color:var(--muted);margin-top:2px}\n.file-item-del{color:#ef4444;font-size:14px;cursor:pointer;flex-shrink:0;padding:2px 5px;border-radius:4px;border:none;background:none;line-height:1}\n.file-item-del:hover{background:#fee2e2}\n.sel-multi{width:100%;padding:6px 8px;border:1.5px solid var(--border);border-radius:8px;font-size:12px;font-family:inherit;min-height:80px}\n.filter-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px}\n@media(max-width:600px){.filter-grid{grid-template-columns:1fr}}\n.rel-table{width:100%;border-collapse:collapse;font-size:12px}\n.rel-table th{background:#f8fafc;padding:8px 10px;text-align:left;font-size:10px;font-weight:800;text-transform:uppercase;color:var(--muted);border-bottom:2px solid var(--border);white-space:nowrap;cursor:help}\n.rel-table td{padding:7px 10px;border-bottom:1px solid #f1f5f9;vertical-align:middle}\n.rel-table tr:hover td{background:#f8fafc}\n.rel-table .num{text-align:right;font-weight:700;font-variant-numeric:tabular-nums}\n.rel-table .cat-hdr td{background:#e2e8f0;font-weight:800;font-size:11px;color:#334155;padding:7px 10px}\n.rel-badge{display:inline-block;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700}\n.rel-badge-unit{background:#dbeafe;color:#1e40af}\n.rel-badge-cat{background:#dcfce7;color:#166534}\n.year-badge{background:#f3e8ff;color:#6b21a8;border:1px solid #e9d5ff;display:inline-block;padding:2px 8px;border-radius:6px;font-size:11px;font-weight:700;margin:2px}\n.db-stats{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}\n.db-stat{background:#f8fafc;border:1px solid var(--border);border-radius:8px;padding:8px 12px;font-size:11px;flex:1;min-width:80px;text-align:center}\n.db-stat b{display:block;font-size:18px;color:var(--accent)}\n.merge-box{border:1.5px dashed var(--border);border-radius:8px;padding:10px;margin-top:8px;font-size:11px}\n.merge-box h4{font-size:11px;font-weight:700;margin-bottom:6px;color:#475569}\n.chip{display:inline-flex;align-items:center;gap:4px;background:#dbeafe;color:#1e40af;border-radius:10px;padding:3px 8px;font-size:11px;font-weight:600;margin:2px;cursor:pointer;border:1.5px solid transparent}\n.chip.sel{background:#1e40af;color:#fff}\n.rel-empty{text-align:center;padding:40px 20px;color:var(--muted)}\n.rel-empty .ic{font-size:36px;margin-bottom:8px}\n.progress-bar{width:100%;height:6px;background:#e2e8f0;border-radius:3px;overflow:hidden;margin-top:6px}\n.progress-fill{height:100%;background:var(--accent);border-radius:3px;transition:width .3s}\n.yr-detected{color:#10b981;cursor:default}\n.yr-assumed{color:#f59e0b;cursor:pointer;text-decoration:underline dotted}\n.yr-check-label{display:inline-flex;align-items:center;gap:4px;background:#f1f5f9;border:1.5px solid var(--border);border-radius:6px;padding:3px 10px;font-size:11px;font-weight:700;cursor:pointer;user-select:none}\n.yr-check-label:has(input:checked){background:#1e40af;color:#fff;border-color:#1e40af}\n.yr-check-label input{display:none}\n.gap-note{background:#fefce8;border:1px solid #fde047;border-radius:6px;padding:8px 12px;font-size:12px;color:#854d0e;margin-top:6px}\n.gap-ok{background:#f0fdf4;border-color:#bbf7d0;color:#166534}\n.gap-info{background:#f8fafc;border-color:#e2e8f0;color:#475569}\n\n/* ─── PAINEL ──────────────────────────────────────────── */\n.pan-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px;margin-bottom:20px}\n.kpi{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:16px;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,.04)}\n.kpi-val{font-size:28px;font-weight:800;line-height:1;margin-bottom:4px}\n.kpi-lbl{font-size:11px;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:.4px}\n.kpi-sub{font-size:10px;color:var(--muted);margin-top:4px}\n.pan-section{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:18px;margin-bottom:16px}\n.pan-section h2{font-size:14px;font-weight:800;margin-bottom:4px;display:flex;align-items:center;gap:6px}\n.pan-section .sub{font-size:11px;color:var(--muted);margin-bottom:14px}\n.alert-card{border-radius:10px;padding:12px 14px;margin-bottom:8px;font-size:12px;display:flex;gap:10px;align-items:flex-start}\n.alert-red{background:#fef2f2;border:1px solid #fecaca}\n.alert-yellow{background:#fefce8;border:1px solid #fde047}\n.alert-green{background:#f0fdf4;border:1px solid #bbf7d0}\n.alert-blue{background:#eff6ff;border:1px solid #bfdbfe}\n.alert-icon{font-size:18px;flex-shrink:0;line-height:1.2}\n.alert-body b{font-weight:700;display:block;margin-bottom:2px}\n.eff-table{width:100%;border-collapse:collapse;font-size:12px}\n.eff-table th{background:#f8fafc;padding:7px 10px;text-align:left;font-size:10px;font-weight:800;text-transform:uppercase;color:var(--muted);border-bottom:2px solid var(--border)}\n.eff-table td{padding:7px 10px;border-bottom:1px solid #f1f5f9;vertical-align:middle}\n.eff-table tr:hover td{background:#f8fafc}\n.eff-table .rn{text-align:right;font-weight:700;font-variant-numeric:tabular-nums}\n.heat-cell{padding:4px 8px;border-radius:4px;font-size:11px;font-weight:700;text-align:center;min-width:36px;display:inline-block}\n.cv-low{background:#d1fae5;color:#065f46}\n.cv-med{background:#fef9c3;color:#854d0e}\n.cv-hi{background:#fee2e2;color:#991b1b}\n.spark{display:inline-flex;align-items:flex-end;gap:2px;height:24px;vertical-align:middle}\n.spark-bar{width:8px;border-radius:2px 2px 0 0;background:#3b82f6}\n.two-col{display:grid;grid-template-columns:1fr 1fr;gap:16px}\n@media(max-width:640px){.two-col{grid-template-columns:1fr}}\n.pan-empty{text-align:center;padding:60px 20px;color:var(--muted)}\n.pan-empty .ic{font-size:48px;margin-bottom:12px}\n\n\n/* ─── PAGINAÇÃO ──────────────────────────────────────────── */\n.pag{display:flex;align-items:center;justify-content:center;gap:4px;padding:10px 0;font-size:12px;flex-wrap:wrap}\n.pag-btn{padding:4px 10px;border:1px solid var(--border);border-radius:6px;background:var(--surface);cursor:pointer;font-size:11px;font-weight:600;font-family:inherit;color:var(--text);transition:.15s}\n.pag-btn:hover{background:#f1f5f9;border-color:var(--accent)}.pag-btn.act{background:var(--accent);color:#fff;border-color:var(--accent)}\n.pag-btn:disabled{opacity:.4;cursor:not-allowed}\n.pag-info{font-size:11px;color:var(--muted);padding:0 8px}\n/* ─── RESPONSIVO ─────────────────────────────────────────── */\n.tbl-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch;margin:0 -4px;padding:0 4px}\n@media(max-width:640px){\n  .qt th,.qt td,.rel-table th,.rel-table td,.eff-table th,.eff-table td{padding:6px 6px;font-size:11px}\n  .ficha-table td,.ficha-table th{padding:3px 4px;font-size:10px}\n  .pan-grid{grid-template-columns:repeat(2,1fr)}\n  .kpi-val{font-size:22px}\n  .topbar{padding:8px 12px;font-size:11px}\n  .tabs{overflow-x:auto;-webkit-overflow-scrolling:touch}\n  .tab{padding:10px 12px;font-size:11px;min-width:0}\n  .modal-toolbar{flex-direction:column;gap:6px}\n  .rel-layout{grid-template-columns:1fr!important}\n  .two-col{grid-template-columns:1fr!important}\n  .filter-grid{grid-template-columns:1fr!important}\n  .row{grid-template-columns:1fr!important}\n  .card{padding:14px}\n  .view{padding:12px}\n}\n\n\n/* ─── PAINEL FILTROS ─────────────────────────────────────── */\n.pan-filters{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:16px;margin-bottom:16px;box-shadow:0 2px 8px rgba(0,0,0,.04)}\n.pan-filters h3{font-size:13px;font-weight:800;margin-bottom:10px;display:flex;align-items:center;gap:6px}\n.tipo-chips{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px}\n.tipo-chip{padding:6px 14px;border-radius:20px;font-size:11px;font-weight:700;cursor:pointer;border:2px solid var(--border);background:var(--surface);transition:.15s;user-select:none}\n.tipo-chip:hover{border-color:var(--accent);background:#f0f7ff}\n.tipo-chip.active{background:var(--accent);color:#fff;border-color:var(--accent)}\n.tipo-chip .cnt{font-size:9px;opacity:.7;margin-left:3px}\n.pan-unit-sel{display:flex;gap:8px;align-items:center;flex-wrap:wrap}\n.pan-unit-sel select{max-width:300px}\n.comp-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px;margin-bottom:16px}\n.comp-card{background:#f8fafc;border:1px solid var(--border);border-radius:12px;padding:14px;position:relative}\n.comp-card-title{font-size:11px;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.3px;margin-bottom:6px}\n.comp-card-val{font-size:22px;font-weight:800;line-height:1.1}\n.comp-card-sub{font-size:10px;color:var(--muted);margin-top:4px}\n.comp-bar{height:10px;border-radius:5px;background:#e2e8f0;overflow:hidden;margin-top:6px}\n.comp-bar-fill{height:100%;border-radius:5px;transition:width .4s}\n.comp-rank{display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:12px}\n.comp-rank:last-child{border-bottom:none}\n.comp-rank-pos{width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:11px;flex-shrink:0}\n.insight-card{background:linear-gradient(135deg,#f0f9ff,#e0f2fe);border:1px solid #bae6fd;border-radius:12px;padding:14px;margin-bottom:10px;font-size:12px}\n.insight-card b{color:#0369a1}\n.insight-card .val{font-size:18px;font-weight:800;color:#0c4a6e}\n@media(max-width:640px){.comp-grid{grid-template-columns:1fr 1fr}}\n\n\n/* ─── BURACOS ────────────────────────────────────────────── */\n.gap-unit{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:16px;margin-bottom:12px;box-shadow:0 2px 8px rgba(0,0,0,.04)}\n.gap-unit-hd{display:flex;align-items:center;gap:10px;margin-bottom:10px;cursor:pointer}\n.gap-unit-icon{width:40px;height:40px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0}\n.gap-unit-name{font-size:14px;font-weight:800}\n.gap-unit-sub{font-size:11px;color:var(--muted)}\n.gap-badge{display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700}\n.gap-badge-ok{background:#d1fae5;color:#065f46;border:1px solid #6ee7b7}\n.gap-badge-warn{background:#fef3c7;color:#92400e;border:1px solid #fcd34d}\n.gap-badge-danger{background:#fee2e2;color:#991b1b;border:1px solid #fca5a5}\n.gap-timeline{position:relative;padding:8px 0 8px 24px;border-left:3px solid #e2e8f0;margin-left:18px}\n.gap-timeline::before{content:'';position:absolute;left:-7px;top:12px;width:11px;height:11px;border-radius:50%;border:2px solid}\n.gap-tl-ok::before{background:#d1fae5;border-color:#10b981}\n.gap-tl-gap::before{background:#fee2e2;border-color:#ef4444}\n.gap-tl-edge::before{background:#fef3c7;border-color:#f59e0b}\n.gap-detail{font-size:12px;padding:4px 0}\n.gap-bar-wrap{height:16px;background:#f1f5f9;border-radius:8px;overflow:hidden;margin:8px 0;display:flex}\n.gap-bar-fill{height:100%}\n.gap-summary{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:8px;margin-bottom:16px}\n.gap-sum-card{background:#f8fafc;border:1px solid var(--border);border-radius:10px;padding:12px;text-align:center}\n.gap-sum-val{font-size:22px;font-weight:800;line-height:1}\n.gap-sum-lbl{font-size:10px;color:var(--muted);font-weight:600;text-transform:uppercase;margin-top:4px}\n/* ─── UNIFICAR ───────────────────────────────────────────── */\n.unif-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px}\n.unif-card{background:var(--surface);border:1.5px solid var(--border);border-radius:12px;padding:14px;cursor:pointer;transition:.15s;position:relative}\n.unif-card:hover{border-color:var(--accent);box-shadow:0 4px 12px rgba(37,99,235,.1)}\n.unif-card.selected{border-color:var(--accent);background:#eff6ff;box-shadow:0 0 0 3px rgba(37,99,235,.15)}\n.unif-card-name{font-weight:700;font-size:13px;margin-bottom:2px}\n.unif-card-sub{font-size:10px;color:var(--muted)}\n.unif-card-check{position:absolute;top:10px;right:10px;width:22px;height:22px;border-radius:50%;border:2px solid var(--border);display:flex;align-items:center;justify-content:center;font-size:12px;transition:.15s}\n.unif-card.selected .unif-card-check{background:var(--accent);border-color:var(--accent);color:#fff}\n.unif-alias{display:flex;align-items:center;gap:10px;padding:10px 14px;background:#f0f9ff;border:1px solid #bae6fd;border-radius:10px;margin-bottom:8px;font-size:12px}\n.unif-alias-from{background:#fee2e2;color:#991b1b;padding:3px 10px;border-radius:8px;font-weight:700;font-size:11px}\n.unif-alias-to{background:#d1fae5;color:#065f46;padding:3px 10px;border-radius:8px;font-weight:700;font-size:11px}\n.unif-merge-panel{background:var(--surface);border:2px solid var(--accent);border-radius:14px;padding:16px;margin-bottom:16px;box-shadow:0 4px 20px rgba(37,99,235,.15)}\n\n\n/* ─── INSPETOR DE ARQUIVO ────────────────────────────────── */\n.file-inspector{background:#f8fafc;border:1px solid var(--border);border-radius:10px;margin-top:8px;overflow:hidden}\n.fi-header{padding:8px 12px;background:#f1f5f9;font-size:11px;font-weight:700;display:flex;align-items:center;gap:6px;cursor:pointer}\n.fi-header:hover{background:#e2e8f0}\n.fi-body{padding:10px 12px;font-size:11px;max-height:300px;overflow-y:auto}\n.fi-unit{padding:6px 8px;background:#fff;border:1px solid var(--border);border-radius:8px;margin-bottom:6px}\n.fi-unit-name{font-weight:700;font-size:12px;margin-bottom:4px;display:flex;align-items:center;gap:6px}\n.fi-cat{padding:2px 8px;margin:2px 0;font-size:10px;display:flex;justify-content:space-between;border-radius:4px}\n.fi-cat:nth-child(odd){background:#f8fafc}\n.fi-go-btn{display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border-radius:6px;font-size:10px;font-weight:700;cursor:pointer;border:1px solid var(--accent);color:var(--accent);background:transparent;font-family:inherit;transition:.15s;white-space:nowrap}\n.fi-go-btn:hover{background:var(--accent);color:#fff}\n.file-highlight{animation:fileHL 2s ease;border-color:var(--accent)!important;box-shadow:0 0 0 3px rgba(37,99,235,.2)!important}\n@keyframes fileHL{0%{background:#dbeafe}50%{background:#dbeafe}100%{background:#f8fafc}}\n\n\n/* ─── ORIGEM (rastreio unidade/categoria → arquivo) ──────── */\n.origem-box{background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px;padding:8px 10px;font-size:11px;margin-top:4px;max-height:200px;overflow-y:auto}\n.origem-item{display:flex;align-items:center;gap:6px;padding:4px 0;border-bottom:1px solid #e0f2fe}\n.origem-item:last-child{border-bottom:none}\n.origem-fname{flex:1;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}\n.origem-meta{color:var(--muted);font-size:10px;flex-shrink:0}\n\n\n/* ─── FIX: Timeline overflow ─────────────────────────────── */\n.gap-timeline-wrap{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px;overflow-x:auto;-webkit-overflow-scrolling:touch;padding:4px 0}\n.gap-tl-block{border-radius:6px;padding:5px 8px;font-size:10px;flex-shrink:0;max-width:200px;min-width:80px}\n/* ─── Banco de Dados melhorias ───────────────────────────── */\n.db-search{width:100%;padding:7px 10px;border:1.5px solid var(--border);border-radius:8px;font-size:12px;font-family:inherit;outline:none;margin-bottom:8px}\n.db-search:focus{border-color:var(--accent);box-shadow:0 0 0 3px rgba(37,99,235,.1)}\n.file-actions{display:flex;gap:4px;align-items:center;flex-shrink:0}\n.file-actions button{padding:2px 6px;border:1px solid var(--border);border-radius:4px;background:var(--surface);cursor:pointer;font-size:10px;font-family:inherit;white-space:nowrap;transition:.15s}\n.file-actions button:hover{border-color:var(--accent);background:#eff6ff}\n/* ─── Unificar melhorado ─────────────────────────────────── */\n.unif-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:10px}\n.unif-card{background:var(--surface);border:1.5px solid var(--border);border-radius:12px;padding:14px;cursor:pointer;transition:.15s;position:relative}\n.unif-card:hover{border-color:var(--accent);box-shadow:0 4px 12px rgba(37,99,235,.1)}\n.unif-card.selected{border-color:var(--accent);background:#eff6ff;box-shadow:0 0 0 3px rgba(37,99,235,.15)}\n.unif-card-check{position:absolute;top:10px;right:10px;width:22px;height:22px;border-radius:50%;border:2px solid var(--border);display:flex;align-items:center;justify-content:center;font-size:12px;transition:.15s}\n.unif-card.selected .unif-card-check{background:var(--accent);border-color:var(--accent);color:#fff}\n.unif-merge-panel{background:var(--surface);border:2px solid var(--accent);border-radius:14px;padding:16px;margin-bottom:16px;box-shadow:0 4px 20px rgba(37,99,235,.15)}\n.unif-alias{display:flex;align-items:center;gap:8px;padding:8px 12px;background:#f0f9ff;border:1px solid #bae6fd;border-radius:10px;margin-bottom:6px;font-size:12px;flex-wrap:wrap}\n@media(max-width:640px){.unif-grid{grid-template-columns:1fr}.gap-tl-block{max-width:none;min-width:0;width:100%}}\n\n\n/* ─── EDITOR DE PLANILHA ─────────────────────────────────── */\n.editor-modal{display:none;position:fixed;inset:0;z-index:99998;background:rgba(2,6,23,.7);backdrop-filter:blur(4px);overflow-y:auto;padding:20px}\n.editor-modal.open{display:block}\n.editor-inner{max-width:800px;margin:0 auto;background:var(--surface);border-radius:16px;box-shadow:0 25px 50px rgba(0,0,0,.25);overflow:hidden}\n.editor-hd{background:var(--navy);color:#fff;padding:14px 20px;display:flex;align-items:center;justify-content:space-between}\n.editor-hd h3{font-size:14px;font-weight:800;margin:0}\n.editor-body{padding:16px 20px;max-height:70vh;overflow-y:auto}\n.ed-unit{border:1px solid var(--border);border-radius:10px;margin-bottom:12px;overflow:hidden}\n.ed-unit-hd{background:#f1f5f9;padding:8px 12px;display:flex;align-items:center;gap:8px;font-weight:700;font-size:12px}\n.ed-cat{padding:6px 12px;border-top:1px solid #f1f5f9}\n.ed-cat-hd{font-weight:700;font-size:11px;color:#475569;margin-bottom:4px;display:flex;align-items:center;gap:6px}\n.ed-item{display:grid;grid-template-columns:1fr 60px 30px;gap:6px;padding:3px 0;align-items:center;font-size:11px}\n.ed-item input{padding:4px 8px;border:1px solid var(--border);border-radius:4px;font-size:11px;font-family:inherit}\n.ed-item input:focus{border-color:var(--accent);outline:none}\n.ed-item .del{color:#ef4444;cursor:pointer;text-align:center;font-size:14px;border:none;background:none;padding:0}\n.ed-item .del:hover{background:#fee2e2;border-radius:4px}\n\n.rank-bar{height:8px;border-radius:4px;background:var(--accent);display:inline-block;vertical-align:middle;min-width:2px;transition:width .3s}\n.trend-up{color:#10b981;font-weight:700} .trend-dn{color:#ef4444;font-weight:700} .trend-eq{color:#94a3b8}\n.coverage-dot{width:8px;height:8px;border-radius:50%;display:inline-block;vertical-align:middle;margin-right:2px}\n.math-note{background:#fefce8;border:1px solid #fde047;border-radius:8px;padding:10px 14px;font-size:11px;color:#854d0e;margin-bottom:12px}\n.format-tag{display:inline-block;padding:3px 8px;border-radius:6px;font-size:10px;font-weight:700;margin-left:8px}\n.fmt-padrao{background:#dbeafe;color:#1e40af}.fmt-abrigo{background:#fef3c7;color:#92400e}";


// ═══════════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════════
let REQS=[],nextId=1,curId=null,tmpParsed=null,_mcb=null;

// ═══════════════════════════════════════════════════════════════════
// PERFORMANCE ENGINE — Debounce, Paginação, Cache
// ═══════════════════════════════════════════════════════════════════
const PAGE_SIZE = 30;
const PAGE_STATE = { ps:1, es:1, pe:1, hi:1, files:1, report:1 };

function debounce(fn, ms) {
  let t; return function(...a) { clearTimeout(t); t = setTimeout(() => fn.apply(this, a), ms); };
}

function paginate(arr, page, size) {
  size = size || PAGE_SIZE;
  const total = Math.ceil(arr.length / size);
  page = Math.max(1, Math.min(page, total || 1));
  return { items: arr.slice((page-1)*size, page*size), page, total, count: arr.length };
}

function paginationHTML(key, page, total, count) {
  if (total <= 1) return '<div class="pag-info">'+count+' registro(s)</div>';
  let h = '<div class="pag">';
  h += '<button class="pag-btn" onclick="goPage(\''+key+'\',1)" '+(page<=1?'disabled':'')+'>«</button>';
  h += '<button class="pag-btn" onclick="goPage(\''+key+'\','+(page-1)+')" '+(page<=1?'disabled':'')+'>‹</button>';
  
  // Smart page numbers
  let start = Math.max(1, page - 2), end = Math.min(total, page + 2);
  if (start > 1) h += '<span class="pag-info">...</span>';
  for (let i = start; i <= end; i++) {
    h += '<button class="pag-btn'+(i===page?' act':'')+'" onclick="goPage(\''+key+'\','+i+')">'+i+'</button>';
  }
  if (end < total) h += '<span class="pag-info">...</span>';
  
  h += '<button class="pag-btn" onclick="goPage(\''+key+'\','+(page+1)+')" '+(page>=total?'disabled':'')+'>›</button>';
  h += '<button class="pag-btn" onclick="goPage(\''+key+'\','+total+')" '+(page>=total?'disabled':'')+'>»</button>';
  h += '<span class="pag-info">'+count+' registros · pág '+page+'/'+total+'</span>';
  h += '</div>';
  return h;
}

function goPage(key, pg) {
  PAGE_STATE[key] = pg;
  if (key === 'ps') renderPS();
  else if (key === 'es') renderES();
  else if (key === 'pe') renderPE();
  else if (key === 'hi') renderHI();
  else if (key === 'files') renderRelatorio();
  else if (key === 'report') { document.getElementById('rReport').innerHTML = _lastReportHTML(pg); }
}

// Debounced search handlers
const debouncedRenderPS = debounce(renderPS, 250);
const debouncedRenderES = debounce(renderES, 250);
const debouncedRenderPE = debounce(renderPE, 250);
const debouncedRenderHI = debounce(renderHI, 250);
const debouncedRenderVinculos = debounce(renderVinculos, 250);

// Aggregation cache
let _aggCache = null, _aggCacheKey = '';
function getCachedAgg(entries, selUnits, selCats) {
  const key = entries.length + '|' + [...selUnits].join(',') + '|' + [...selCats].join(',') + '|' + HIST_DB.length;
  if (_aggCacheKey === key && _aggCache) return _aggCache;
  _aggCache = buildAgg(entries, selUnits, selCats);
  _aggCacheKey = key;
  return _aggCache;
}
function invalidateAggCache() { _aggCache = null; _aggCacheKey = ''; }


const tdEl = document.getElementById('td');
if (tdEl) {
    tdEl.textContent=new Date().toLocaleDateString('pt-BR',{weekday:'short',day:'2-digit',month:'short',year:'numeric'});
}
const SL={nao_atendido:'Não Atendido',atendido:'Atendido',parcial:'Parcial',sem_estoque:'Sem Estoque',excedido:'Excedido'};
const TIPO_CLS={'Expediente':'tipo-expediente','Limpeza':'tipo-limpeza','Higiene':'tipo-higiene','Alimentício':'tipo-alimenticio','Descartável':'tipo-descartavel','Atividades':'tipo-atividades','Outros':'tipo-outros'};
function esc(s){const d=document.createElement('div');d.textContent=s;return d.innerHTML}
function jsArg(v){
  if (v === null) return 'null';
  if (v === undefined) return 'undefined';
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  const s = String(v);
  return "'" + s.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\r/g, "\\r").replace(/\n/g, "\\n") + "'";
}
function sl(s){return SL[s]||'Não Atendido'}
function bc2(s){return'badge-status badge-'+(s||'nao_atendido')}
function rc2(s){return'row-'+(s||'nao_atendido')}
function fdt(d){return d.toLocaleDateString('pt-BR')+' '+d.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}
function today(){return new Date().toLocaleDateString('pt-BR')}
function tipoPill(t){return`<span class="tipo-pill ${TIPO_CLS[t]||'tipo-outros'}">${t}</span>`}
function tiposPills(a){return(a||[]).map(tipoPill).join(' ')}
function sumHTML(v){return`<span style="color:#059669">✓${v.filter(i=>i.status==='atendido').length}</span> <span style="color:#d97706">◐${v.filter(i=>i.status==='parcial').length}</span> <span style="color:#dc2626">✗${v.filter(i=>i.status==='sem_estoque').length}</span> <span style="color:#7c3aed">⊘${v.filter(i=>i.status==='nao_atendido').length}</span> <span style="color:#b45309">↑${v.filter(i=>i.status==='excedido').length}</span>`}
function sumText(v){return v.length+' itens | <span style="color:#059669">'+v.filter(i=>i.status==='atendido').length+' atendidos</span> | <span style="color:#d97706">'+v.filter(i=>i.status==='parcial').length+' parciais</span> | <span style="color:#dc2626">'+v.filter(i=>i.status==='sem_estoque').length+' sem estoque</span> | <span style="color:#7c3aed">'+v.filter(i=>i.status==='nao_atendido').length+' não atendidos</span>'}

// ═══════════════════════════════════════════════════════════════════
// PARSER V4 — Super Tratamento de Datas Excel/Calc e Regex Ampliado
// ═══════════════════════════════════════════════════════════════════
function n(v){return(v==null?'':String(v)).trim()}
function extractNum(s){
  if(typeof s === 'number') return s;
  if(!s) return 0;
  s = String(s).trim();
  if(/^(00?\.|nt$)/i.test(s)) return 0;
  const m = s.match(/^([\d.,]+)/);
  if(m) {
    let str = m[1];
    if (str.includes(',') && str.includes('.')) {
      str = str.replace(/\./g, '').replace(',', '.');
    } else if (str.includes(',')) {
      str = str.replace(',', '.');
    } else if (str.includes('.')) {
      let parts = str.split('.');
      if (parts.length === 2 && parts[1].length === 3) {
        str = str.replace('.', '');
      }
    }
    let val = parseFloat(str) || 0;
    const lower = s.toLowerCase();
    if (val && lower.includes('cento')) val *= 100;
    if (val && lower.includes('mil')) val *= 1000;
    return val;
  }
  return 0;
}
function isNoStock(qa){
  if(!qa)return false;
  const s=n(qa).toLowerCase();
  return s.includes('não é fornecido')||s.includes('nao e fornecido')||s.includes('sem estoque');
}
function specialStatus(qa){
  if(!qa)return null;
  const s=n(qa).toLowerCase();
  if(s.startsWith('enviado'))return'atendido';
  if(s.includes('não é fornecido')||s.includes('nao e fornecido')||s.includes('sem estoque'))return'sem_estoque';
  return null;
}
function isHeader(r){const f=n(r[0]).toLowerCase();return f==='material'||f==='materiais'||f==='item'}
function isFooter(r){const lo=n(r[0]).toLowerCase();return lo.includes('separado por')||lo.includes('separo por')||lo.includes('entregue por')||lo.includes('recebido por')||lo.includes('atenciosamente')}
function isSkipLine(f){const lo=String(f||'').toLowerCase();return lo.includes('nome da unid')||/^material\s+para\s+consumo/i.test(lo)||/^solicita[cç][aã]o\s+de\s+materia/i.test(lo)||/^\s*data\s*:/i.test(lo)||/^\d{1,2}[\/\.]\d{1,2}[\/\.]\d{2,4}\s*$/.test(f)||/^fornecimento\s+de/i.test(lo)||/^unidade\s+de\s+acolhimento/i.test(lo)}
function isCategory(r){
  const f=n(r[0]),lo=f.toLowerCase();if(!f)return false;
  if(/^\d+\s*[-–—.]\s*.+/.test(f))return true;
  if(/^materia(l|is)\s+(de\s+|para\s+|pcf|descart)/i.test(f))return true;
  if(/^(alimentos?|enlatados?|cereais|processados)\s/i.test(f))return true;
  const filled=r.filter(c=>n(c)).length;
  if(lo==='material'||lo==='materiais'){return filled===1}
  if(filled===1&&f.length>5&&!/^\d/.test(f)&&f===f.toUpperCase()&&!isSkipLine(f)&&!isFooter(r)&&looksLikeCategory(f))return true;
  if(filled===1&&f.length>8&&!/^\d/.test(f)&&!isSkipLine(f)&&!isFooter(r)&&!isHeader(r)&&looksLikeCategory(f))return true;
  return false;
}
function detectTipo(c){
  const lo=String(c||'').toLowerCase();
  if(/expediente|escrit[oó]rio|papelaria/i.test(lo))return'Expediente';
  if(/limpeza|lavar|cozinha/i.test(lo))return'Limpeza';
  if(/higiene|higi[eê]n/i.test(lo))return'Higiene';
  if(/alimento|aliment[ií]cio|processado|lanche|scfv|comida|enlatado|cereai?s?|gr[aã]os?|amido|industrializado|leite.*derivado/i.test(lo))return'Alimentício';
  if(/descart[aá]vel/i.test(lo))return'Descartável';
  if(/pcf|conviv[eê]ncia|servi[çc]o/i.test(lo))return'Atividades';
  return'Outros';
}


// ─── Guarda contra classificar itens comuns como categorias ──
const CAT_KEYWORDS = /material\s+para\s+consumo|material|higiene|limpeza|expediente|descart[aá]vel|enlatado|cereal|gr[aã]o|amido|processado|industrial|aliment[ií]cio|atividade|conviv|escrit[oó]rio|papelaria|lanche|scfv|pcf|servi[cç]o|perecív|fornecimento|solicita[çc]/i;
const ITEM_BLACKLIST = /^(absorvente|sabonete|desodorante|shampoo|condicionador|escova|pasta|fralda|papel|detergente|sabão|sab[aã]o|álcool|alcool|copo|guardanapo|prato|talher|colher|garfo|faca|sacola|saco|luva|máscara|mascara|toalha|esponja|vassoura|rodo|pano|balde|lixeir|café|açúcar|acucar|arroz|feijão|feijao|macarr[aã]o|farinha|leite|margarina|biscoito|óleo|oleo|vinagre|sal|extrato|tempero|corante|aveia|tapioca|trigo|fécula|cremogema|flocão|mucilon)s?$/i;

function looksLikeCategory(text) {
  if (!text) return false;
  // Numbered categories are always valid: "1 - ENLATADOS", "6 - MATERIAL DESCARTÁVEL"
  if (/^\d+\s*[-–—.]\s*.+/.test(text)) return true;
  // Must contain a category keyword
  if (CAT_KEYWORDS.test(text)) return true;
  // Reject if it's a known item
  if (ITEM_BLACKLIST.test(text.trim())) return false;
  return false;
}

function detectFormat(rows){
  for(let i=0; i<Math.min(rows.length, 15); i++){
    const r = rows[i];
    const c0=String(r[0]||'').trim().toLowerCase();
    const c1=String(r[1]||'').trim().toLowerCase();
    
    if(c1.includes('fornecimento')||c0.includes('fornecimento')) return 'abrigo';
    if(c0.includes('unidade de acolhimento')) return 'abrigo';
    
    if(c0 === 'material' || c0 === 'materiais'){
      if(r.length >= 4){
        const c2=String(r[2]||'').toLowerCase();
        if(c2.includes('solicitada')||c2.includes('quantidade')) return 'padrao';
      }
      if(c1 && c1 !== 'unidade' && c1 !== 'unid' && c1 !== 'unid.' && c1 !== 'und' && c1 !== 'especificação' && c1 !== 'quantidade' && c1 !== 'qtd') {
         return 'abrigo';
      }
    }
  }
  return 'padrao';
}

function extractUnit(rows){
  for(const r of rows){
    const f=n(r[0])||n(r[1]||'');
    const lo=f.toLowerCase();
    if(lo.includes('nome da unid')){
      const m=f.match(/nome\s+da\s+unid(?:ade|e)\s*:?\s*(.+)/i);
      if(m){
        let name=m[1].trim();
        name=name.replace(/\s+\d{1,2}\s*[\/\.]\s*\d{1,2}\s*[\/\.]\s*\d{2,4}\s*$/,'');
        name=name.replace(/\s*[-–]\s*\d.*/,'').replace(/[\s:–-]+$/,'').trim();
        return name;
      }
    }
    if(/^(CT|CRAS|CREAS|ABRIGO|SEDE|PROCAD|CENTRO\s*POP|AEPETI|ASTEC|CMDCA|CMDCMA|CMAS|COGETEP|PCDIF|IGAS)/i.test(f)&&!lo.includes('nome da unid'))
      return f.replace(/\s+\d{1,2}[\/\.].*/,'').trim();
  }
  return'Unidade';
}

function parsePadrao(rows){
  const un=extractUnit(rows);
  const cats=[];let cat=null,id=0;
  for(const row of rows){
    const r=row.map(c=>c==null?'':c);
    if(r.every(c=>!n(c)))continue;
    const f=n(r[0]);
    if(isFooter(r)||isSkipLine(f))continue;
    if(isHeader(r)){if(cat&&cat.items.length>0){cat={name:'Outros Itens',items:[]};cats.push(cat)}continue}
    if(isCategory(r)){cat={name:f,items:[]};cats.push(cat);continue}
    if(!f)continue;
    
    let unid=n(r[1]), qs=n(r[2]), qa=n(r[3]);
    
    // Tratamento para formato de 2 colunas (Material | Quantidade) onde a quantidade cai na coluna de unidade
    if(!qs && !qa && /^\d+/.test(unid) && !isNaN(extractNum(unid))) {
        qs = unid;
        unid = '';
    }

    if(!unid&&!qs&&!qa){if(cat&&f.length>=3&&!isSkipLine(f)){id++;cat.items.push({id,material:f,unidade:'',qtdSolicitada:'',qtdAtendida:'',status:'nao_atendido',tipo:detectTipo(cat.name),obs:''})}continue}
    if(!cat){cat={name:'Itens',items:[]};cats.push(cat)}
    id++;
    const noStock=isNoStock(qa);const spec=specialStatus(qa);
    const numS=extractNum(qs),numA=noStock?0:extractNum(qa);
    let st='nao_atendido';
    const qaStr=n(qa);
    const qaEmpty=!qaStr||qaStr==='-'||qaStr==='—';
    if(qaEmpty)st='nao_atendido';
    else if(spec)st=spec;
    else if(noStock)st='sem_estoque';
    else if(numA>0&&numS>0&&numA>numS)st='excedido';
    else if(numA>0&&numS>0&&numA<numS)st='parcial';
    else if(numA>0)st='atendido';
    const qaFinal = st==='nao_atendido' ? '' : (noStock ? '' : qaStr);
    cat.items.push({id,material:f,unidade:unid,qtdSolicitada:qs||'0',qtdAtendida:qaFinal,status:st,tipo:detectTipo(cat.name),obs:''});
  }
  const filtered=cats.filter(c=>c.items.length>0);
  filtered.forEach(c=>{c.tipo=detectTipo(c.name)});
  const tipos=[...new Set(filtered.map(c=>c.tipo))];
  return{unitName:un,categories:filtered.length?filtered:[{name:'Itens',items:[],tipo:'Outros'}],tipos:tipos.length?tipos:['Outros'],formato:'padrao'};
}

function parseAbrigo(rows){
  let headerRow=-1;const blocks=[];
  for(let i=0;i<rows.length;i++){
    const r=rows[i];
    for(let c=0;c<r.length;c++){
      if(n(r[c]).toLowerCase()==='material'&&n(r[c+1])&&n(r[c+1]).toLowerCase()!=='unidade'){
        const unitName=n(r[c+1]);
        if(unitName&&unitName.toLowerCase()!=='material'){
          blocks.push({col:c,unitName,startRow:i});
        }
      }
    }
    if(blocks.length>0&&headerRow<0)headerRow=i;
  }
  const uniqueBlocks=[];const seen=new Set();
  blocks.forEach(b=>{const key=b.col;if(!seen.has(key)){seen.add(key);uniqueBlocks.push(b)}});

  if(uniqueBlocks.length===0){
    return parseSingleAbrigo(rows);
  }
  const block=uniqueBlocks[0];
  return parseSingleAbrigo(rows,block.col,block.unitName);
}

function parseSingleAbrigo(rows,matCol,unitHint){
  matCol=matCol||0;
  const qtyCol=matCol+1;
  let unitName=unitHint||'Abrigo';
  for(const r of rows){
    const f=n(r[0])||n(r[matCol]||'');
    if(f.toLowerCase().includes('unidade de acolhimento')){
      const m=f.match(/acolhimento\s*[-:]\s*(.+)/i);
      if(m)unitName=m[1].trim();
    }
    if(f.toLowerCase().includes('nome da unid')){
      const m=f.match(/nome\s+da\s+unid(?:ade|e)\s*:?\s*(.+)/i);
      if(m)unitName=m[1].trim();
    }
  }
  unitName=unitName.replace(/\s+\d{1,2}[\/.].*/,'').replace(/[\s:–-]+$/,'').trim();

  const cats=[];let cat=null,id=0;
  for(const row of rows){
    const f=n(row[matCol]);const qty=n(row[qtyCol]);
    if(!f)continue;
    if(isFooter([f])||isSkipLine(f))continue;
    if(f.toLowerCase()==='material')continue;
    if(isCategory([f])){cat={name:f,items:[]};cats.push(cat);continue}
    if(!cat){cat={name:'Itens',items:[]};cats.push(cat)}
    id++;
    cat.items.push({id,material:f,unidade:'',qtdSolicitada:qty||'0',qtdAtendida:'',status:'nao_atendido',tipo:detectTipo(cat.name),obs:''});
  }
  const filtered=cats.filter(c=>c.items.length>0);
  filtered.forEach(c=>{c.tipo=detectTipo(c.name)});
  const tipos=[...new Set(filtered.map(c=>c.tipo))];
  return{unitName,categories:filtered.length?filtered:[{name:'Itens',items:[],tipo:'Outros'}],tipos:tipos.length?tipos:['Outros'],formato:'abrigo'};
}

function parseSheet(rows){
  if(isStackedFormat(rows)){
    // For requisição tab, just parse first block
    const fmt=detectFormat(rows);
    if(fmt==='abrigo')return parseAbrigo(rows);
  }
  const fmt=detectFormat(rows);
  if(fmt==='abrigo')return parseAbrigo(rows);
  return parsePadrao(rows);
}

// ═══════════════════════════════════════════════════════════════════
// FUNÇÕES DE EXTRAÇÃO SEGURA (Evita transformar datas em números de série)
// ═══════════════════════════════════════════════════════════════════
function getSafeRows(ws) {
  const rawRows = XLSX.utils.sheet_to_json(ws, {header: 1, defval: ''});
  return rawRows.map(r => r.map(c => {
    if (c instanceof Date) {
      // Usa UTC para consistência, mas valida contra timezone local
      const ud = c.getUTCDate(), um = c.getUTCMonth()+1, uy = c.getUTCFullYear();
      const ld = c.getDate(), lm = c.getMonth()+1, ly = c.getFullYear();
      // Se o dia UTC e local diferem, prefere local (timezone offset issue)
      const d = (ud !== ld && ly >= 2000) ? ld : ud;
      const mo = (ud !== ld && ly >= 2000) ? lm : um;
      const y = (ud !== ld && ly >= 2000) ? ly : uy;
      return pad2(d) + '/' + pad2(mo) + '/' + y;
    }
    // Números que parecem datas seriais do Excel (30000-60000 range)
    if (typeof c === 'number' && c > 30000 && c < 60000) {
      try {
        const dt = new Date((c - 25569) * 86400000);
        if (!isNaN(dt.getTime()) && dt.getFullYear() >= 2000)
          return pad2(dt.getUTCDate()) + '/' + pad2(dt.getUTCMonth()+1) + '/' + dt.getUTCFullYear();
      } catch(e){}
    }
    return c;
  }));
}

// ═══════════════════════════════════════════════════════════════════
// DOCX SUPPORT — Converte tabelas de .docx para rows[][] via mammoth.js
// ═══════════════════════════════════════════════════════════════════
function isDocxFile(name) {
  return /\.docx?$/i.test(name || '');
}

async function docxToRows(arrayBuffer) {
  if (typeof mammoth === 'undefined') throw new Error('mammoth.js não carregado');
  const result = await mammoth.convertToHtml({ arrayBuffer });
  const doc = new DOMParser().parseFromString(result.value, 'text/html');
  const rows = [];
  // Itera todas as tabelas (pode haver mais de uma no mesmo DOCX)
  doc.querySelectorAll('table tr').forEach(tr => {
    const cells = [];
    tr.querySelectorAll('td, th').forEach(td => {
      // Limpa espaços extras e bold markers do mammoth
      cells.push(td.textContent.replace(/\s+/g, ' ').trim());
    });
    // Ignora linhas completamente vazias
    if (cells.some(c => c)) rows.push(cells);
  });
  // Se não encontrou tabelas, tenta extrair do texto puro (fallback)
  if (!rows.length) {
    const textResult = await mammoth.extractRawText({ arrayBuffer });
    const lines = textResult.value.split('\n').filter(l => l.trim());
    lines.forEach(l => rows.push([l.trim()]));
  }
  return rows;
}

// ═══════════════════════════════════════════════════════════════════
// PDF SUPPORT — Extrai tabelas de .pdf via pdf.js (posição X/Y)
// ═══════════════════════════════════════════════════════════════════
function isPdfFile(name) {
  return /\.pdf$/i.test(name || '');
}

async function pdfToRows(arrayBuffer) {
  if (typeof pdfjsLib === 'undefined') throw new Error('pdf.js não carregado');

  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) });
  const pdf = await loadingTask.promise;
  const allRows = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();
    const items = textContent.items.filter(item => item.str.trim());
    if (!items.length) continue;

    // ── Agrupar itens por coordenada Y (mesma linha) ──
    const yThreshold = 4;
    const rowBuckets = [];

    items.forEach(item => {
      const y = Math.round(item.transform[5]);
      const x = item.transform[4];
      const text = item.str;
      const width = item.width || 0;

      let bucket = rowBuckets.find(b => Math.abs(b.y - y) <= yThreshold);
      if (!bucket) {
        bucket = { y, cells: [] };
        rowBuckets.push(bucket);
      }
      bucket.cells.push({ x, text, width });
    });

    // Ordenar linhas de cima para baixo (Y decresce no PDF)
    rowBuckets.sort((a, b) => b.y - a.y);

    // ── Detectar fronteiras de coluna via header "Material" ──
    // Procura a linha que contém "Material" + "Quantidade"
    let colBoundaries = null;
    for (const bucket of rowBuckets) {
      const sorted = [...bucket.cells].sort((a, b) => a.x - b.x);
      const fullText = sorted.map(c => c.text).join(' ').toLowerCase();
      if (fullText.includes('material') && fullText.includes('quantidade')) {
        // Detecta posições X das colunas
        const matCell = sorted.find(c => /^material$/i.test(c.text.trim()));
        const qtdCells = sorted.filter(c => /quantidade/i.test(c.text));
        if (matCell && qtdCells.length >= 1) {
          const xMat = matCell.x;
          const xQtd1 = qtdCells[0]?.x || 999;
          const xQtd2 = qtdCells.length > 1 ? qtdCells[1]?.x : xQtd1 + 120;
          // Fronteiras: [col0_start, col1_start, col2_start]
          colBoundaries = [xMat, (xMat + xQtd1) / 2, (xQtd1 + xQtd2) / 2];
        }
        break;
      }
    }

    // ── Converter cada linha em array de colunas ──
    for (const bucket of rowBuckets) {
      const sorted = [...bucket.cells].sort((a, b) => a.x - b.x);

      if (colBoundaries && sorted.length >= 1) {
        // Usar fronteiras detectadas para distribuir em 3-4 colunas
        const cols = ['', '', '', ''];
        for (const cell of sorted) {
          let colIdx = 0;
          if (cell.x >= colBoundaries[2]) colIdx = 2;
          else if (cell.x >= colBoundaries[1]) colIdx = 1;
          cols[colIdx] += (cols[colIdx] ? ' ' : '') + cell.text.trim();
        }
        // Remove colunas vazias no final
        while (cols.length && !cols[cols.length - 1].trim()) cols.pop();
        if (cols.some(c => c.trim())) allRows.push(cols.map(c => c.trim()));
      } else {
        // Fallback: detecta colunas por gaps grandes (>40px)
        const columns = [];
        let currentCol = '';
        let lastRight = -999;

        for (const cell of sorted) {
          const gap = cell.x - lastRight;
          if (gap > 40 && currentCol.trim()) {
            columns.push(currentCol.trim());
            currentCol = cell.text;
          } else {
            currentCol += (currentCol ? ' ' : '') + cell.text;
          }
          lastRight = cell.x + (cell.width || cell.text.length * 5);
        }
        if (currentCol.trim()) columns.push(currentCol.trim());
        if (columns.length) allRows.push(columns);
      }
    }
  }

  return allRows;
}
const dz=document.getElementById('fdrop');
if (dz) {
  ['dragenter','dragover'].forEach(e=>dz.addEventListener(e,ev=>{ev.preventDefault();dz.classList.add('over')}));
  ['dragleave','drop'].forEach(e=>dz.addEventListener(e,ev=>{ev.preventDefault();dz.classList.remove('over')}));
  dz.addEventListener('drop',e=>{const f=e.dataTransfer.files[0];if(f){const dt=new DataTransfer();dt.items.add(f);document.getElementById('fi').files=dt.files;handleFile({target:{files:[f]}})}});
}

function handleFile(e){
  const file=e.target.files[0];if(!file)return;
  document.getElementById('fname').textContent='✓ '+file.name;document.getElementById('fname').style.display='block';
  const reader=new FileReader();
  reader.onload=async (ev)=>{try{
    const a=new Uint8Array(ev.target.result);
    let rows, wb = null;

    if (isDocxFile(file.name)) {
      rows = await docxToRows(ev.target.result);
      wb = { SheetNames: ['Sheet1'], Sheets: { Sheet1: {} } };
    } else if (isPdfFile(file.name)) {
      rows = await pdfToRows(ev.target.result);
      wb = { SheetNames: ['Sheet1'], Sheets: { Sheet1: {} } };
    } else {
      wb = XLSX.read(a, {type:'array', cellDates: true});
      const ws = wb.Sheets[wb.SheetNames[0]];
      rows = getSafeRows(ws);
    }

    tmpParsed=parseSheet(rows);
    tmpParsed.fileName=file.name;
    tmpParsed._wb=wb;
    tmpParsed._rows=rows;
    if (isDocxFile(file.name)) tmpParsed.formato = 'docx';
    if (isPdfFile(file.name)) tmpParsed.formato = 'pdf';
    
    // ── Tenta arranjar nome da unidade ──
    if (tmpParsed.unitName === 'Unidade' || tmpParsed.unitName === 'Desconhecida') {
        const m = file.name.match(/(CRAS|CREAS|CENTRO POP|CT|PROCAD|AEPETI|ASTEC|ILPI|CAT|POP RUA|CMDCA|CMDCMA|CMAS)[a-z\s_0-9\-ãõáéíóúâêîôû]+/i);
        if(m) tmpParsed.unitName = normalizeUnit(m[0].replace(/[-_]/g, ' ').trim());
    }

    // ── Detectar período da planilha ──
    const per = parsePeriodFromRows(rows);
    const fy = new Date().getFullYear();
    const fin = finalizePeriod(per, fy);
    tmpParsed._detectedPeriod = fin;

    // ── Auto-preencher data do pedido ──
    const rDateEl = document.getElementById('rDate');
    const rDateWarn = document.getElementById('rDateWarn');
    if (rDateEl) {
      if (fin && fin.ws && fin.label !== '? (sem data)') {
        rDateEl.value = fin.ws; // ISO date detected from file
        tmpParsed._dateDetected = true;
        if (rDateWarn) rDateWarn.style.display = fin.yearAssumed ? 'block' : 'none';
      } else {
        // Data não detectada → usa data de hoje como fallback
        const hj = new Date();
        rDateEl.value = hj.getFullYear() + '-' + pad2(hj.getMonth()+1) + '-' + pad2(hj.getDate());
        tmpParsed._dateDetected = false;
        if (rDateWarn) {
          rDateWarn.innerHTML = '⚠️ Data não identificada na planilha. <b>Usando data de hoje (' + pad2(hj.getDate()) + '/' + pad2(hj.getMonth()+1) + '/' + hj.getFullYear() + ').</b> Altere se necessário.';
          rDateWarn.style.display = 'block';
        }
      }
    }

    // ── Montar info de detecção visual ──
    const el=document.getElementById('detectInfo');
    const totalItens=tmpParsed.categories.reduce((s,c)=>s+c.items.length,0);
    const perTag=fin&&fin.label!=='? (sem data)'
      ?'<span style="font-size:10px;color:var(--muted);margin-left:4px">📅 '+fin.label+(fin.yearAssumed?' <span style="color:#f59e0b">⚠️ ano assumido</span>':'')+'</span>'
      :'<span style="font-size:10px;color:#d97706;margin-left:4px">⚠️ Data não detectada</span>';
    const fmtTag=tmpParsed.formato==='pdf'
      ?'<span class="format-tag" style="background:#fce7f3;color:#9d174d">Formato PDF</span>'
      :tmpParsed.formato==='docx'
      ?'<span class="format-tag" style="background:#e0e7ff;color:#3730a3">Formato DOCX</span>'
      :tmpParsed.formato==='abrigo'
      ?'<span class="format-tag fmt-abrigo">Formato Abrigo</span>'
      :'<span class="format-tag fmt-padrao">Formato Padrão</span>';
    const nUnitsInFile=detectAllUnits(wb,rows);
    const multiTag=nUnitsInFile>1
      ?'<span style="font-size:10px;background:#dcfce7;color:#166534;padding:1px 7px;border-radius:8px;margin-left:4px">'+nUnitsInFile+' unidades</span>'
      :'';
    el.innerHTML='<b>'+esc(tmpParsed.unitName)+'</b> '+fmtTag+multiTag+perTag
      +'<br>'+tiposPills(tmpParsed.tipos)
      +' <span style="font-size:11px;color:var(--muted)">('+totalItens+' itens)</span>';

    // ── Matching contra unidades da Gestão + aliases ──
    const uSel=document.getElementById('rU');
    const rUWarn = document.getElementById('rUWarn');
    const det = (tmpParsed.unitName || '').trim();
    const detUp = rmAcc(det).toUpperCase();
    let found = false;

    // Passo 1: Match exato (case-insensitive, sem acento)
    for(let i=1;i<uSel.options.length;i++){
      const optVal = uSel.options[i].value;
      if (!optVal) continue;
      const optUp = rmAcc(optVal).toUpperCase();
      if (detUp === optUp) { uSel.selectedIndex=i; found=true; break; }
    }

    // Passo 2: Match parcial (detectado contém o nome da unidade ou vice-versa)
    if (!found) {
      for(let i=1;i<uSel.options.length;i++){
        const optVal = uSel.options[i].value;
        if (!optVal) continue;
        const optUp = rmAcc(optVal).toUpperCase();
        if (detUp.includes(optUp) || optUp.includes(detUp)) { uSel.selectedIndex=i; found=true; break; }
      }
    }

    // Passo 3: Match via aliases (nome da planilha → nome canônico → selecionar)
    if (!found) {
      const canonical = normalizeUnit(det);
      if (canonical && canonical !== 'Desconhecida' && canonical !== det) {
        const canUp = rmAcc(canonical).toUpperCase();
        for(let i=1;i<uSel.options.length;i++){
          const optUp = rmAcc(uSel.options[i].value || '').toUpperCase();
          if (canUp === optUp || canUp.includes(optUp) || optUp.includes(canUp)) { uSel.selectedIndex=i; found=true; break; }
        }
      }
    }

    // Se não encontrou, mostra warning
    if (!found || det === 'Unidade' || det === 'Desconhecida') {
      uSel.selectedIndex=0;
      if (rUWarn) rUWarn.style.display = 'block';
      tmpParsed._unitDetected = false;
    } else {
      if (rUWarn) rUWarn.style.display = 'none';
      tmpParsed._unitDetected = true;
    }

    ck();
  }catch(err){toast('Erro ao ler: '+err.message,'red')}};
  reader.readAsArrayBuffer(file);
}

function detectAllUnits(wb,rows){
  if(wb.SheetNames.length>1&&wb.SheetNames.some(s=>/^(RI|CAT|POP|ILPI|REPUB|ACOLH|RECANT|CASA|MULHER|LUZ)/i.test(s)))
    return wb.SheetNames.length;
  let colCount=0;
  for(let ri=0;ri<Math.min(rows.length,15);ri++){
    const r=rows[ri];
    for(let ci=0;ci<r.length;ci++){
      if(String(r[ci]||'').trim().toLowerCase()==='material'){
        const abbr=String(r[ci+1]||'').trim();
        if(abbr&&abbr.toLowerCase()!=='unidade')colCount++;
      }
    }
    if(colCount>0&&ri>5)break;
  }
  return colCount||1;
}
function ck(){
  const hasParsed = !!tmpParsed;
  const uSel = document.getElementById('rU');
  const rDate = document.getElementById('rDate');
  const rUWarn = document.getElementById('rUWarn');
  const rDateWarn = document.getElementById('rDateWarn');
  
  // Unidade: precisa ter sido detectada OU selecionada manualmente
  const hasUnit = !!(uSel && uSel.value);
  const unitOk = hasUnit || (hasParsed && tmpParsed._unitDetected);

  // Data: precisa ter sido detectada OU preenchida manualmente
  const hasDate = !!(rDate && rDate.value);
  const dateOk = hasDate;

  // Warnings visuais
  if (hasParsed && rUWarn) {
    rUWarn.style.display = (!unitOk) ? 'block' : 'none';
  }
  if (hasParsed && rDateWarn) {
    rDateWarn.style.display = (!dateOk) ? 'block' : 'none';
  }

  const canReg = hasParsed && (unitOk || hasUnit) && dateOk;
  document.getElementById('bR').disabled = !canReg;
  const bPreview = document.getElementById('bPreview');
  if (bPreview) bPreview.disabled = !hasParsed;
}

function stripVolatileParsed(parsed) {
  if (!parsed || typeof parsed !== 'object') return null;
  const cleanCats = Array.isArray(parsed.categories)
    ? parsed.categories.map((c) => ({
      name: c?.name || c?.catName || 'Outros',
      items: Array.isArray(c?.items) ? c.items.map((it) => ({ id: it?.id, material: it?.material || '' })) : []
    }))
    : [];
  return {
    fileName: parsed.fileName || '',
    unitName: parsed.unitName || '',
    formato: parsed.formato || 'padrao',
    tipos: Array.isArray(parsed.tipos) ? parsed.tipos : [],
    categories: cleanCats
  };
}

function deepCleanForFirestore(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const t = typeof value;
  if (t === 'function') return undefined;
  if (t !== 'object') return value;
  if (value instanceof Date) return value;
  if (Array.isArray(value)) {
    const out = value.map(deepCleanForFirestore).filter((v) => v !== undefined);
    return out;
  }
  const out = {};
  Object.keys(value).forEach((k) => {
    const v = deepCleanForFirestore(value[k]);
    if (v !== undefined) out[k] = v;
  });
  return out;
}

function omitUndefinedShallow(obj) {
  const out = {};
  Object.keys(obj || {}).forEach((k) => {
    const v = obj[k];
    if (v !== undefined) out[k] = v;
  });
  return out;
}

// ═══════════════════════════════════════════════════════════════════
// REGISTRAR E CANCELAR
// ═══════════════════════════════════════════════════════════════════
function buildPreviewReqObject() {
  if (!tmpParsed) return null;
  const uSel=document.getElementById('rU');
  const unidade=uSel.value||normalizeUnit(tmpParsed.unitName)||tmpParsed.unitName;
  const itemsMap={};tmpParsed.categories.forEach(c=>c.items.forEach(it=>{itemsMap[it.id]={...it}}));
  const parsedSafe = stripVolatileParsed(tmpParsed);
  const fy = new Date().getFullYear();
  const per = (tmpParsed && tmpParsed._rows) ? bestPeriod(tmpParsed._rows, tmpParsed.fileName) : parsePeriodFromFileName(tmpParsed.fileName);
  const fin = finalizePeriod(per, fy);
  const dtReq = fin?.ws ? new Date(fin.ws + 'T12:00:00') : new Date();
  
  return {
    id: 'preview_temp', unidade, tipos: tmpParsed.tipos, formato: tmpParsed.formato,
    resp: document.getElementById('rR').value||'Admin',
    obs: document.getElementById('rO').value, dt: dtReq,
    fileName: tmpParsed.fileName, parsed: parsedSafe, items: itemsMap,
    periodLabel: fin?.label || '', periodStart: fin?.ws || '', periodEnd: fin?.we || '',
    status: 'requisitado', separador: null, entreguePor: null, retiradoPor: null, histEntryId: null
  };
}

function previewReq() {
  const req = buildPreviewReqObject();
  if (!req) return;
  
  const titleEl = document.getElementById('fichaTitle');
  const bodyEl = document.getElementById('fichaBody');
  const modalEl = document.getElementById('fichaModal');
  const statsEl = document.getElementById('fichaStats');
  if (!titleEl || !bodyEl || !modalEl || !statsEl) { toast('Tela de pré-visualização indisponível.', 'red'); return; }
  
  titleEl.textContent='👁️ Pré-visualização: '+req.unidade;
  
  const actions = document.getElementById('fichaModalActions');
  const legend = document.getElementById('fichaModalLegend');
  if (actions) actions.style.display = 'none';
  if (legend) legend.style.display = 'none';
  
  bodyEl.innerHTML=buildFichaHTML(req, true);
  modalEl.classList.add('open');
  
  // Limpar os fstats na pré-visualização, pois não há contagem real ainda
  statsEl.innerHTML='';
}

async function registrar(){
  const uSel=document.getElementById('rU');
  const rDate=document.getElementById('rDate');

  // ── Validação: unidade obrigatória ──
  const unidade = uSel.value || '';
  if (!unidade) {
    toast('Selecione a unidade antes de registrar.', 'red');
    uSel.focus();
    return;
  }

  // ── Validação: data obrigatória ──
  const dateVal = rDate?.value || '';
  if (!dateVal) {
    toast('Informe a data do pedido antes de registrar.', 'red');
    if (rDate) rDate.focus();
    return;
  }

  const dtReq = new Date(dateVal + 'T12:00:00');
  if (isNaN(dtReq.getTime())) {
    toast('Data inválida. Corrija e tente novamente.', 'red');
    return;
  }

  const itemsMap={};tmpParsed.categories.forEach(c=>c.items.forEach(it=>{itemsMap[it.id]={...it}}));
  const parsedSafe = stripVolatileParsed(tmpParsed);

  // Período detectado (já calculado no handleFile)
  const fin = tmpParsed._detectedPeriod || {};

  const req={id:nextId++,unidade,tipos:tmpParsed.tipos,formato:tmpParsed.formato,
    resp:document.getElementById('rR').value||'Admin',
    obs:document.getElementById('rO').value,dt:dtReq,
    fileName:tmpParsed.fileName,parsed:parsedSafe,items:itemsMap,
    periodLabel: fin?.label || '',
    periodStart: fin?.ws || dateVal,
    periodEnd: fin?.we || dateVal,
    status:'requisitado',separador:null,entreguePor:null,retiradoPor:null,histEntryId:null,dbAdded:false};
  REQS.push(req);

  const ok = await (async () => {
    try {
      const one = deepCleanForFirestore({
        ...req,
        dt: req.dt?.toISOString(),
        dtEntrega: req.dtEntrega?.toISOString(),
        parsed: stripVolatileParsed(req.parsed)
      });
      await DataStore.set('reqs', [one]);
      return true;
    } catch (e) {
      console.warn('Erro ao salvar requisição:', e);
      const code = String(e?.code || '');
      const msg = String(e?.message || '');
      toast('Erro ao salvar no Firestore. ' + (code ? code + ': ' : '') + msg, 'red');
      return false;
    }
  })();
  if (!ok) {
    REQS = REQS.filter(r => r.id !== req.id);
    toast('Não foi possível salvar no Firestore. A requisição não foi registrada.', 'red');
    renderAll();
    return;
  }

  tmpParsed=null;document.getElementById('fi').value='';document.getElementById('fname').style.display='none';
  document.getElementById('rU').selectedIndex=0;document.getElementById('rO').value='';
  const rDateReset=document.getElementById('rDate');if(rDateReset)rDateReset.value='';
  const rUWarnReset=document.getElementById('rUWarn');if(rUWarnReset)rUWarnReset.style.display='none';
  const rDateWarnReset=document.getElementById('rDateWarn');if(rDateWarnReset)rDateWarnReset.style.display='none';
  document.getElementById('detectInfo').innerHTML='<span style="color:var(--muted);font-size:12px">Anexe a planilha...</span>';
  document.getElementById('bR').disabled=true;
  toast('Requisição registrada! Os dados irão para o Relatório após a Entrega.', 'green');
  goTab('ps');
}

async function cancelarReq(id){
  if(!confirm('Deseja cancelar e remover esta requisição?')) return;
  const key = String(id);
  try {
    await deleteDoc(doc(COLLECTIONS.materiais, key));
  } catch (e) {
    console.warn('Erro ao remover requisição:', e);
    const code=String(e?.code||''),msg=String(e?.message||'');
    toast('Erro ao remover no Firestore. '+(code?code+': ':'')+msg,'red');
    return;
  }
  REQS = REQS.filter(r => String(r.id) !== key);
  toast('Requisição removida.', 'red');
  renderAll();
}

async function excluirHistoricoReq(id){
  if (getUserRole() !== 'admin') { toast('Permissão negada: apenas Admin.', 'red'); return; }
  if(!confirm('Deseja excluir esta entrega do Histórico? (remove do banco também)')) return;
  const key = String(id);
  const r = findReq(key);
  try {
    const histId = r?.histEntryId ? String(r.histEntryId) : '';
    if (histId) {
      await deleteDoc(doc(COLLECTIONS.semcasHistDB, histId));
      HIST_DB = HIST_DB.filter(e => String(e.id) !== histId);
      invalidateAggCache();
    }
  } catch (e) {
    console.warn('Erro ao remover do banco histórico:', e);
  }
  try {
    await deleteDoc(doc(COLLECTIONS.materiais, key));
  } catch (e) {
    console.warn('Erro ao remover requisição:', e);
    const code=String(e?.code||''),msg=String(e?.message||'');
    toast('Erro ao remover no Firestore. '+(code?code+': ':'')+msg,'red');
    return;
  }
  REQS = REQS.filter(rq => String(rq.id) !== key);
  toast('Entrega removida.', 'red');
  renderAll();
  try { buildPainel(); } catch (_) {}
  try { renderRelatorio(); } catch (_) {}
}

function addReqToHistDB(req) {
  const fy = req.periodStart ? (parseInt(String(req.periodStart).substring(0,4)) || req.dt.getFullYear()) : req.dt.getFullYear();
  const fin = (req.periodStart && req.periodEnd)
    ? { ws: req.periodStart, we: req.periodEnd, label: req.periodLabel || '?', year: fy, month: parseInt(String(req.periodStart).substring(5,7)) || 1, yearAssumed: false }
    : finalizePeriod((req.parsed && req.parsed._rows) ? bestPeriod(req.parsed._rows, req.fileName) : parsePeriodFromFileName(req.fileName), fy);
  
  const parsedCats = (req?.parsed?.categories || []);
  const categories = parsedCats.map(c => {
    return {
      catName: normalizeCat(c.name||'Outros'),
      items: (c.items||[]).map(origIt => {
        const editedIt = req.items[origIt.id];
        let qty = 0;
        // REGRA DE OURO: Vai a quantidade ATENDIDA, modificada em separação!
        if(editedIt && editedIt.status !== 'sem_estoque' && editedIt.status !== 'nao_atendido') {
           const qa = extractNum(editedIt.qtdAtendida);
           qty = qa;
           if (!qty) qty = extractNum(editedIt.qtdSolicitada);
        }
        return { material: origIt.material||'', qty };
      }).filter(it => it.material)
    };
  }).filter(c => c.items.length > 0);

  const unitName = normalizeUnit(req.unidade) || req.unidade;
  const entryId = 'req_' + Date.now() + '_' + Math.random().toString(36).substring(2,6);
  const entry = {
    id: entryId,
    fileName: req.fileName,
    weekStart: fin.ws, weekEnd: fin.we,
    weekLabel: fin.label, year: fin.year, month: fin.month,
    yearAssumed: fin.yearAssumed,
    units: [{ unitName, rawUnit: req.unidade, categories }]
  };
  
  HIST_DB.push(entry);
  invalidateAggCache();
  return entry;
}

function buildHistEntryFromParsed(parsed,fin){
  const categories=(parsed.categories||[]).map(c=>({
    catName:normalizeCat(c.name||'Outros'),
    items:(c.items||[]).map(it=>{
      let qty=0;
      const qaStr = it.qtdAtendida;
      const qsStr = it.qtdSolicitada;
      
      // REGRA DE OURO (Fallback): Se inserido direto no "Banco de Dados", tenta a Atendida primeiro, se não tiver, usa Solicitada.
      if (qaStr !== undefined && qaStr !== null && String(qaStr).trim() !== '') {
          qty = extractNum(qaStr);
      } else if (qsStr !== undefined && qsStr !== null && String(qsStr).trim() !== '') {
          qty = extractNum(qsStr);
      } else if (typeof it.qty === 'number') {
          qty = it.qty; 
      }
      return{material:it.material||'',qty};
    }).filter(it=>it.material) 
  })).filter(c=>c.items.length>0);

  const unitName=normalizeUnit(parsed.unitName)||parsed.unitName;
  return{
    fileName:parsed.fileName,
    weekStart:fin.ws, weekEnd:fin.we,
    weekLabel:fin.label, year:fin.year, month:fin.month,
    yearAssumed:fin.yearAssumed,
    units:[{unitName,rawUnit:parsed.unitName,categories}]
  };
}

// ═══════════════════════════════════════════════════════════════════
// TABS & RENDER
// ═══════════════════════════════════════════════════════════════════
function getSeparacaoRoot() {
  return document.querySelector("#content-materiais .separacao-module") || document.querySelector(".separacao-module");
}

function isTabAllowedForRole(role, tab) {
  if (role === "admin") return ["req", "ps", "es", "pe", "hi", "pan", "rel", "db"].includes(tab);
  if (role === "editor") return ["ps", "es", "pe"].includes(tab);
  return false;
}

function applySeparacaoRoleUI() {
  const root = getSeparacaoRoot();
  if (!root) return;
  const role = getUserRole();

  root.querySelectorAll(".tab").forEach((el) => {
    const t = el.dataset.tab;
    el.style.display = isTabAllowedForRole(role, t) ? "" : "none";
  });

  const active = root.querySelector(".tab.active")?.dataset.tab;
  if (active && !isTabAllowedForRole(role, active)) {
    goTab("ps");
  }
}

function syncReqsFromCache() {
  const mats = (getMateriais() || []).filter((m) => {
    if (m?.deleted) return false;
    if (m?._version === 2) return true;
    if (m?.origemFluxo === "v2") return true;
    if (m?.itemsMap && typeof m.itemsMap === "object") return true;
    return false;
  });
  if (!mats.length) { try { console.info("[FM] syncReqs: 0 materiais"); } catch (_) {} return; }

  const mapped = mats.map((m) => {
    const st = String(m.status || "").toLowerCase();
    const status = st === "separacao" ? "separando" : st === "retirada" ? "pronto" : st;
    const dt = (m.dataRequisicao || m.registradoEm || null)?.toDate ? (m.dataRequisicao || m.registradoEm).toDate() : new Date();
    const dtEntrega = (m.dataEntrega || null)?.toDate ? m.dataEntrega.toDate() : null;
    return {
      id: m.id,
      v2Id: m.v2Id || null,
      unidade: m.unidade || m.unidadeNome || "Unidade",
      tipos: m.tipos || m.tiposMaterial || (m.tipoMaterial ? [m.tipoMaterial] : ["Outros"]),
      formato: m.formato || "padrao",
      resp: m.resp || m.lancadoPor || m.responsavelLancamento || "",
      obs: m.obs || m.itens || "",
      dt,
      fileName: m.fileName || "",
      periodLabel: m.periodLabel || m.periodoLabel || "",
      periodStart: m.periodStart || m.periodoStart || "",
      periodEnd: m.periodEnd || m.periodoEnd || "",
      parsed: m.parsedData || m.parsed || null,
      items: m.itemsMap || m.items || {},
      status,
      separador: m.separador || m.responsavelSeparador || null,
      entreguePor: m.entreguePor || m.responsavelEntregaAlmox || null,
      retiradoPor: m.retiradoPor || m.responsavelRecebimento || null,
      dtEntrega,
      histEntryId: m.histEntryId || null,
      dbAdded: !!m.dbAdded
    };
  });

  const existingById = new Map((REQS || []).map((r) => [String(r?.id ?? ""), r]).filter(([k]) => k));
  const merged = [];
  const seen = new Set();
  const differs = (a, b) => {
    if (!a || !b) return true;
    if (String(a.status) !== String(b.status)) return true;
    if (String(a.separador || '') !== String(b.separador || '')) return true;
    if (String(a.entreguePor || '') !== String(b.entreguePor || '')) return true;
    if (String(a.retiradoPor || '') !== String(b.retiradoPor || '')) return true;
    const ta = a.dtEntrega instanceof Date ? a.dtEntrega.getTime() : null;
    const tb = b.dtEntrega instanceof Date ? b.dtEntrega.getTime() : null;
    if (ta !== tb) return true;
    return false;
  };
  mapped.forEach((mr) => {
    const k = String(mr.id);
    seen.add(k);
    const ex = existingById.get(k);
    if (ex && ex.__dirty) {
      if (differs(ex, mr)) {
        merged.push(ex);
        return;
      }
      ex.__dirty = false;
    }
    merged.push(mr);
  });
  existingById.forEach((ex, k) => {
    if (!seen.has(k)) merged.push(ex);
  });
  REQS = merged;
  const numericIds = REQS.map(r => Number(r?.v2Id ?? r?.id)).filter(n => Number.isFinite(n));
  nextId = numericIds.length ? Math.max(...numericIds) + 1 : 1;
  try { console.info("[FM] syncReqs: mapped", mapped.length, "merged", REQS.length); } catch (_) {}
}

let __histRehydrated = false;
async function tryRehydrateHistFromDeliveredOnce(){
  if (__histRehydrated) return;
  if ((HIST_DB || []).length > 0) { __histRehydrated = true; return; }
  const delivered = (REQS || []).filter(r => r.status === 'entregue');
  if (!delivered.length) { __histRehydrated = true; return; }
  const created = [];
  delivered.forEach(r => {
    const e = addReqToHistDB(r);
    if (e && e.id) created.push(e);
  });
  if (created.length) {
    await saveHistDB();
  }
  __histRehydrated = true;
}

function goTab(t){
  const root = getSeparacaoRoot();
  if (!root) return;
  if (!isTabAllowedForRole(getUserRole(), t)) return;
  root.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x.dataset.tab===t));
  root.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  const targetTab = root.querySelector('#tab-'+t);
  if (!targetTab) { console.warn('goTab: tab-'+t+' não encontrado'); return; }
  targetTab.classList.add('active');
  updateCounts();
  // Renderiza só a aba que foi ativada
  if(t==='ps') renderPS();
  else if(t==='es') renderES();
  else if(t==='pe') renderPE();
  else if(t==='hi') renderHI();
  else if(t==='rel') renderRelatorio();
  else if(t==='db') renderRelatorio();
  else if(t==='pan') buildPainel();
  else if(t==='bur') renderBuracos();
  else if(t==='unif') renderUnificar();
}
function updateCounts(){const c=s=>REQS.filter(r=>r.status===s).length;setB('c1',c('requisitado'));setB('c2',c('separando'));setB('c3',c('pronto'));setB('c4',c('entregue'))}
function setB(id,nn){const e=document.getElementById(id);if(!e)return;e.textContent=nn;if(nn>0){e.classList.remove('bg-gray-200','text-gray-700');e.classList.add('bg-blue-100','text-blue-700');}else{e.classList.remove('bg-blue-100','text-blue-700');e.classList.add('bg-gray-200','text-gray-700');}}
function renderAll(){
  applySeparacaoRoleUI();
  syncReqsFromCache();
  tryRehydrateHistFromDeliveredOnce();
  updateCounts();
  // Lazy render: só renderiza a aba ativa
  const root = getSeparacaoRoot();
  const activeTab = root?.querySelector('.tab.active')?.dataset.tab;
  if(activeTab === 'ps') renderPS();
  else if(activeTab === 'es') renderES();
  else if(activeTab === 'pe') renderPE();
  else if(activeTab === 'hi') renderHI();
  else if(activeTab === 'rel') renderRelatorio();
  else if(activeTab === 'db') renderRelatorio();
  else if(activeTab === 'pan') buildPainel();
  else { renderPS(); } // fallback
}

function renderPS(){
  const el=document.getElementById('lps');
  if(!el) return;
  const b=(document.getElementById('buscaPS')?.value||'').toLowerCase();
  const all=REQS.filter(r=>r.status==='requisitado' && (!b || r.unidade.toLowerCase().includes(b)));
  if(!all.length){el.innerHTML='<div class="empty"><div class="ic">📭</div>'+(b?'Nenhuma requisição encontrada para "'+esc(b)+'"':'Nenhuma requisição na fila.')+'</div>';return}
  const pg=paginate(all, PAGE_STATE.ps);
  const offset=(pg.page-1)*PAGE_SIZE;
  const canCancel = getUserRole() === 'admin';
  let h='<div class="tbl-wrap"><table class="qt"><thead><tr><th>#</th><th>Unidade</th><th>Tipos</th><th>Data</th><th>Itens</th><th>Ação</th></tr></thead><tbody>';
  pg.items.forEach((r,i)=>{const ni=Object.keys(r.items).length;const pos=offset+i;h+=`<tr class="${pos===0?'first-row':''}"><td style="text-align:center;font-weight:800;color:${pos===0?'var(--accent)':'#94a3b8'}">${pos+1}º</td><td style="font-weight:700">${esc(r.unidade)}</td><td>${tiposPills(r.tipos)}</td><td style="font-size:11px">${fdt(r.dt)}</td><td><span class="pill pr">${ni} itens</span></td><td style="display:flex;gap:6px"><button class="btn btn-p btn-sm" onclick="pegarParaSeparar(${jsArg(r.id)})">📦 Pegar</button>${canCancel?`<button class="btn btn-s btn-sm" style="color:var(--red);border-color:#fca5a5" onclick="cancelarReq(${jsArg(r.id)})" title="Cancelar">🗑️</button>`:''}</td></tr>`});
  h+='</tbody></table></div>';
  h+=paginationHTML('ps', pg.page, pg.total, pg.count);
  el.innerHTML=h;
}
function renderES(){
  const el=document.getElementById('les');
  if(!el) return;
  const b=(document.getElementById('buscaES')?.value||'').toLowerCase();
  const all=REQS.filter(r=>r.status==='separando' && (!b || r.unidade.toLowerCase().includes(b)));
  if(!all.length){el.innerHTML='<div class="empty"><div class="ic">🔧</div>'+(b?'Nenhum encontrado para "'+esc(b)+'"':'Nenhum em separação.')+'</div>';return}
  const pg=paginate(all, PAGE_STATE.es);
  const canCancel = getUserRole() === 'admin';
  let h='<div class="tbl-wrap"><table class="qt"><thead><tr><th>Unidade</th><th>Tipos</th><th>Separador</th><th>Resumo</th><th>Ações</th></tr></thead><tbody>';
  pg.items.forEach(r=>{const v=Object.values(r.items);h+=`<tr><td style="font-weight:700">${esc(r.unidade)}</td><td>${tiposPills(r.tipos)}</td><td>${esc(r.separador)}</td><td>${sumHTML(v)}</td><td style="display:flex;gap:6px"><button class="btn btn-p btn-sm" onclick="abrirFicha(${jsArg(r.id)})">📝 Editar</button><button class="btn btn-s btn-sm" onclick="printReq(${jsArg(r.id)})" title="Imprimir">🖨️</button><button type="button" class="btn btn-g btn-sm" onclick="marcarProntoLista(${jsArg(r.id)}, event)" title="Marcar Pronto">✅</button>${canCancel?`<button class="btn btn-s btn-sm" style="color:var(--red);border-color:#fca5a5" onclick="cancelarReq(${jsArg(r.id)})" title="Cancelar">🗑️</button>`:''}</td></tr>`});
  h+='</tbody></table></div>';
  h+=paginationHTML('es', pg.page, pg.total, pg.count);
  el.innerHTML=h;
}
function renderPE(){
  const el=document.getElementById('lpe');
  if(!el) return;
  const b=(document.getElementById('buscaPE')?.value||'').toLowerCase();
  const all=REQS.filter(r=>r.status==='pronto' && (!b || r.unidade.toLowerCase().includes(b)));
  if(!all.length){el.innerHTML='<div class="empty"><div class="ic">✅</div>'+(b?'Nenhum encontrado para "'+esc(b)+'"':'Nenhum aguardando retirada.')+'</div>';return}
  const pg=paginate(all, PAGE_STATE.pe);
  const canCancel = getUserRole() === 'admin';
  let h='<div class="tbl-wrap"><table class="qt"><thead><tr><th>Unidade</th><th>Tipos</th><th>Separador</th><th>Resumo</th><th>Ação</th></tr></thead><tbody>';
  pg.items.forEach(r=>{const v=Object.values(r.items);h+=`<tr><td style="font-weight:700">${esc(r.unidade)}</td><td>${tiposPills(r.tipos)}</td><td>${esc(r.separador)}</td><td>${sumHTML(v)}</td><td style="display:flex;gap:6px"><button class="btn btn-s btn-sm" onclick="printReq(${jsArg(r.id)})" title="Imprimir">🖨️</button><button class="btn btn-r btn-sm" onclick="entregarReq(${jsArg(r.id)})">📦 Entregar</button><button class="btn btn-s btn-sm" onclick="voltarSeparacao(${jsArg(r.id)})" title="Voltar p/ Separação">↩️</button>${canCancel?`<button class="btn btn-s btn-sm" style="color:var(--red);border-color:#fca5a5" onclick="cancelarReq(${jsArg(r.id)})" title="Cancelar">🗑️</button>`:''}</td></tr>`});
  h+='</tbody></table></div>';
  h+=paginationHTML('pe', pg.page, pg.total, pg.count);
  el.innerHTML=h;
}
function renderHI(){
  const el=document.getElementById('lhi');
  if(!el) return;
  const b=(document.getElementById('buscaHI')?.value||'').toLowerCase();
  const all=REQS.filter(r=>r.status==='entregue' && (!b || r.unidade.toLowerCase().includes(b)));
  // Mais recentes primeiro
  all.sort((a,c)=>(c.dtEntrega||c.dt)-(a.dtEntrega||a.dt));
  if(!all.length){el.innerHTML='<div class="empty"><div class="ic">📁</div>'+(b?'Nenhuma entrega encontrada para "'+esc(b)+'"':'Nenhuma entrega registrada.')+'</div>';return}
  const pg=paginate(all, PAGE_STATE.hi);
  const isAdmin = getUserRole() === 'admin';
  let h='<div class="tbl-wrap"><table class="qt"><thead><tr><th>Unidade</th><th>Tipos</th><th>Separador</th><th>Retirado por</th><th>Data</th><th>Resumo</th><th></th></tr></thead><tbody>';
  pg.items.forEach(r=>{const v=Object.values(r.items);h+=`<tr><td style="font-weight:700">${esc(r.unidade)}</td><td>${tiposPills(r.tipos)}</td><td>${esc(r.separador)}</td><td>${esc(r.retiradoPor)}</td><td style="font-size:11px">${fdt(r.dtEntrega||r.dt)}</td><td>${sumHTML(v)}</td><td style="display:flex;gap:6px;justify-content:flex-end"><button class="btn btn-s btn-sm" onclick="printReq(${jsArg(r.id)})" title="Reimprimir">🖨️</button>${isAdmin?`<button class="btn btn-s btn-sm" style="color:var(--red);border-color:#fca5a5" onclick="excluirHistoricoReq(${jsArg(r.id)})" title="Excluir do Histórico">🗑️</button>`:''}</td></tr>`});
  h+='</tbody></table></div>';
  h+=paginationHTML('hi', pg.page, pg.total, pg.count);
  el.innerHTML=h;
}

async function upsertUnitAlias(rawKey, canonicalName){
  if (getUserRole() !== 'admin') { toast('Permissão negada: apenas Admin.', 'red'); return false; }
  const k = rmAcc(String(rawKey||'').trim()).toUpperCase();
  if(!k) return false;
  const cn = String(canonicalName||'').trim();
  if(!cn) return false;
  HIST_ALIASES = getSemcasAliases() || HIST_ALIASES || {};
  HIST_ALIASES[k] = cn;
  try {
    await DataStore.set('aliases', HIST_ALIASES);
  } catch (e) {
    console.error(e);
    const code = String(e?.code || '');
    const msg = String(e?.message || '');
    toast('Erro ao salvar vínculo. ' + (code ? code + ': ' : '') + msg, 'red');
    return false;
  }
  try {
    const apply = (arr) => (arr||[]).forEach(e => (e.units||[]).forEach(u => { if (u && u.rawUnit) u.unitName = normalizeUnit(u.rawUnit) || u.unitName; }));
    apply(HIST_DB);
    if (window.__semcasHistDB && Array.isArray(window.__semcasHistDB)) apply(window.__semcasHistDB);
    invalidateAggCache();
  } catch (_) {}
  toast('Vínculo salvo.', 'green');
  return true;
}

async function removeUnitAlias(rawKey){
  if (getUserRole() !== 'admin') { toast('Permissão negada: apenas Admin.', 'red'); return false; }
  const k = rmAcc(String(rawKey||'').trim()).toUpperCase();
  if(!k) return false;
  HIST_ALIASES = getSemcasAliases() || HIST_ALIASES || {};
  if (!HIST_ALIASES[k]) return true;
  delete HIST_ALIASES[k];
  try {
    await DataStore.set('aliases', HIST_ALIASES);
  } catch (e) {
    console.error(e);
    const code = String(e?.code || '');
    const msg = String(e?.message || '');
    toast('Erro ao remover vínculo. ' + (code ? code + ': ' : '') + msg, 'red');
    return false;
  }
  try {
    const apply = (arr) => (arr||[]).forEach(e => (e.units||[]).forEach(u => { if (u && u.rawUnit) u.unitName = normalizeUnit(u.rawUnit) || u.unitName; }));
    apply(HIST_DB);
    if (window.__semcasHistDB && Array.isArray(window.__semcasHistDB)) apply(window.__semcasHistDB);
    invalidateAggCache();
  } catch (_) {}
  toast('Vínculo removido.', 'green');
  return true;
}

function renderVinculos(){
  const el = document.getElementById('vincList');
  if(!el) return;
  HIST_ALIASES = getSemcasAliases() || HIST_ALIASES || {};
  const busca = (document.getElementById('vincBusca')?.value||'').toLowerCase();
  const modo = document.getElementById('vincFiltro')?.value || 'pendentes';
  const unidades = (getUnidades() || []).filter(u => (u?.atendeMateriais ?? true) === true);
  const unitByName = new Map(unidades.map(u => [String(u.nome||u.unidadeNome||'').toLowerCase(), u]));
  const hist = getSemcasHistDB() || [];
  const cand = new Map();
  const add = (raw) => {
    const s = String(raw || '').trim().replace(/\s+/g,' ');
    if(!s) return;
    const k = rmAcc(s).toUpperCase();
    if(!cand.has(k)) cand.set(k, { k, raw: s });
  };
  hist.forEach(e => (e.units||[]).forEach(u => add(u.rawUnit || u.unitName)));
  if (tmpParsed?.unitName) add(tmpParsed.unitName);
  let list = [...cand.values()];
  if (busca) list = list.filter(x => x.raw.toLowerCase().includes(busca) || String(HIST_ALIASES[x.k]||'').toLowerCase().includes(busca));
  if (modo === 'pendentes') {
    list = list.filter(x => {
      if (HIST_ALIASES[x.k]) return false;
      const n = normalizeUnit(x.raw);
      return !unitByName.has(String(n||'').toLowerCase());
    });
  }
  list.sort((a,b) => a.raw.localeCompare(b.raw, 'pt-BR'));
  if(!list.length){el.innerHTML='<div class="empty"><div class="ic">🔗</div>Nenhum vínculo pendente.</div>';return;}
  let h='<div class="tbl-wrap"><table class="qt"><thead><tr><th>Nome na planilha</th><th>Vincular à unidade</th><th>Tipo</th><th></th></tr></thead><tbody>';
  list.forEach((x,idx) => {
    const mapped = HIST_ALIASES[x.k] || '';
    const auto = (() => {
      const n = normalizeUnit(x.raw);
      return unitByName.has(String(n||'').toLowerCase()) ? n : '';
    })();
    const sel = mapped || auto || '';
    h += `<tr><td style="font-weight:700">${esc(x.raw)}</td><td><select class="sel" style="min-width:260px" data-vk="${esc(x.k)}" data-vraw="${esc(x.raw)}" data-vsel="${esc(sel)}"><option value="">— Selecione —</option>${unidades.map(u=>`<option value="${esc(u.nome||u.unidadeNome||'')}">${esc(u.nome||u.unidadeNome||'')}</option>`).join('')}</select></td><td data-vtipo style="color:#64748b;font-size:12px"></td><td style="display:flex;gap:6px;justify-content:flex-end"><button class="btn btn-p btn-sm" type="button" data-vsave="${esc(x.k)}">💾 Salvar</button>${HIST_ALIASES[x.k]?`<button class="btn btn-s btn-sm" type="button" data-vdel="${esc(x.k)}" style="color:var(--red);border-color:#fecaca">✕ Remover</button>`:''}</td></tr>`;
  });
  h += '</tbody></table></div>';
  el.innerHTML = h;
  el.querySelectorAll('select[data-vk]').forEach(sel => {
    sel.value = sel.dataset.vsel || '';
    const tr = sel.closest('tr');
    const tipoEl = tr?.querySelector('[data-vtipo]');
    const refresh = () => {
      if (!tipoEl) return;
      const u = unitByName.get(String(sel.value||'').toLowerCase());
      tipoEl.textContent = u?.tipo || u?.tipoUnidade || '';
    };
    sel.addEventListener('change', refresh);
    refresh();
  });
  el.querySelectorAll('button[data-vsave]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const k = btn.getAttribute('data-vsave');
      const sel = [...el.querySelectorAll('select[data-vk]')].find(s => s.getAttribute('data-vk') === k);
      const canon = sel?.value || '';
      if (!canon) { toast('Selecione uma unidade.', 'red'); return; }
      const ok = await upsertUnitAlias(k, canon);
      if (ok) renderVinculos();
    });
  });
  el.querySelectorAll('button[data-vdel]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const k = btn.getAttribute('data-vdel');
      if(!confirm('Remover este vínculo?')) return;
      const ok = await removeUnitAlias(k);
      if (ok) renderVinculos();
    });
  });
}

// ═══════════════════════════════════════════════════════════════════
// FLUXO
// ═══════════════════════════════════════════════════════════════════
function findReq(id){return REQS.find(x=>String(x.id)===String(id))}
function serializeReqForStore(r){return deepCleanForFirestore({...r,dt:r.dt?.toISOString?.()||r.dt,dtEntrega:r.dtEntrega?.toISOString?.()||r.dtEntrega,parsed:stripVolatileParsed(r.parsed)})}
async function persistReq(r){
  try{await DataStore.set('reqs',[serializeReqForStore(r)]);return true}catch(e){
    console.warn('Erro ao salvar requisição:',e);
    const code=String(e?.code||''),msg=String(e?.message||'');
    toast('Erro ao salvar no Firestore. '+(code?code+': ':'')+msg,'red');
    return false;
  }
}
const debouncedPersistCurrent=debounce(()=>{if(!curId)return;const r=findReq(curId);if(r)persistReq(r)},700);
function markDirty(r){if(!r)return;r.__dirty=true;r.__dirtyAt=Date.now();}

function pegarParaSeparar(reqId){const f=reqId?REQS.find(r=>String(r.id)===String(reqId)&&r.status==='requisitado'):REQS.find(r=>r.status==='requisitado');if(!f)return;showModal('Nome do Separador','Quem vai separar?','',async nm=>{f.separador=nm;f.status='separando';markDirty(f);await persistReq(f);printReq(f.id);toast(f.unidade+' → Em Separação','green');goTab('es')})}

function abrirFicha(id, readOnly = false){
  curId=id;const r=findReq(id);if(!r)return;
  document.getElementById('fichaTitle').textContent=(readOnly ? '👁️ ' : '📋 ') + r.unidade + (r.separador ? ' — ' + r.separador : '');
  
  // Hide actions if readOnly
  const actions = document.getElementById('fichaModalActions');
  const legend = document.getElementById('fichaModalLegend');
  if (actions) actions.style.display = readOnly ? 'none' : 'flex';
  if (legend) legend.style.display = readOnly ? 'none' : 'block';
  
  document.getElementById('fichaBody').innerHTML=buildFichaHTML(r, readOnly);
  document.getElementById('fichaModal').classList.add('open');
  updateStats();
  
  if (!readOnly) {
    document.getElementById('fichaBody').querySelectorAll('tr[data-id]').forEach(row=>{
      const iid=+row.getAttribute('data-id');
      row.querySelector('.ficha-input-qty')?.addEventListener('change',function(){editQty(iid,this.value)});
      row.querySelector('.badge-status')?.addEventListener('click',function(){cycleStatus(iid,this)});
      row.querySelector('.ficha-input-obs')?.addEventListener('change',function(){editObs(iid,this.value)});
    });
  }
}
function fecharFicha(){document.getElementById('fichaModal').classList.remove('open');curId=null;renderAll()}
const fichaModalEl = document.getElementById('fichaModal');
if (fichaModalEl) {
  fichaModalEl.addEventListener('click',e=>{if(e.target.id==='fichaModal')fecharFicha()});
}
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&document.getElementById('fichaModal')?.classList.contains('open'))fecharFicha()});

function buildFichaHTML(r,isPrint){
  const d=r.parsed,items=r.items;
  const fmtDateOnly=(v)=>{const dt=v instanceof Date?v:(typeof v==='string'?new Date(v):null);return dt&& !isNaN(dt.getTime())?dt.toLocaleDateString('pt-BR'):''};
  const pedido=fmtDateOnly(r.dt)||today();
  const entrega=fmtDateOnly(r.dtEntrega)||'—';
  const perLbl=r.periodLabel?esc(r.periodLabel):'';
  const reqId=esc(r.v2Id||r.id||'');
  const base = typeof location!=='undefined' ? location.href.split('?')[0].replace(/[^/]*$/, '') : '/';
  const logoUrl = base + 'brasao-sao-luis.png';
  const logoUrlAlt = base + 'dist/brasao-sao-luis.png';
  const totalItens=(d?.categories||[]).reduce((s,c)=>s+(c?.items?.length||0),0);
  const hdr=
    totalItens>=80 ? { img: 42, t1: 10, t2: 8, t3: 8, t4: 8, lh: 1.05, mb: 4 } :
    totalItens>=55 ? { img: 52, t1: 11, t2: 9, t3: 9, t4: 9, lh: 1.08, mb: 5 } :
    { img: 64, t1: 12, t2: 10, t3: 10, t4: 10, lh: 1.12, mb: 6 };
  let h=`<div style="text-align:center;margin-bottom:${hdr.mb}px">`
    +`<img src="${esc(logoUrl)}" alt="Brasão de São Luís" onerror="this.onerror=null;this.src='${logoUrlAlt}'" style="display:block;margin:0 auto 6px;width:${hdr.img}px;height:auto">`
    +`<div style="line-height:${hdr.lh};text-transform:uppercase">`
    +`<div style="font-size:${hdr.t1}px;font-weight:800">PREFEITURA DE SÃO LUÍS</div>`
    +`<div style="font-size:${hdr.t2}px;font-weight:800">SECRETARIA MUNICIPAL DA CRIANÇA E ASSISTÊNCIA SOCIAL - SEMCAS</div>`
    +`<div style="font-size:${hdr.t3}px;font-weight:800">SUPERINTENDÊNCIA ADMINISTRATIVA - SA</div>`
    +`<div style="font-size:${hdr.t4}px;font-weight:800">COORDENAÇÃO DE ADMINISTRAÇÃO E PATRIMÔNIO</div>`
    +`</div>`
    +`</div>`;
  h+=`<div class="ficha-header"><div><h1>FICHA DE SEPARAÇÃO DE MATERIAIS</h1><div class="ficha-unit">${esc(d.unitName)}</div></div><div style="text-align:right;font-size:11px;color:#64748b">Pedido: <b>${pedido}</b><br>Entrega: <b>${entrega}</b>${perLbl?`<br><span style="font-size:10px;color:#64748b">📅 ${perLbl}</span>`:''}${reqId?`<br><span style="font-size:10px;color:#64748b">ID: <b>${reqId}</b></span>`:''}<br><span style="font-size:9px;color:#94a3b8">${esc(d.fileName||'')}</span></div></div>`;
  const sep = esc(r.separador||'');
  const ent = esc(r.entreguePor||'');
  const ret = esc(r.retiradoPor||'');
  h+=`<div class="ficha-info-bar"><span><b>Separador:</b> ${sep}</span>${ent?`<span style="color:#64748b">|</span><span><b>Entregue por:</b> ${ent}</span>`:''}${ret?`<span style="color:#64748b">|</span><span><b>Retirado por:</b> ${ret}</span>`:''}<span style="color:#64748b">|</span><span><b>Tipos:</b> ${tiposPills(r.tipos)}</span></div>`;
  d.categories.forEach(cat=>{
    let catItems = cat.items.map(x => items[x.id]).filter(m => !!m);
    if(isPrint && r.status === 'separando') {
      catItems = catItems.filter(m => m.status !== 'sem_estoque' && m.status !== 'nao_atendido');
    }
    if(catItems.length === 0) return; // skip empty categories
    
    h+=`<div class="ficha-cat">${esc(cat.name)}</div><table class="ficha-table"><thead><tr><th class="col-num">#</th><th class="col-mat">Material</th><th class="col-unid">Unid.</th><th class="col-sol">Solicit.</th><th class="col-ate">Qtd. Atendida</th><th class="col-status">Status</th><th class="col-obs">Obs</th></tr></thead><tbody>`;
    catItems.forEach((m,i)=>{
      const originalId = Object.keys(items).find(key => items[key] === m);
      h+=`<tr class="${rc2(m.status)}" data-id="${originalId}"><td class="col-num" style="color:#94a3b8;font-weight:600;font-size:10px">${i+1}</td><td class="col-mat" style="font-weight:600">${esc(m.material)}</td><td class="col-unid" style="color:#64748b;font-size:10px">${esc(m.unidade)}</td><td class="col-sol" style="font-weight:700;color:#1e40af">${esc(m.qtdSolicitada)}</td>`;
      if(isPrint){const qaDisplay=m.qtdAtendida?esc(m.qtdAtendida):'<span style="display:inline-block;width:90%;border-bottom:1px dotted #94a3b8;min-height:14px">&nbsp;</span>';h+=`<td class="col-ate" style="font-weight:700">${qaDisplay}</td><td class="col-status" style="overflow:visible"><span class="${bc2(m.status)}" style="cursor:default;display:inline-block;max-width:100%;white-space:normal;line-height:1.05">${sl(m.status)}</span></td><td class="col-obs" style="font-size:10px;color:#475569">${esc(m.obs||'')}</td>`}
      else{h+=`<td class="col-ate" style="padding:2px 4px"><input class="ficha-input-qty${m.status==='sem_estoque'?' no-stock':''}" value="${esc(m.qtdAtendida)}" placeholder="—"></td><td class="col-status" style="padding:2px;overflow:visible"><span class="${bc2(m.status)}" style="display:inline-block;max-width:100%;white-space:normal;line-height:1.05">${sl(m.status)}</span></td><td class="col-obs" style="padding:2px 4px"><input class="ficha-input-obs" value="${esc(m.obs)}" placeholder="Obs..."></td>`}
      h+=`</tr>`;
    });
    h+=`</tbody></table>`;
  });
  const v=Object.values(items);
  h+=`<div class="ficha-summary"><b>Resumo:</b> ${sumText(v)}</div>`;
  if (isPrint && r.status === 'separando') {
    h+=`<div class="ficha-sigs">`
      +`<div class="ficha-sig"><div class="ficha-sig-line"></div><div class="ficha-sig-label">Separado por${sep?'<br><b style="font-size:11px;color:#0f172a">'+sep+'</b>':''}</div></div>`
      +`<div class="ficha-sig"></div>`
      +`<div class="ficha-sig"><div class="ficha-sig-line"></div><div class="ficha-sig-label">Recebido por (assinatura)</div></div>`
      +`</div>`;
  } else if (isPrint) {
    h+=`<div class="ficha-sigs">`
      +`<div class="ficha-sig"><div class="ficha-sig-line" style="border-bottom:none;min-height:0"></div><div class="ficha-sig-label">Separado por${sep?'<br><b style="font-size:11px;color:#0f172a">'+sep+'</b>':''}</div></div>`
      +`<div class="ficha-sig"><div class="ficha-sig-line"></div><div class="ficha-sig-label">Entregue por (assinatura)${ent?'<br><b style="font-size:11px;color:#0f172a">'+ent+'</b>':''}</div></div>`
      +`<div class="ficha-sig"><div class="ficha-sig-line"></div><div class="ficha-sig-label">Recebido por (assinatura)${ret?'<br><b style="font-size:11px;color:#0f172a">'+ret+'</b>':''}</div></div>`
      +`</div>`;
  } else {
    h+=`<div class="ficha-sigs">`
      +`<div class="ficha-sig"><div class="ficha-sig-line" style="border-bottom:none;min-height:0"></div><div class="ficha-sig-label">Separado por${sep?'<br><b style="font-size:11px;color:#0f172a">'+sep+'</b>':''}</div></div>`
      +`<div class="ficha-sig"><div class="ficha-sig-line" style="border-bottom:none;min-height:0"></div><div class="ficha-sig-label">Entregue por${ent?'<br><b style="font-size:11px;color:#0f172a">'+ent+'</b>':''}</div></div>`
      +`<div class="ficha-sig"><div class="ficha-sig-line" style="border-bottom:none;min-height:0"></div><div class="ficha-sig-label">Recebido por${ret?'<br><b style="font-size:11px;color:#0f172a">'+ret+'</b>':''}</div></div>`
      +`</div>`;
  }
  return h;
}

function cycleStatus(id,el){
  const r=findReq(curId);if(!r)return;
  const order=['nao_atendido','atendido','parcial','sem_estoque','excedido'];
  const nx=order[(order.indexOf(r.items[id].status)+1)%order.length];
  r.items[id].status=nx;
  if(nx==='sem_estoque'){r.items[id].qtdAtendida='0';}
  const tr=el.closest('tr'),qi=tr.querySelector('.ficha-input-qty');
  tr.className=rc2(nx);el.className=bc2(nx);el.textContent=sl(nx);
  if(qi){
    qi.classList.toggle('no-stock',nx==='sem_estoque');
    if(nx==='sem_estoque')qi.value='0';
  }
  updateStats();
  markDirty(r);
  debouncedPersistCurrent();
}
function editQty(id,v){
  const r=findReq(curId);if(!r)return;
  r.items[id].qtdAtendida=v;
  if(r.items[id].status==='sem_estoque')r.items[id].status='nao_atendido';
  autoDetect(id);
  updateStats();
  markDirty(r);
  debouncedPersistCurrent();
}
function editObs(id,v){const r=findReq(curId);if(r){r.items[id].obs=v;markDirty(r);debouncedPersistCurrent();}}
function isEmpty(v){
  const s=String(v||'').trim();
  return s===''||s==='-'||s==='—'||s==='0'||s==='00.'||s.toLowerCase()==='nt';
}
function autoDetect(id){
  const r=findReq(curId);if(!r)return;
  const m=r.items[id];
  if(m.status==='sem_estoque')return;
  const rawA=String(m.qtdAtendida||'').trim();
  if(!rawA||rawA==='-'||rawA==='—'){m.status='nao_atendido';}
  else{
    const s=extractNum(m.qtdSolicitada),a=extractNum(m.qtdAtendida);
    if(a===0)      m.status='nao_atendido';
    else if(s>0&&a>s) m.status='excedido';
    else if(s>0&&a<s) m.status='parcial';
    else               m.status='atendido';
  }
  const tr=document.querySelector(`#fichaBody tr[data-id="${id}"]`);
  if(tr){const b=tr.querySelector('.badge-status');tr.className=rc2(m.status);if(b){b.className=bc2(m.status);b.textContent=sl(m.status)}}
}
function updateStats(){
  const r=findReq(curId);if(!r)return;const v=Object.values(r.items);
  document.getElementById('fichaStats').innerHTML=`<span class="fstat fs-t">Total: <b>${v.length}</b></span><span class="fstat fs-ok">✓ ${v.filter(i=>i.status==='atendido').length}</span><span class="fstat fs-pa">◐ ${v.filter(i=>i.status==='parcial').length}</span><span class="fstat fs-se">✗ ${v.filter(i=>i.status==='sem_estoque').length}</span><span class="fstat fs-na">⊘ ${v.filter(i=>i.status==='nao_atendido').length}</span><span class="fstat" style="background:#451a03;color:#fcd34d">↑ ${v.filter(i=>i.status==='excedido').length}</span>`;
}

function marcarPronto(e){
  if(e && e.preventDefault) e.preventDefault();
  if(e && e.stopPropagation) e.stopPropagation();
  const r=findReq(curId);if(!r)return;
  if(!confirm('Tem certeza que deseja marcar como Pronto?')) return;
  Object.keys(r.items).forEach(id=>autoDetect(id));
  Object.values(r.items).forEach(i=>{
    if(i.status==='nao_atendido'&&!String(i.qtdAtendida||'').trim())i.status='nao_atendido';
  });
  r.status='pronto';
  markDirty(r);
  persistReq(r);
  curId=null;
  document.getElementById('fichaModal').classList.remove('open');
  toast(r.unidade+' → Pronto!','green');
  goTab('pe');
}
function marcarProntoLista(id, e){
  if(e && e.preventDefault) e.preventDefault();
  if(e && e.stopPropagation) e.stopPropagation();
  const r=findReq(id);if(!r)return;
  if(!confirm('Tem certeza que deseja marcar como Pronto?')) return;
  r.status='pronto';markDirty(r);persistReq(r);toast(r.unidade+' → Pronto!','green');renderAll();
}
function voltarSeparacao(id){const r=findReq(id);if(!r)return;r.status='separando';markDirty(r);persistReq(r);toast(r.unidade+' ↩️ Voltou para Separação','green');goTab('es')}

function entregarReq(id){
  const r0=findReq(id);if(!r0)return;
  const askEntreguePor=()=>{
    showModal('Entregue por (Almoxarifado)','Nome de quem está entregando:',''+(r0.entreguePor||''),nmEntRaw=>{
      const nmEnt=String(nmEntRaw||'').trim();
      if(!nmEnt){toast('Informe quem está entregando.','red');return askEntreguePor();}
      const r=findReq(id);if(!r)return;
      r.entreguePor=nmEnt;
      showModal('Quem está retirando?','Nome de quem veio buscar:',''+(r.retiradoPor||''),async nmRaw=>{
        const nm=String(nmRaw||'').trim();
        if(!nm){toast('Informe quem está retirando.','red');return askEntreguePor();}
        const r2=findReq(id);if(!r2)return;
        r2.retiradoPor=nm;
        Object.keys(r2.items||{}).forEach((k)=>{
          const it=r2.items[k];
          if(!it||it.status==='sem_estoque')return;
          const rawA=String(it.qtdAtendida||'').trim();
          if(!rawA||rawA==='-'||rawA==='—'){it.status='nao_atendido';return;}
          const s=extractNum(it.qtdSolicitada),a=extractNum(it.qtdAtendida);
          if(a===0) it.status='nao_atendido';
          else if(s>0&&a>s) it.status='excedido';
          else if(s>0&&a<s) it.status='parcial';
          else it.status='atendido';
        });
      r2.status='entregue';
      r2.dtEntrega=new Date();
      markDirty(r2);
      try { console.info("[FM] entregarReq start:", r2.id, "itens:", Object.keys(r2.items||{}).length); } catch (_) {}
    
      let entryToSave = null;
      if (!r2.histEntryId) {
         const entry = addReqToHistDB(r2);
         r2.histEntryId = entry?.id || null;
         entryToSave = entry;
      } else {
         entryToSave = HIST_DB.find(e => e.id === r2.histEntryId) || null;
         if (!entryToSave) {
           const entry = addReqToHistDB(r2);
           r2.histEntryId = entry?.id || r2.histEntryId;
           entryToSave = entry;
         }
      }
      try { console.info("[FM] entregarReq histEntry:", r2.histEntryId||null, "entry ok?", !!entryToSave); } catch (_) {}
      if (entryToSave && (!r2.dbAdded || entryToSave.id === r2.histEntryId)) {
         const okHist = await saveHistEntry(entryToSave);
         if (okHist) r2.dbAdded = true;
      }
      await persistReq(r2);
      try { console.info("[FM] entregarReq done req:", r2.id, "dbAdded:", !!r2.dbAdded); } catch (_) {}
    
      const nItens = Object.values(r2.items).filter(i=>i.status==='atendido'||i.status==='parcial'||i.status==='excedido').length;
      const nZero = Object.values(r2.items).filter(i=>i.status==='sem_estoque'||i.status==='nao_atendido').length;
      toast(r2.unidade+' entregue para '+nm+' · '+nItens+' itens → banco | '+nZero+' sem atendimento','green');
      
      // Abre a impressão do comprovante (via do almoxarifado) com as assinaturas prontas
      printReq(r2.id);
      
      renderAll();
      try { buildPainel(); } catch (_) {}
      try { renderRelatorio(); } catch (_) {}
      if (getUserRole() === 'admin') goTab('hi');
      })
    });
  };
  askEntreguePor();
}

function printFicha(){const r=findReq(curId);if(r)printReq(r.id)}
function printReq(id){
  const r=findReq(id);if(!r)return;
  const html='<div class="ficha-a4">'+buildFichaHTML(r,true)+'</div>';
  
  const w=window.open('','_blank','width=850,height=1100');
  if(!w){toast('Permita popups!','red');return}
  w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>SEMCAS</title><style>
*{box-sizing:border-box;margin:0;padding:0}body{font-family:'Segoe UI',system-ui,sans-serif;color:#0f172a;padding:8mm;background:#fff;font-size:12px}
.ficha-a4{max-width:794px;margin:0 auto}
.ficha-header{border-bottom:3px solid #0f172a;padding-bottom:10px;margin-bottom:12px;display:flex;justify-content:space-between}.ficha-header h1{font-size:15px;font-weight:800;margin:0}.ficha-unit{font-size:12px;color:#475569;font-weight:600;margin-top:2px}
.ficha-info-bar{display:flex;gap:12px;margin-bottom:10px;font-size:12px;align-items:center;flex-wrap:wrap}
.ficha-cat{background:#0f172a;color:#fff;padding:4px 10px;font-size:10px;font-weight:800;letter-spacing:.5px;text-transform:uppercase;border-radius:4px 4px 0 0;margin-top:10px}
.ficha-table{width:100%;border-collapse:collapse;font-size:11px;margin-bottom:2px;table-layout:fixed}
.ficha-table th{padding:4px 6px;font-size:9px;font-weight:800;color:#475569;text-align:center;border-bottom:2px solid #cbd5e1;text-transform:uppercase;background:#f1f5f9}.ficha-table th:nth-child(2){text-align:left}
.ficha-table td{padding:4px 6px;border-bottom:1px solid #e2e8f0;vertical-align:middle;overflow:hidden}
.ficha-table thead{display:table-header-group}
.ficha-table tfoot{display:table-footer-group}
.ficha-table tr{break-inside:avoid;page-break-inside:avoid}
.ficha-header,.ficha-info-bar{break-after:avoid-page;page-break-after:avoid}
.ficha-cat{break-after:avoid-page;page-break-after:avoid;break-inside:avoid;page-break-inside:avoid}
.col-mat,.col-obs{word-break:break-word;white-space:normal}
.col-num{width:4%;text-align:center}.col-mat{width:28%;text-align:left}.col-unid{width:7%;text-align:center}.col-sol{width:9%;text-align:center}.col-ate{width:14%;text-align:center}.col-status{width:10%;text-align:center}.col-obs{width:22%}
.row-atendido{background:#f0fdf4}.row-parcial{background:#fffbeb}.row-sem_estoque{background:#fff1f2}.row-nao_atendido{background:#f5f3ff}
.row-excedido{background:#fffbeb}
.badge-status{display:inline-block;padding:2px 7px;border-radius:4px;font-size:9px;font-weight:800;letter-spacing:.3px;text-transform:uppercase;border:1px solid}
.badge-nao_atendido{background:#ede9fe;color:#5b21b6;border-color:#c4b5fd}.badge-atendido{background:#d1fae5;color:#065f46;border-color:#6ee7b7}.badge-parcial{background:#fef3c7;color:#92400e;border-color:#fcd34d}.badge-sem_estoque{background:#fee2e2;color:#991b1b;border-color:#fca5a5}.badge-excedido{background:#fef9c3;color:#92400e;border-color:#fcd34d}
.badge-excedido{background:#fef3c7;color:#92400e;border-color:#fcd34d;border:1px solid}
.tipo-pill{display:inline-block;padding:2px 8px;border-radius:8px;font-size:9px;font-weight:700}.tipo-expediente{background:#dbeafe;color:#1e40af}.tipo-limpeza{background:#d1fae5;color:#065f46}.tipo-higiene{background:#fce7f3;color:#9d174d}.tipo-alimenticio{background:#fef3c7;color:#92400e}.tipo-descartavel{background:#e0e7ff;color:#3730a3}.tipo-atividades{background:#f3e8ff;color:#6b21a8}.tipo-outros{background:#f1f5f9;color:#475569}
.ficha-summary{margin-top:14px;padding:8px 10px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;font-size:11px}
.ficha-sigs{margin-top:24px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;font-size:10px}.ficha-sig{text-align:center}.ficha-sig-line{border-bottom:1px solid #0f172a;padding-bottom:3px;margin-bottom:3px;min-height:16px;font-weight:500}.ficha-sig-label{font-size:9px;color:#64748b;font-weight:600}
@page{size:A4 portrait;margin:5mm}@media print{ * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; color-adjust: exact !important; } body{padding:0} }
</style></head><body>${html}<script>window.onload=function(){setTimeout(function(){window.print()},50)};setTimeout(function(){window.print()},1500);<\/script></body></html>`);
  w.document.close();
}

function showModal(t,d,dv,cb){_mcb=cb;document.getElementById('mT').textContent=t;document.getElementById('mD').textContent=d;const i=document.getElementById('mI');i.value=dv||'';i.placeholder=t;document.getElementById('modal').classList.add('open');setTimeout(()=>i.focus(),100);i.onkeydown=e=>{if(e.key==='Enter')okModal()}}
function okModal(){const v=document.getElementById('mI').value.trim();if(!v)return;document.getElementById('modal').classList.remove('open');const cb=_mcb;_mcb=null;if(cb)cb(v)}
function closeModal(){document.getElementById('modal').classList.remove('open');_mcb=null}
function toast(msg,c){const t=document.createElement('div');t.textContent=msg;Object.assign(t.style,{position:'fixed',bottom:'20px',left:'50%',transform:'translateX(-50%)',background:c==='green'?'#059669':'#dc2626',color:'#fff',padding:'10px 24px',borderRadius:'10px',fontSize:'13px',fontWeight:'700',zIndex:'100000',boxShadow:'0 8px 24px rgba(0,0,0,.2)'});document.body.appendChild(t);setTimeout(()=>t.remove(),2500)}

// ═══════════════════════════════════════════════════════════════════
// RELATÓRIO E EXPORTAÇÃO CSV
// ═══════════════════════════════════════════════════════════════════
let HIST_DB=[], HIST_ALIASES={}, LAST_REPORT_DATA=[];
let HIST_DB_PARTIAL=false;
let HIST_DB_LOADING_ALL=false;

async function loadAllHistDBAndRefresh(){
  if(HIST_DB_LOADING_ALL)return;
  if(!confirm('Carregar todo o banco histórico? Isso pode demorar e consumir mais dados do Firebase.'))return;
  HIST_DB_LOADING_ALL=true;
  try{
    const all=[];
    let last=null;
    while(true){
      const q=last
        ? query(COLLECTIONS.semcasHistDB, orderBy('weekStart','desc'), startAfter(last), limit(450))
        : query(COLLECTIONS.semcasHistDB, orderBy('weekStart','desc'), limit(450));
      const snap=await getDocs(q);
      snap.docs.forEach(d=>all.push({id:d.id,...d.data()}));
      if(snap.docs.length<450)break;
      last=snap.docs[snap.docs.length-1];
    }
    HIST_DB=all;
    window.__semcasHistDB=all;
    window.__semcasHistDBPartial=false;
    HIST_DB_PARTIAL=false;
    invalidateAggCache();
    renderRelatorio();
    try{buildPainel()}catch(_){}
    toast('Banco completo carregado: '+all.length+' arquivo(s).','green');
  }catch(e){
    console.error(e);
    toast('Falha ao carregar banco completo.','red');
  }finally{
    HIST_DB_LOADING_ALL=false;
  }
}

function exportarCSV() {
  if (!LAST_REPORT_DATA || !LAST_REPORT_DATA.length) {
    toast('Nenhum dado para exportar. Gere o relatório primeiro.', 'red');
    return;
  }
  const mode = document.getElementById('rFiltMode').value;
  let rows = [];
  
  if(mode === 'standard' || mode === 'yearcomp') {
    rows = LAST_REPORT_DATA.map(r => ({
      Unidade: r.unit,
      Categoria: r.cat,
      Item: r.material,
      Planilhas: r.uWeeks,
      Total_Exato: r.total
    }));
  } else {
    rows = LAST_REPORT_DATA.map(r => ({
      Unidade: r.unit,
      Item: r.material,
      Total_Exato: r.total
    }));
  }

  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Relatorio");
  XLSX.writeFile(wb, "Relatorio_SEMCAS.xlsx");
}


// ═══════════════════════════════════════════════════════════════════
// BACKUP — Exportar / Importar
// ═══════════════════════════════════════════════════════════════════
async function exportBackup(){
  try{
    const data = await DataStore.exportAll();
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], {type:'application/json'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'SEMCAS_backup_'+new Date().toISOString().slice(0,10)+'.json';
    a.click();
    toast('Backup exportado com sucesso!', 'green');
  } catch(e){
    toast('Erro ao exportar: '+e.message, 'red');
  }
}

async function importBackup(evt){
  const file = evt.target.files[0]; if(!file) return;
  if(!confirm('Isto vai SUBSTITUIR todos os dados atuais pelo backup. Continuar?')) { evt.target.value=''; return; }
  const reader = new FileReader();
  reader.onload = async function(e){
    try{
      const data = JSON.parse(e.target.result);
      await DataStore.importAll(data);
      toast('Backup restaurado! '+( data.hist_db?.length||0)+' arquivos, '+(data.reqs?.length||0)+' requisições.', 'green');
      renderAll();
      renderRelatorio();
    } catch(err){
      toast('Erro ao importar: '+err.message, 'red');
    }
  };
  reader.readAsText(file);
  evt.target.value='';
}


// ═══════════════════════════════════════════════════════════════════
// SANITIZAÇÃO: Corrige datas impossíveis no banco existente
// Roda automaticamente no load e quando solicitado
// ═══════════════════════════════════════════════════════════════════
function sanitizeHistDB() {
  let nFixed = 0;
  
  HIST_DB.forEach(e => {
    if (!e.weekStart || !e.weekEnd) return;
    
    const ws = new Date(e.weekStart + 'T12:00:00');
    const we = new Date(e.weekEnd + 'T12:00:00');
    
    // IMPOSSÍVEL: data início depois da data fim
    if (ws > we) {
      // Recua o início em 1 mês
      ws.setMonth(ws.getMonth() - 1);
      e.weekStart = ws.getFullYear() + '-' + pad2(ws.getMonth()+1) + '-' + pad2(ws.getDate());
      
      // Recalcula label
      e.weekLabel = pad2(ws.getDate()) + '/' + pad2(ws.getMonth()+1) + ' a ' + pad2(we.getDate()) + '/' + pad2(we.getMonth()+1) + '/' + we.getFullYear();
      e.month = ws.getMonth() + 1;
      nFixed++;
    }
    
    // SUSPEITO: duração negativa ou > 60 dias (provavelmente erro de mês)
    const dur = (we - new Date(e.weekStart + 'T12:00:00')) / 86400000;
    if (dur < 0) {
      // Ainda impossível após fix — tenta re-parsear do nome do arquivo
      const p = parsePeriodFromFileName(e.fileName);
      if (p) {
        const fin = finalizePeriod(p, e.year || new Date().getFullYear());
        e.weekStart = fin.ws;
        e.weekEnd = fin.we;
        e.weekLabel = fin.label;
        e.month = fin.month;
        nFixed++;
      }
    }
  });
  
  return nFixed;
}

function recalcAllDates() {
  if (!confirm('Recalcular as datas de TODOS os ' + HIST_DB.length + ' arquivo(s) no banco?\n\nIsso vai re-parsear o nome de cada arquivo e corrigir datas impossíveis.\nDatas editadas manualmente podem ser sobrescritas.')) return;
  
  let nFixed = 0;
  const fy = new Date().getFullYear();
  
  HIST_DB.forEach(e => {
    // Tenta re-parsear do nome do arquivo
    const p = parsePeriodFromFileName(e.fileName);
    if (p) {
      const fin = finalizePeriod(p, e.year || fy);
      const oldWs = e.weekStart, oldWe = e.weekEnd;
      
      // Se o ano original era detectado, mantém
      if (!e.yearAssumed && e.year) fin.year = e.year;
      
      e.weekStart = fin.ws;
      e.weekEnd = fin.we;
      e.weekLabel = fin.label;
      e.month = fin.month;
      
      // Mantém o ano original se já estava correto
      if (!fin.yearAssumed || e.year) {
        // Reaplica o ano correto ao weekStart/weekEnd
        if (e.year && fin.yearAssumed) {
          e.weekStart = e.weekStart.replace(/^\d{4}/, String(e.year));
          e.weekEnd = e.weekEnd.replace(/^\d{4}/, String(e.year));
        }
      }
      
      if (oldWs !== e.weekStart || oldWe !== e.weekEnd) nFixed++;
    }
  });
  
  // Sanitizar resultado
  nFixed += sanitizeHistDB();
  
  invalidateAggCache();
  saveHistDB();
  renderRelatorio();
  toast(nFixed + ' data(s) recalculada(s)!', 'green');
}


// ═══════════════════════════════════════════════════════════════════
// EDITOR DE PLANILHA — Editar unidades, categorias, itens, qtd
// ═══════════════════════════════════════════════════════════════════
let _editingId = null;

function openEditor(entryId) {
  const e = HIST_DB.find(x => x.id === entryId);
  if (!e) { toast('Arquivo não encontrado.', 'red'); return; }
  _editingId = entryId;
  
  document.getElementById('editorTitle').textContent = '📝 ' + e.fileName;
  
  let h = '<div style="margin-bottom:12px;font-size:11px;color:var(--muted)">'
    + 'Período: <b>' + esc(e.weekLabel || '?') + '</b> · Ano: <b>' + e.year + '</b>'
    + ' · Edite os campos e clique Salvar.</div>';
  
  (e.units || []).forEach((u, ui) => {
    h += '<div class="ed-unit">';
    h += '<div class="ed-unit-hd">';
    h += '<span style="font-size:16px">' + classifyUnit(u.unitName).icon + '</span>';
    h += '<input value="' + esc(u.unitName) + '" data-field="unit-' + ui + '" style="flex:1;padding:4px 8px;border:1px solid var(--border);border-radius:4px;font-size:12px;font-weight:700;font-family:inherit">';
    h += '</div>';
    
    (u.categories || []).forEach((c, ci) => {
      h += '<div class="ed-cat">';
      h += '<div class="ed-cat-hd">';
      h += '<input value="' + esc(c.catName) + '" data-field="cat-' + ui + '-' + ci + '" style="flex:1;padding:3px 6px;border:1px solid var(--border);border-radius:4px;font-size:11px;font-weight:700;font-family:inherit">';
      h += '</div>';
      
      h += '<div style="display:grid;grid-template-columns:1fr 60px 30px;gap:4px;padding:2px 0;font-size:9px;color:var(--muted);font-weight:700"><span>Material</span><span style="text-align:center">Qtd</span><span></span></div>';
      
      (c.items || []).forEach((it, ii) => {
        h += '<div class="ed-item">';
        h += '<input value="' + esc(it.material) + '" data-field="mat-' + ui + '-' + ci + '-' + ii + '">';
        h += '<input type="number" value="' + (it.qty || 0) + '" data-field="qty-' + ui + '-' + ci + '-' + ii + '" style="text-align:center">';
        h += '<button class="del" onclick="edRemoveItem(' + ui + ',' + ci + ',' + ii + ')" title="Remover item">✕</button>';
        h += '</div>';
      });
      
      h += '<button style="margin-top:4px;font-size:10px;color:var(--accent);background:none;border:1px dashed var(--border);border-radius:4px;padding:3px 8px;cursor:pointer;font-family:inherit;width:100%" onclick="edAddItem(' + ui + ',' + ci + ')">+ Adicionar item</button>';
      h += '</div>';
    });
    
    h += '<button style="margin:8px 12px;font-size:10px;color:#059669;background:none;border:1px dashed #6ee7b7;border-radius:4px;padding:4px 10px;cursor:pointer;font-family:inherit" onclick="edAddCat(' + ui + ')">+ Adicionar categoria</button>';
    h += '</div>';
  });
  
  document.getElementById('editorBody').innerHTML = h;
  document.getElementById('editorModal').classList.add('open');
}

function closeEditor() {
  document.getElementById('editorModal').classList.remove('open');
  _editingId = null;
}

function saveEditor() {
  const e = HIST_DB.find(x => x.id === _editingId);
  if (!e) return;
  
  // Read all values from inputs
  (e.units || []).forEach((u, ui) => {
    const unitInput = document.querySelector('[data-field="unit-' + ui + '"]');
    if (unitInput) {
      u.unitName = unitInput.value.trim();
      u.rawUnit = u.rawUnit || u.unitName;
    }
    
    (u.categories || []).forEach((c, ci) => {
      const catInput = document.querySelector('[data-field="cat-' + ui + '-' + ci + '"]');
      if (catInput) c.catName = catInput.value.trim();
      
      (c.items || []).forEach((it, ii) => {
        const matInput = document.querySelector('[data-field="mat-' + ui + '-' + ci + '-' + ii + '"]');
        const qtyInput = document.querySelector('[data-field="qty-' + ui + '-' + ci + '-' + ii + '"]');
        if (matInput) it.material = matInput.value.trim();
        if (qtyInput) it.qty = parseFloat(qtyInput.value) || 0;
      });
      
      // Remove items with empty material
      c.items = (c.items || []).filter(it => it.material);
    });
    
    // Remove empty categories
    u.categories = (u.categories || []).filter(c => (c.items || []).length > 0);
  });
  
  // Remove empty units
  e.units = (e.units || []).filter(u => (u.categories || []).length > 0);
  
  invalidateAggCache();
  saveHistDB();
  closeEditor();
  renderRelatorio();
  toast('Planilha atualizada!', 'green');
}

function edRemoveItem(ui, ci, ii) {
  const e = HIST_DB.find(x => x.id === _editingId);
  if (!e) return;
  e.units[ui].categories[ci].items.splice(ii, 1);
  openEditor(_editingId); // Re-render
}

function edAddItem(ui, ci) {
  const e = HIST_DB.find(x => x.id === _editingId);
  if (!e) return;
  e.units[ui].categories[ci].items.push({ material: 'Novo Item', qty: 0 });
  openEditor(_editingId);
}

function edAddCat(ui) {
  const e = HIST_DB.find(x => x.id === _editingId);
  if (!e) return;
  e.units[ui].categories.push({ catName: 'Nova Categoria', items: [{ material: 'Novo Item', qty: 0 }] });
  openEditor(_editingId);
}

async function loadHistDB(){
  try{
    const s = await DataStore.get('hist_v4');
    if(s) HIST_DB = s;
    const a = await DataStore.get('aliases');
    if(a && typeof a === 'object' && !Array.isArray(a)) HIST_ALIASES = a;
    // Carregar requisições persistidas
    const rq = await DataStore.get('reqs');
    if(rq && Array.isArray(rq)) {
      REQS = rq.map(r => ({...r, dt: r.dt ? new Date(r.dt) : new Date(), dtEntrega: r.dtEntrega ? new Date(r.dtEntrega) : null}));
      const numericIds = REQS.map(r => Number(r?.v2Id ?? r?.id)).filter(n => Number.isFinite(n));
      nextId = numericIds.length ? Math.max(...numericIds) + 1 : 1;
    }
  } catch(e){
    console.warn('Erro DataStore', e);
  }
  // Migração localStorage → IndexedDB (legado)
  try {
    const ls = localStorage.getItem('semcas_hist_v4');
    if(ls && HIST_DB.length === 0) {
      HIST_DB = JSON.parse(ls);
      await saveHistDB();
      localStorage.removeItem('semcas_hist_v4');
      toast('Banco migrado com sucesso!','green');
    }
  } catch(e){}

  // Sanitizar datas impossíveis no banco existente
  const nSanitized = sanitizeHistDB();
  if (nSanitized > 0) {
    console.log('[SEMCAS] Sanitizadas ' + nSanitized + ' data(s) impossível(eis) no banco');
    saveHistDB();
  }
  
  renderAll();
  if(document.querySelector('.tab.active')?.dataset.tab === 'rel') renderRelatorio();
  if(document.querySelector('.tab.active')?.dataset.tab === 'db') renderRelatorio();
  if(document.querySelector('.tab.active')?.dataset.tab === 'pan') buildPainel();
}

async function saveHistDB(){
  try{
    const cleanHist = deepCleanForFirestore(HIST_DB);
    await DataStore.set('hist_v4', cleanHist);
    await DataStore.set('aliases', HIST_ALIASES);
    try { console.info("[FM] saveHistDB ok:", HIST_DB.length, "entries"); } catch (_) {}
    return true;
  } catch(e){
    const code = String(e?.code || '');
    const msg = String(e?.message || '');
    toast('Erro ao salvar os dados. ' + (code ? code + ': ' : '') + msg, 'red');
    return false;
  }
}

async function saveHistEntry(entry){
  try{
    const cleanEntry = deepCleanForFirestore(entry);
    await DataStore.set('hist_v4', [cleanEntry]);
    try { console.info("[FM] saveHistEntry ok:", entry?.id||null); } catch (_) {}
    return true;
  } catch(e){
    const code = String(e?.code || '');
    const msg = String(e?.message || '');
    toast('Erro ao salvar no banco histórico. ' + (code ? code + ': ' : '') + msg, 'red');
    return false;
  }
}

let __lastSaveReqsErrAt = 0;
async function saveReqs(){
  try{
    const serialized = REQS.map(r => deepCleanForFirestore({
      ...r,
      dt: r.dt?.toISOString(),
      dtEntrega: r.dtEntrega?.toISOString(),
      parsed: stripVolatileParsed(r.parsed)
    }));
    await DataStore.set('reqs', serialized);
    return true;
  } catch(e){
    console.warn('Erro ao salvar requisições:', e);
    const now = Date.now();
    if (now - __lastSaveReqsErrAt > 2500) {
      __lastSaveReqsErrAt = now;
      const code = String(e?.code || '');
      const msg = String(e?.message || '');
      toast('Erro ao salvar no Firestore. ' + (code ? code + ': ' : '') + msg, 'red');
    }
    return false;
  }
}

async function clearHistDB(){
  if(!confirm('Apagar todo o banco histórico? Esta ação não pode ser desfeita e removerá os arquivos do banco de dados na nuvem.'))return;
  
  HIST_DB=[]; 
  invalidateAggCache();
  renderRelatorio();
  
  let deletedCount = 0;
  try {
    deletedCount = await deleteAllSemcasHistDB();
    toast('Banco de dados completamente limpo (' + deletedCount + ' arquivos removidos).', 'green');
  } catch (err) {
    console.error("Erro ao limpar banco de dados:", err);
    toast('Erro ao tentar limpar o banco na nuvem.', 'red');
  }
  
  // Garante que o estado local está limpo de fato e salva
  await saveHistDB();
}

async function clearMateriaisDB(){
  if (getUserRole() !== 'admin') { toast('Permissão negada: apenas Admin.', 'red'); return; }
  if(!confirm('Apagar TODAS as requisições do banco "Materiais"? Isso remove: Para Separar, Em Separação, Pronto, Entregue. Esta ação não pode ser desfeita.'))return;
  const prevCount = REQS.length;
  REQS = [];
  renderAll();
  let deletedCount = 0;
  try {
    deletedCount = await deleteAllMateriaisDB();
    toast('Materiais limpo (' + deletedCount + ' requisição(ões) removida(s)).', 'green');
  } catch (err) {
    console.error("Erro ao limpar Materiais:", err);
    REQS = getMateriais() || [];
    try { renderAll(); } catch (_) {}
    const code = String(err?.code || '');
    const msg = String(err?.message || '');
    toast('Erro ao limpar Materiais. ' + (code ? code + ': ' : '') + msg, 'red');
    if (prevCount > 0) toast('Dica: verifique se o usuário é Admin e se as regras do Firestore permitem deletar.', 'red');
  }
}

function rmAcc(s){return String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'');}
function normMat(s){return rmAcc(s).trim().replace(/\s+/g,' ').toUpperCase().replace(/[^A-Z0-9\s\/().-]/g,'');}

// ─── Sinônimos de materiais (normalização inteligente) ───────
const MAT_SYNONYMS = [
  [/^DET\.?\s/i, 'DETERGENTE '],
  [/^PAP\.?\s*HIG/i, 'PAPEL HIGIENICO'],
  [/^SAB\.?\s*PO/i, 'SABAO EM PO'],
  [/^SAB\.?\s*LIQ/i, 'SABONETE LIQUIDO'],
  [/^DESINF\.?\s/i, 'DESINFETANTE '],
  [/^ESC\.?\s*DENT/i, 'ESCOVA DENTAL'],
  [/^CR\.?\s*DENT/i, 'CREME DENTAL'],
  [/^AG\.?\s*SAN/i, 'AGUA SANITARIA'],
  [/^ALV\.?\s/i, 'ALVEJANTE '],
  [/^LIMP\.?\s*MULT/i, 'LIMPADOR MULTIUSO'],
];
const _origNormMat = normMat;
normMat = function(s) {
  let r = _origNormMat(s);
  for (const [re, repl] of MAT_SYNONYMS) {
    if (re.test(r)) { r = r.replace(re, repl); break; }
  }
  return r;
};


const MONTHS_PT={jan:1,fev:2,mar:3,abr:4,mai:5,jun:6,jul:7,ago:8,set:9,out:10,nov:11,dez:12,janeiro:1,fevereiro:2,marco:3,'março':3,abril:4,maio:5,junho:6,julho:7,agosto:8,setembro:9,outubro:10,novembro:11,dezembro:12};
function parseMonthPT(s){const lo=rmAcc(String(s||'').toLowerCase().trim());return MONTHS_PT[lo]||MONTHS_PT[lo.substring(0,3)]||0;}
function pad2(n){return String(n).padStart(2,'0');}
function mkDate(y,m,d){return`${y}-${pad2(m)}-${pad2(d)}`;}
function weekMonth(e){
  if(e.weekStart&&e.weekStart.length>=7)return e.weekStart.substring(0,7);
  if(e.year&&e.month)return`${e.year}-${pad2(e.month)}`;
  return`${e.year||'????'}-01`;
}

const ABRIGO_REGEX = /abrigo|casa|resid[eê]ncia|acolher|rep[uú]blica|luz e vida|recanto|ilpi|cat|acolhimento|mulheres/i;
function isAbrigo(name) { return ABRIGO_REGEX.test(name); }

const UNIT_MAP=[
  [/resid[eê]ncia\s+inclusiva|^RI$/i,                           'Residência Inclusiva'],
  [/acolher\s+e\s+amar|acolher\s*amar|acolher\s+e\s+cuidar/i,  'Acolher e Amar'],
  [/casa\s+de\s+acolhida|^CAT$/i,                               'CAT – Casa de Acolhida Temporária'],
  [/pop\s*rua|abrigo\s+pop/i,                                   'Abrigo Pop Rua'],
  [/recanto\s+do\s+viver/i,                                     'Recanto do Viver'],
  [/longa\s+perman[eê]ncia|^ILPI$/i,                            'ILPI'],
  [/rep[uú]blica\s*(para\s+)?jovens|^REPUBLICA$/i,              'República para Jovens'],
  [/casa\s+de\s+passagem/i,                                     'Casa de Passagem'],
  [/elizangela|mulheres/i,                                      'Mulheres – Elizangela Cardoso'],
  [/luz\s+e\s+vida|execu[cç][aã]o\s+direta/i,                  'Luz e Vida'],
];
function normalizeUnit(raw){
  if(!raw)return'Desconhecida';
  const s=raw.trim().replace(/\s+/g,' ');
  const k=rmAcc(s).toUpperCase();
  if(HIST_ALIASES[k])return HIST_ALIASES[k];
  for(const [re,canon] of UNIT_MAP){if(re.test(s)||re.test(rmAcc(s)))return canon;}
  if(/^(fornecimento|data:|unidade de acolhimento$|separado|entregue|recebido)/i.test(s))return'Desconhecida';
  return s;
}

let _aliasesApplyKey = '';
function applyAliasesToHistDB(){
  const freshAliases = getSemcasAliases() || {};
  const aKeys = Object.keys(freshAliases).sort();
  let aKey = '' + aKeys.length;
  for (const k of aKeys) aKey += '|' + k + '=' + freshAliases[k];
  const h0 = HIST_DB && HIST_DB.length ? String(HIST_DB[0]?.id || '') : '';
  const h1 = HIST_DB && HIST_DB.length ? String(HIST_DB[HIST_DB.length - 1]?.id || '') : '';
  const applyKey = aKey + '::' + (HIST_DB?.length || 0) + '|' + h0 + '|' + h1;
  if (applyKey === _aliasesApplyKey) return false;
  _aliasesApplyKey = applyKey;
  HIST_ALIASES = freshAliases;
  let changed = false;
  (HIST_DB || []).forEach(e => (e.units || []).forEach(u => {
    if (!u) return;
    if (!u.rawUnit) u.rawUnit = u.unitName || '';
    const nn = normalizeUnit(u.rawUnit || u.unitName);
    if (nn && u.unitName !== nn) { u.unitName = nn; changed = true; }
  }));
  if (changed) invalidateAggCache();
  return changed;
}

const CAT_MAP=[
  [/higi[eê]ne.*pessoal|pessoal.*higi[eê]ne/i,                           'Higiene Pessoal'],
  [/higi[eê]ne.*limpeza|limpeza.*higi[eê]ne|higi[eê]ne\s+e\s+limpeza/i, 'Higiene e Limpeza'],
  [/enlatado/i,                                                           'Enlatados'],
  [/cereal|gr[aã]o|amido/i,                                              'Cereais/Grãos/Amido'],
  [/processado|industrial/i,                                              'Processados e Industrializados'],
  [/limpeza/i,                                                            'Material de Limpeza'],
  [/descart[aá]vel/i,                                                     'Material Descartável'],
  [/expediente/i,                                                         'Material de Expediente'],
  [/atividade|pcf|conviv/i,                                               'Atividades/Convivência'],
];
function normalizeCat(raw){
  if(!raw)return'Outros';
  const stripped=raw.replace(/^\d+\s*[-–—.]\s*/,'').trim();
  for(const [re,name] of CAT_MAP){if(re.test(stripped)||re.test(rmAcc(stripped)))return name;}
  return stripped||raw;
}

function parsePeriodText(text){
  text=String(text||'').replace(/[\n\r]+/g,' ').replace(/\s+/g,' ').trim();
  // Normalizar separadores: remove espaços ao redor de pontos/barras para matching uniforme
  const nt=text.replace(/\s*([\/.\-])\s*/g,'$1');
  let m;
  
  // 1. Range Duplo c/ Ano: "26/03 a 01/04/2024", "26.03 a 01.04.2024", "31/07 a 06/08/2023"
  m=nt.match(/(\d{1,2})[\/\.\-](\d{1,2})(?:[\/\.\-]\d{2,4})?\s*[aA]\s*(\d{1,2})[\/\.\-](\d{1,2})[\/\.\-](\d{2,4})/);
  if(m){
    const d1=+m[1],d2=+m[3],mo2=+m[4],y=+m[5]<100?2000+ +m[5]:+m[5];
    let mo1=+m[2];
    // Se mo1 === mo2 e d1 > d2, início é do mês anterior (ex: 31/08 a 06/08 → 31/07 a 06/08)
    if (mo1 === mo2 && d1 > d2) mo1 = mo1 === 1 ? 12 : mo1 - 1;
    // Se mo1 > mo2, início é do ano anterior (ex: 28/12 a 03/01/2024)
    const y1 = (mo1 > mo2) ? y - 1 : y;
    return{ws:mkDate(y1,mo1,d1),we:mkDate(y,mo2,d2),year:y,month:mo1};
  }
  
  // 1b. Range Duplo com AMBOS os anos explícitos: "26/03/2026 a 01/04/2026"
  m=nt.match(/(\d{1,2})[\/\.\-](\d{1,2})[\/\.\-](\d{4})\s*[aA]\s*(\d{1,2})[\/\.\-](\d{1,2})[\/\.\-](\d{4})/);
  if(m){return{ws:mkDate(+m[3],+m[2],+m[1]),we:mkDate(+m[6],+m[5],+m[4]),year:+m[3],month:+m[2]};}
  
  // 1c. Range Duplo SEM ano: "31-07 a 06-08", "31/07 a 06/08"
  // Se d1/m1 a d2/m2 — dois meses diferentes (ex: julho a agosto)
  m=nt.match(/(\d{1,2})[\/\.\-](\d{1,2})\s*[aA]\s*(\d{1,2})[\/\.\-](\d{1,2})(?!\s*[\/\.\-]\d)/);
  if(m){
    const d1=+m[1],mo1=+m[2],d2=+m[3],mo2=+m[4];
    if(mo1>=1&&mo1<=12&&mo2>=1&&mo2<=12&&d1>=1&&d1<=31&&d2>=1&&d2<=31){
      // Se mesmos meses e d1>d2, início é mês anterior
      const realMo1 = (mo1===mo2 && d1>d2) ? (mo1===1?12:mo1-1) : mo1;
      return{ws:null,we:null,year:null,month:realMo1,mo1:realMo1,mo2,day1:d1,day2:d2};
    }
  }
  
  // 2. Range Simples c/ Ano: "26 a 01/04/2024"
  m=nt.match(/(\d{1,2})\s*[aA]\s*(\d{1,2})[\/\.\-](\d{1,2})[\/\.\-](\d{2,4})/);
  if(m){
    const d1=+m[1],d2=+m[2],mo2=+m[3],y=+m[4]<100?2000+ +m[4]:+m[4];
    // Se d1 > d2, o primeiro dia é do mês anterior (ex: "26 a 01/04" = 26/03 a 01/04)
    const mo1 = (d1 > d2) ? (mo2 === 1 ? 12 : mo2 - 1) : mo2;
    const y1 = (d1 > d2 && mo2 === 1) ? y - 1 : y;
    return{ws:mkDate(y1,mo1,d1),we:mkDate(y,mo2,d2),year:y,month:mo1};
  }
  
  // 3. Range Extenso: "26 de março a 01 de abril de 2024"
  m=text.match(/(\d{1,2})\s+(?:de\s+)?([a-zA-Z\u00C0-\u024F]+)\s+[aA]\s+(\d{1,2})\s+(?:de\s+)?([a-zA-Z\u00C0-\u024F]+)[\s,.\-\/]*(?:de\s+)?(\d{4})/i);
  if(m){
    const mo1=parseMonthPT(m[2]), mo2=parseMonthPT(m[4]), y=+m[5];
    if(mo1 || mo2) return {ws:mkDate(y,mo1||mo2,+m[1]), we:mkDate(y,mo2||mo1,+m[3]), year:y, month:mo1||mo2};
  }
  
  // 4. Range Meio-Extenso: "26 a 01 de abril de 2024"
  m=text.match(/(\d{1,2})\s+[aA]\s+(\d{1,2})\s+[dD][eE]\s+([a-zA-Z\u00C0-\u024F]+)[\s,.\-\/]*(?:de\s+)?(\d{4})/i);
  if(m){
    const d1=+m[1],d2=+m[2],mo2=parseMonthPT(m[3]),y=+m[4];
    if(mo2){
      // Se d1 > d2, o primeiro dia é do mês anterior (ex: "26 a 01 de abril" = 26/03 a 01/04)
      const mo1 = (d1 > d2) ? (mo2 === 1 ? 12 : mo2 - 1) : mo2;
      const y1 = (d1 > d2 && mo2 === 1) ? y - 1 : y;
      return{ws:mkDate(y1,mo1,d1),we:mkDate(y,mo2,d2),year:y,month:mo1};
    }
  }

  // 5. Sem Ano Extenso A: "26 a 01 de abril"
  m=text.match(/(\d{1,2})\s+[aA]\s+(\d{1,2})\s+[dD][eE]\s+([a-zA-Z\u00C0-\u024F]+)/);
  if(m){
    const d1=+m[1],d2=+m[2],mo2=parseMonthPT(m[3]);
    if(mo2){
      const mo1 = (d1 > d2) ? (mo2 === 1 ? 12 : mo2 - 1) : mo2;
      return{ws:null,we:null,year:null,month:mo1,mo1,mo2,day1:d1,day2:d2};
    }
  }
  
  // 6. Sem Ano Extenso B: "26 de março a 01 de abril"
  m=text.match(/(\d{1,2})\s+(?:de\s+)?([a-zA-Z\u00C0-\u024F]+)\s+[aA]\s+(\d{1,2})\s+(?:de\s+)?([a-zA-Z\u00C0-\u024F]+)/i);
  if(m){const mo1=parseMonthPT(m[2]),mo2=parseMonthPT(m[4]);
    if(mo1||mo2)return{ws:null,we:null,year:null,month:mo1||mo2,day1:+m[1],mo1:mo1||mo2,day2:+m[3],mo2:mo2||mo1};}
  
  // 7. Data isolada 4 dígitos: "30/03/2026", "30.03.2026", "30. 03. 2026", "Data:30/03/2026"
  m=nt.match(/(\d{1,2})[\/\.\-](\d{1,2})[\/\.\-](\d{4})/);
  if(m){const d=+m[1],mo=+m[2],y=+m[3];
    if(y>=2000&&y<=2050&&mo>=1&&mo<=12&&d>=1&&d<=31)
      return{ws:mkDate(y,mo,d),we:mkDate(y,mo,d),year:y,month:mo,day1:d,day2:d};}
      
  // 8. Data isolada 2 dígitos: "30.03.26", "30/03/26"
  m=nt.match(/(\d{1,2})[\/\.\-](\d{1,2})[\/\.\-](\d{2})(?!\d)/);
  if(m){const d=+m[1],mo=+m[2],yy=+m[3],y=yy<50?2000+yy:1900+yy;
    if(y>=2000&&y<=2050&&mo>=1&&mo<=12&&d>=1&&d<=31)
      return{ws:mkDate(y,mo,d),we:mkDate(y,mo,d),year:y,month:mo,day1:d,day2:d};}
      
  // 9. Data escrita: "30 de março de 2026", "30 março 2026"
  m=text.match(/(\d{1,2})\s+(?:de\s+)?([a-zA-Z\u00C0-\u024F]+)(?:\s+de)?\s+(\d{4})/i);
  if(m){
    const mo=parseMonthPT(m[2]);
    if(mo) return{ws:mkDate(+m[3],mo,+m[1]),we:mkDate(+m[3],mo,+m[1]),year:+m[3],month:mo,day1:+m[1],day2:+m[1]};
  }
  
  // 10. MÊS e ANO sem dia: "março 2026", "mar/2026", "03/2026"
  m=text.match(/([a-zA-Z\u00C0-\u024F]{3,})\s*[\/.\-]?\s*(\d{4})/i);
  if(m){const mo=parseMonthPT(m[1]);if(mo)return{ws:null,we:null,year:+m[2],month:mo};}
  m=nt.match(/(\d{1,2})[\/\.\-](\d{4})/);
  if(m){const mo=+m[1];if(mo>=1&&mo<=12)return{ws:null,we:null,year:+m[2],month:mo};}
  
  // 11. ANO ISOLADO (último recurso): só se precedido por "de", "/", "." ou início
  m=text.match(/(?:^|de\s+|[\/\.\-\s])(20[2-3]\d)(?:\s|$|[\/\.\-])/i);
  if(m){return{ws:null,we:null,year:+m[1],month:null,day1:null,day2:null};}

  return null;
}

function parsePeriodFromRows(rows){
  let bestResult = null;
  let yearOnly = null;
  
  // isRange: resultado tem dois dias/meses diferentes (é um intervalo, não data avulsa)
  function isRange(p) {
    if (!p) return false;
    if (p.day1 && p.day2 && (p.day1 !== p.day2 || (p.mo1 && p.mo2 && p.mo1 !== p.mo2))) return true;
    if (p.ws && p.we && p.ws !== p.we) return true;
    return false;
  }
  
  for(const r of rows){for(const c of r){
    const s=String(c||'').replace(/\n/g,' ').trim();
    if(s.length < 3) continue;
    
    const p = parsePeriodText(s);
    if(p) {
      if(p.ws || p.month) {
        const pIsRange = isRange(p);
        const bestIsRange = isRange(bestResult);
        
        // Sempre preferir um RANGE sobre uma data avulsa
        if (!bestResult) {
          bestResult = p;
        } else if (pIsRange && !bestIsRange) {
          // Novo é range, antigo é data avulsa → substitui
          // Herda ano do antigo se o novo não tem
          if (!p.year && bestResult.year) p.year = bestResult.year;
          bestResult = p;
        } else if (p.year && !bestResult.year) {
          // Novo tem ano, antigo não → substitui (a menos que antigo seja range)
          if (bestIsRange && !pIsRange) {
            // Não substitui, só herda o ano
            bestResult.year = p.year;
          } else {
            bestResult = p;
          }
        }
        
        // Só retorna imediatamente se temos um RANGE COM ANO
        if (isRange(bestResult) && bestResult.year) return bestResult;
      }
      if(p.year && !yearOnly) yearOnly = p.year;
    }
  }}
  
  // Se encontrou resultado parcial sem ano, mas achou ano em outra célula
  if(bestResult && !bestResult.year && yearOnly) {
    bestResult.year = yearOnly;
  }
  
  return bestResult;
}

// ═══════════════════════════════════════════════════════════════════
// PERÍODO: Sempre lê o que está DENTRO da planilha. 
// Se o nome do arquivo sugere data diferente, sinaliza discrepância.
// ═══════════════════════════════════════════════════════════════════
function bestPeriod(rows, fileName) {
  const fromRows = parsePeriodFromRows(rows);
  const fromFile = parsePeriodFromFileName(fileName);
  
  if (!fromRows && !fromFile) return null;
  if (!fromRows) { if(fromFile) fromFile._source='arquivo'; return fromFile; }
  
  // Sempre usa o conteúdo da planilha como verdade
  fromRows._source = 'conteúdo';
  
  // Se o conteúdo não tem ano mas o arquivo tem, herda
  if (!fromRows.year && fromFile && fromFile.year) fromRows.year = fromFile.year;
  
  // Detectar discrepância entre nome do arquivo e conteúdo
  if (fromFile && fromFile.day1 && fromRows.day1) {
    const fMo = fromFile.mo1 || fromFile.month || 0;
    const fD = fromFile.day1 || 0;
    const rMo = fromRows.mo1 || fromRows.month || 0;
    const rD = fromRows.day1 || 0;
    
    if (fMo !== rMo || fD !== rD) {
      // Discrepância! Marca para exibir aviso
      fromRows._discrepancy = true;
      fromRows._fileDate = (fromFile.day1||'?') + '/' + (fromFile.mo1||fromFile.month||'?');
      fromRows._fileDateEnd = (fromFile.day2||'?') + '/' + (fromFile.mo2||fromFile.mo1||fromFile.month||'?');
      fromRows._contentDate = (fromRows.day1||'?') + '/' + (fromRows.mo1||fromRows.month||'?');
      fromRows._contentDateEnd = (fromRows.day2||'?') + '/' + (fromRows.mo2||fromRows.mo1||fromRows.month||'?');
    }
  }
  
  return fromRows;
}

function parsePeriodFromFileName(name){return parsePeriodText(name.replace(/[_.]/g,' '));}
function finalizePeriod(p,fy){
  if(!p)return{ws:mkDate(fy,1,1),we:mkDate(fy,1,7),year:fy,month:1,label:'? (sem data)',yearAssumed:true};
  const yearDetected=!!p.year;
  const y=p.year||fy;
  let mo1=p.mo1||p.month||1, mo2=p.mo2||p.month||mo1;
  const d1=p.day1||1, d2=p.day2||7;
  
  // ─── LÓGICA DE CRUZAMENTO DE MÊS ───────────────────────
  // Se os meses são iguais mas d1 > d2 (ex: "31 a 06 de agosto")
  // → o dia 31 é claramente do mês ANTERIOR (julho), não agosto
  // Porque não existe lógica onde o início é depois do fim.
  if (mo1 === mo2 && d1 > d2) {
    mo1 = mo1 === 1 ? 12 : mo1 - 1;
  }
  
  // Se mo1 > mo2 (cruza virada de ano, ex: dez→jan), início é ano anterior
  const y1 = (mo1 > mo2) ? y - 1 : y;
  
  let ws = p.ws || mkDate(y1, mo1, d1);
  let we = p.we || mkDate(y, mo2, d2);
  
  // ─── SANITY CHECK UNIVERSAL ─────────────────────────────
  // Se mesmo após tudo, ws > we, é impossível. Corrige recuando ws 1 mês.
  if (ws > we) {
    const wsDate = new Date(ws + 'T12:00:00');
    wsDate.setMonth(wsDate.getMonth() - 1);
    ws = mkDate(wsDate.getFullYear(), wsDate.getMonth()+1, wsDate.getDate());
  }
  
  const wsD = new Date(ws+'T12:00:00'), weD = new Date(we+'T12:00:00');
  const label = pad2(wsD.getDate())+'/'+pad2(wsD.getMonth()+1) + ' a ' + pad2(weD.getDate())+'/'+pad2(weD.getMonth()+1)+'/'+y;
  
  const disc = p._discrepancy ? { fileDate: p._fileDate+' a '+p._fileDateEnd, contentDate: p._contentDate+' a '+p._contentDateEnd } : null;
  return{ws,we,year:y,month:wsD.getMonth()+1,label,yearAssumed:!yearDetected,discrepancy:disc};
}

function stripTrailingDate(s){
  return s
    .replace(/\s+\d{1,2}\s*[\/\.]\s*\d{1,2}\s*[\/\.]\s*\d{2,4}\s*$/,'')
    .replace(/\s+\d{1,2}\s*\.\s*\d{1,2}\s*\.\s*\d{2,4}\s*$/,'')
    .trim();
}

function extractUnitFromRows(rows){
  for(const r of rows){for(const c of r){
    const s=String(c||'').trim();
    let m=s.match(/unidade de acolhimento\s*[:\-–]\s*(.+)/i);
    if(m)return stripTrailingDate(m[1].trim());
    m=s.match(/nome\s+da\s+unid(?:ade|e)\s*:?\s*(.+)/i);
    if(m)return stripTrailingDate(m[1].trim());
  }}
  for(const r of rows){
    const f=String(r[0]||'').trim().toLowerCase();
    const sec=String(r[1]||'').trim();
    if(f==='material'&&sec&&sec.toLowerCase()!=='unidade'&&sec.length<30&&sec.length>1)return sec;
  }
  return null;
}

function parseSheetForHist(rows){
  const cats=[];let cat=null;
  const SKIP_F=/separado\s+por|entregue\s+por|recebido\s+por|atenciosamente|semcas|prefeitura|secretaria/i;
  const SKIP_H=/^fornecimento\s+de|^unidade\s+de\s+acolhimento|^data\s*:/i;
  for(const row of rows){
    const f=String(row[0]||'').trim();
    const qty=row[1];
    if(!f||f==='nan'||f==='None')continue;
    if(SKIP_F.test(f)||SKIP_H.test(f))continue;
    if(/^material(\s|$)/i.test(f))continue;
    
    const qs=String(qty==null?'':qty).trim();
    const qEmpty=qs===''||qs==='nan'||qs==='None';
    
    if(/^\d+\s*[-–—.]\s*.+/.test(f)){cat={catName:normalizeCat(f),items:[]};cats.push(cat);continue;}
    if(f===f.toUpperCase()&&f.length>8&&qEmpty&&looksLikeCategory(f)){cat={catName:normalizeCat(f),items:[]};cats.push(cat);continue;}
    if(!cat){if(qEmpty)continue;cat={catName:'Outros',items:[]};cats.push(cat);}
    
    const qn=typeof qty==='number'?qty:(qs.toLowerCase()==='nt'?0:extractNum(qs));
    cat.items.push({material:f,qty:qn});
  }
  return cats.filter(c=>c.items.length>0);
}

function isMultiSheet(wb){
  if(wb.SheetNames.length<2)return false;
  return wb.SheetNames.some(s=>/^(RI|CAT|POP|ILPI|REPUB|ACOLH|RECANT|CASA|MULHER|LUZ)/i.test(s));
}

function parseMultiSheetWb(wb,fileName,fy){
  let period=null;
  let firstRows=null;
  for(const sn of wb.SheetNames){
    const rows=getSafeRows(wb.Sheets[sn]);
    if(!firstRows) firstRows=rows;
    period=parsePeriodFromRows(rows);
    if(period&&(period.ws||period.year))break;
  }
  // Verificar se o nome do arquivo tem data diferente (cópia com data antiga)
  period = bestPeriod(firstRows||[], fileName) || period;
  const per=finalizePeriod(period,fy);
  const units=[];
  for(const sn of wb.SheetNames){
    const rows=getSafeRows(wb.Sheets[sn]);
    const rawUnit=extractUnitFromRows(rows)||sn;
    const unitName=normalizeUnit(rawUnit);
    if(unitName==='Desconhecida')continue;
    const categories=parseSheetForHist(rows);
    if(categories.length)units.push({unitName,rawUnit,categories});
  }
  return{fileName,weekStart:per.ws,weekEnd:per.we,weekLabel:per.label,year:per.year,month:per.month,yearAssumed:per.yearAssumed,discrepancy:per.discrepancy,units};
}

function parseMultiColWb(wb,fileName,fy){
  const ws=wb.Sheets[wb.SheetNames[0]];
  const rows=getSafeRows(ws);
  let period=bestPeriod(rows, fileName);
  const per=finalizePeriod(period,fy);

  const colBlocks=[];
  for(let ri=0;ri<Math.min(rows.length,15);ri++){
    const r=rows[ri];
    for(let ci=0;ci<r.length;ci++){
      if(String(r[ci]||'').trim().toLowerCase()==='material'){
        const abbr=String(r[ci+1]||'').trim();
        if(abbr&&abbr.toLowerCase()!=='unidade'&&!colBlocks.find(b=>b.col===ci))
          colBlocks.push({col:ci,abbr,qtyCol:ci+1});
      }
    }
  }
  if(!colBlocks.length)return null;

  let unitRow=[];
  for(const r of rows){
    if(r.some(c=>String(c||'').toLowerCase().includes('unidade de acolhimento'))){unitRow=r;break;}
  }
  colBlocks.forEach(b=>{
    const full=String(unitRow[b.col]||'').trim();
    const m=full.match(/acolhimento\s*[-:–\s]\s*(.+)/i);
    b.rawUnit=(m?m[1].trim():'')||b.abbr;
    b.unitName=normalizeUnit(b.rawUnit);
  });

  const SKIP=/separado\s+por|entregue\s+por|recebido\s+por|fornecimento\s+de|unidade\s+de\s+acolhimento|data\s*:/i;
  const units=colBlocks.map(b=>{
    const cats=[];let cat=null;
    for(const row of rows){
      const f=String(row[b.col]||'').trim();
      const qty=row[b.qtyCol];
      if(!f||f==='nan')continue;
      if(SKIP.test(f))continue;
      if(/^material(\s|$)/i.test(f))continue;
      
      const qs=String(qty==null?'':qty).trim();
      const qEmpty=qs===''||qs==='nan';
      
      if(/^\d+\s*[-–—.]\s*.+/.test(f)){cat={catName:normalizeCat(f),items:[]};cats.push(cat);continue;}
      if(f===f.toUpperCase()&&f.length>5&&qEmpty&&looksLikeCategory(f)){cat={catName:normalizeCat(f),items:[]};cats.push(cat);continue;}
      if(!cat){if(qEmpty)continue;cat={catName:'Outros',items:[]};cats.push(cat);}
      
      const qn=typeof qty==='number'?qty:(qs.toLowerCase()==='nt'?0:extractNum(qs));
      cat.items.push({material:f,qty:qn});
    }
    return{unitName:b.unitName,rawUnit:b.rawUnit,categories:cats.filter(c=>c.items.length>0)};
  }).filter(u=>u.unitName!=='Desconhecida'&&u.categories.length>0);

  return{fileName,weekStart:per.ws,weekEnd:per.we,weekLabel:per.label,year:per.year,month:per.month,yearAssumed:per.yearAssumed,discrepancy:per.discrepancy,units};
}


// ═══════════════════════════════════════════════════════════════════
// PARSER: Blocos Empilhados (várias unidades numa mesma aba)
// Formato: "NOME DA UNIDADE: X" → "MATERIAL PARA CONSUMO:" → Header → Itens → Footer → repete
// ═══════════════════════════════════════════════════════════════════
function isStackedFormat(rows) {
  let count = 0;
  for (const r of rows) {
    const f = String(r[0] || '').trim().toLowerCase();
    if (f.includes('nome da unidade')) count++;
    if (count >= 2) return true;
  }
  return false;
}

function parseStackedBlocks(rows, fileName, fy) {
  // Detect period from anywhere in the sheet
  const per = bestPeriod(rows, fileName);
  const fin = finalizePeriod(per, fy);
  
  // Split into blocks by "NOME DA UNIDADE:"
  const blocks = [];
  let currentBlock = null;
  
  for (const r of rows) {
    const f = String(r[0] || '').trim();
    const flo = f.toLowerCase();
    
    // Detect unit header
    const unitMatch = f.match(/nome\s+da\s+unid(?:ade|e)\s*:?\s*(.+)/i);
    if (unitMatch) {
      if (currentBlock && currentBlock.items.length > 0) {
        blocks.push(currentBlock);
      }
      const rawUnit = unitMatch[1].trim().replace(/\s+\d{1,2}[\/.].*/,'').replace(/[\s:–-]+$/,'').trim();
      currentBlock = { rawUnit, unitName: normalizeUnit(rawUnit), catName: 'Outros', items: [] };
      continue;
    }
    
    // Detect category within a block
    if (currentBlock && flo.includes('material para consumo')) {
      currentBlock.catName = normalizeCat(f.replace(/material\s+para\s+consumo\s*:?\s*/i, '').trim() || 'Material para Consumo');
      continue;
    }
    
    // Detect numbered categories within block  
    if (currentBlock && /^\d+\s*[-–—.]\s*.+/.test(f)) {
      currentBlock.catName = normalizeCat(f);
      continue;
    }
    
    // Skip headers and footers
    if (!currentBlock) continue;
    if (flo === 'material' || flo === 'materiais') continue;
    if (/^material\s*$/i.test(flo)) continue;
    if (/separado\s+por|entregue\s+por|recebido\s+por/i.test(flo)) continue;
    if (!f || f.length < 2) continue;
    
    // Parse item row (4-column format: Material, Unidade, QtdSolicitada, QtdAtendida)
    const unid = String(r[1] || '').trim();
    const qsRaw = r[2];
    const qaRaw = r[3];
    const qs = typeof qsRaw === 'number' ? qsRaw : extractNum(String(qsRaw || ''));
    const qa = typeof qaRaw === 'number' ? qaRaw : extractNum(String(qaRaw || ''));
    
    // Use atendida if available, otherwise solicitada
    const qty = qa > 0 ? qa : qs;
    if (f.length >= 2 && !(/^(material|unidade|quantidade|especif)/i.test(flo))) {
      currentBlock.items.push({ material: f, qty });
    }
  }
  
  // Push last block
  if (currentBlock && currentBlock.items.length > 0) {
    blocks.push(currentBlock);
  }
  
  if (!blocks.length) return null;
  
  // Group items by unit → category
  const unitMap = {};
  blocks.forEach(b => {
    if (!unitMap[b.unitName]) unitMap[b.unitName] = { unitName: b.unitName, rawUnit: b.rawUnit, categories: {} };
    if (!unitMap[b.unitName].categories[b.catName]) unitMap[b.unitName].categories[b.catName] = { catName: b.catName, items: [] };
    unitMap[b.unitName].categories[b.catName].items.push(...b.items);
  });
  
  const units = Object.values(unitMap).map(u => ({
    unitName: u.unitName,
    rawUnit: u.rawUnit,
    categories: Object.values(u.categories).filter(c => c.items.length > 0)
  })).filter(u => u.categories.length > 0);
  
  return {
    fileName, weekStart: fin.ws, weekEnd: fin.we,
    weekLabel: fin.label, year: fin.year, month: fin.month,
    yearAssumed: fin.yearAssumed, units
  };
}


// ═══════════════════════════════════════════════════════════════════
// DETECÇÃO DE DUPLICATAS — Compara conteúdo, não apenas nome
// ═══════════════════════════════════════════════════════════════════
function buildEntryFingerprint(entry) {
  // Gera uma assinatura baseada em: período + unidades + quantidades
  const parts = [];
  parts.push(entry.weekStart || '?');
  parts.push(entry.weekEnd || '?');
  (entry.units || []).forEach(u => {
    const uKey = (u.unitName || '').toUpperCase().trim();
    const itemsHash = (u.categories || []).flatMap(c => 
      (c.items || []).map(it => normMat(it.material) + ':' + (it.qty || 0))
    ).sort().join('|');
    parts.push(uKey + '=' + itemsHash);
  });
  return parts.join('##');
}

function findDuplicates() {
  const fps = {};
  const duplicates = new Map(); // id -> [ids of duplicates]
  
  HIST_DB.forEach(e => {
    const fp = buildEntryFingerprint(e);
    if (!fp || fp === '?##?') return; // Skip entries with no data
    
    if (fps[fp]) {
      // Found a duplicate
      const origId = fps[fp];
      if (!duplicates.has(origId)) duplicates.set(origId, []);
      duplicates.get(origId).push(e.id);
      if (!duplicates.has(e.id)) duplicates.set(e.id, []);
      duplicates.get(e.id).push(origId);
    } else {
      fps[fp] = e.id;
    }
  });
  
  return duplicates;
}

function isDuplicate(entryId, dupMap) {
  return dupMap && dupMap.has(entryId) && dupMap.get(entryId).length > 0;
}

function removeDuplicatesAuto() {
  const fps = {};
  const toRemove = new Set();
  
  HIST_DB.forEach(e => {
    const fp = buildEntryFingerprint(e);
    if (!fp || fp === '?##?') return;
    if (fps[fp]) {
      toRemove.add(e.id); // Keep first, remove subsequent
    } else {
      fps[fp] = e.id;
    }
  });
  
  if (!toRemove.size) { toast('Nenhuma duplicata encontrada!', 'green'); return; }
  if (!confirm('Foram encontradas ' + toRemove.size + ' planilha(s) duplicada(s).\n\nDeseja removê-las automaticamente? (mantém a primeira de cada par)')) return;
  
  HIST_DB = HIST_DB.filter(e => !toRemove.has(e.id));
  invalidateAggCache();
  saveHistDB();
  renderRelatorio();
  toast(toRemove.size + ' duplicata(s) removida(s)!', 'green');
}

function populateDbUnitSelect() {
  const sel = document.getElementById("rDbUnit");
  if (!sel) return;

  const previous = sel.value || "";
  const unidades = (getUnidades() || []).filter((u) => (u?.atendeMateriais ?? true) === true);
  if (!unidades.length) return;

  const groups = new Map();
  for (const u of unidades) {
    const nome = String(u?.nome || u?.unidadeNome || "").trim();
    if (!nome) continue;
    let tipo = String(u?.tipoUnidade || u?.tipo || "OUTROS").trim().toUpperCase();
    if (tipo === "SEMCAS") tipo = "SEDE";
    if (!groups.has(tipo)) groups.set(tipo, []);
    groups.get(tipo).push(nome);
  }
  for (const arr of groups.values()) arr.sort((a, b) => a.localeCompare(b, "pt-BR"));
  const tiposOrdenados = [...groups.keys()].sort((a, b) => a.localeCompare(b, "pt-BR"));

  sel.innerHTML = "";
  const optAll = document.createElement("option");
  optAll.value = "";
  optAll.textContent = "Selecione uma unidade...";
  sel.appendChild(optAll);

  for (const tipo of tiposOrdenados) {
    const og = document.createElement("optgroup");
    og.label = tipo;
    for (const nome of groups.get(tipo)) {
      const opt = document.createElement("option");
      opt.value = nome;
      opt.textContent = nome;
      og.appendChild(opt);
    }
    sel.appendChild(og);
  }

  if (previous) {
    const match = [...sel.options].find((o) => o.value === previous);
    if (match) sel.value = previous;
  }
}

function handleHistFiles(e){
  if (getUserRole() !== 'admin') { toast('Permissão negada: apenas Admin.', 'red'); return; }
  const files=[...e.target.files];if(!files.length)return;
  const selectedUnit = document.getElementById('rDbUnit')?.value || '';
  if(!selectedUnit){toast('Selecione a unidade antes de importar planilhas.','red');return;}
  const fy=new Date().getFullYear();
  document.getElementById('rProgress').style.display='block';
  let i=0;
  function next(){
    if(i>=files.length){
      document.getElementById('rProgress').style.display='none';
      document.getElementById('rFi').value='';
      saveHistDB();renderRelatorio();
      toast(files.length+' arquivo(s) adicionado(s)!','green');
      return;
    }
    const file=files[i];
    document.getElementById('rProgressMsg').textContent=(i+1)+'/'+files.length+': '+file.name;
    document.getElementById('rProgressBar').style.width=((i/files.length)*100)+'%';
    const reader=new FileReader();
    reader.onload=async (ev)=>{
      try{
        let rows, wb = null;

        if (isDocxFile(file.name)) {
          // ── DOCX: converte tabelas via mammoth ──
          rows = await docxToRows(ev.target.result);
          wb = { SheetNames: ['Sheet1'], Sheets: { Sheet1: {} } };
        } else if (isPdfFile(file.name)) {
          // ── PDF: extrai tabelas via pdf.js ──
          rows = await pdfToRows(ev.target.result);
          wb = { SheetNames: ['Sheet1'], Sheets: { Sheet1: {} } };
        } else {
          // ── Excel/ODS: pipeline original ──
          wb = XLSX.read(new Uint8Array(ev.target.result),{type:'array', cellDates: true});
          const ws = wb.Sheets[wb.SheetNames[0]];
          rows = getSafeRows(ws);
        }

        const fmt = detectFormat(rows);
        
        let entry = null;
        if(!isDocxFile(file.name) && !isPdfFile(file.name) && isMultiSheet(wb)) {
            entry = parseMultiSheetWb(wb,file.name,fy);
        } else if (isStackedFormat(rows)) {
            entry = parseStackedBlocks(rows,file.name,fy);
        } else if (fmt === 'abrigo') {
            entry = parseMultiColWb(wb,file.name,fy);
        }
        
        if (!entry || !entry.units || !entry.units.length) {
            const parsed = parseSheet(rows);
            parsed.fileName = file.name;
            const per = bestPeriod(rows, file.name);
            const fin = finalizePeriod(per, fy);
            entry = buildHistEntryFromParsed(parsed, fin);
        }
        
        if(entry&&entry.units&&entry.units.length){
          entry.units.forEach(u => {
              if(u.unitName === 'Unidade' || u.unitName === 'Desconhecida' || u.unitName === 'Abrigo') {
                 const m = file.name.match(/(CRAS|CREAS|CENTRO POP|CT|PROCAD|AEPETI|ASTEC|ILPI|CAT|POP RUA)[a-z\s_0-9-ãõáéíóú]+/i);
                 if(m) {
                     u.unitName = normalizeUnit(m[0].replace(/[-_]/g, ' ').trim());
                     u.rawUnit = m[0];
                 } else {
                     const basicName = file.name.split(/[-_.]/)[0].trim();
                     if(basicName && basicName.length > 3) u.unitName = normalizeUnit(basicName);
                 }
              }
          });

          entry.units.forEach(u => {
            u.unitName = selectedUnit;
            u.rawUnit = selectedUnit;
          });
          entry.manualUnit = selectedUnit;
          
          const dupFp=buildEntryFingerprint(entry);
          const dupByName=HIST_DB.find(x=>x.fileName===entry.fileName&&(x.weekStart||'')===(entry.weekStart||''));
          const dupByContent=HIST_DB.find(x=>buildEntryFingerprint(x)===dupFp && dupFp!=='?##?');
          if(!dupByName && !dupByContent){entry.id=Date.now()+'_'+i;HIST_DB.push(entry);}
        }
      }catch(err){console.warn('Erro:',file.name,err);}
      i++;next();
    };
    reader.readAsArrayBuffer(file);
  }
  next();
}

(function(){
  const dz=document.getElementById('rDrop');if(!dz)return;
  ['dragenter','dragover'].forEach(ev=>dz.addEventListener(ev,e=>{e.preventDefault();dz.classList.add('over');}));
  ['dragleave','drop'].forEach(ev=>dz.addEventListener(ev,e=>{e.preventDefault();dz.classList.remove('over');}));
  dz.addEventListener('drop',e=>{
    const dt=new DataTransfer();[...e.dataTransfer.files].forEach(f=>dt.items.add(f));
    document.getElementById('rFi').files=dt.files;
    handleHistFiles({target:{files:[...e.dataTransfer.files]}});
  });
})();

function editEntryPeriod(id){
  const e=HIST_DB.find(x=>x.id===id);if(!e)return;
  const currentLabel = e.weekLabel || '?';
  showModal(
    'Corrigir período',
    'Arquivo: '+e.fileName+'\nAtual: '+currentLabel+'\n\nDigite o novo período no formato: dd/mm/aaaa a dd/mm/aaaa\nOu: dd/mm a dd/mm/aaaa',
    currentLabel,
    function(val){
      const p = parsePeriodText(val);
      if(!p || (!p.ws && !p.month && !p.year)){toast('Formato não reconhecido. Use: 01/04/2023 a 07/04/2023','red');return;}
      const fy = e.year || new Date().getFullYear();
      const fin = finalizePeriod(p, fy);
      e.weekStart = fin.ws;
      e.weekEnd = fin.we;
      e.weekLabel = fin.label;
      e.year = fin.year;
      e.month = fin.month;
      e.yearAssumed = fin.yearAssumed;
      e.discrepancy = null; // Limpa discrepância após correção manual
      invalidateAggCache();
      saveHistDB();
      renderRelatorio();
      toast('Período corrigido para: '+fin.label,'green');
    }
  );
}

function editEntryYear(id){
  const e=HIST_DB.find(x=>x.id===id);if(!e)return;
  showModal(
    'Corrigir ano',
    e.fileName+'\n'+( e.yearAssumed?'⚠️ Ano não encontrado no arquivo — informe o correto':'✅ Detectado automaticamente: '+e.year ),
    String(e.year),
    function(val){
      const y=parseInt(val);
      if(!y||y<2000||y>2040){toast('Ano inválido','red');return;}
      e.year=y;e.yearAssumed=false;
      if(e.weekStart)e.weekStart=e.weekStart.replace(/^\d{4}/,String(y));
      if(e.weekEnd){
        const em=parseInt((e.weekEnd||'').substring(5,7));
        const sm=parseInt((e.weekStart||'').substring(5,7));
        e.weekEnd=e.weekEnd.replace(/^\d{4}/,String(em<sm?y+1:y));
      }
      e.weekLabel=e.weekLabel?e.weekLabel.replace(/\/\d{4}$/,'/'+y):String(y);
      saveHistDB();renderRelatorio();toast('Ano corrigido para '+y,'green');
    }
  );
}

function toggleDetail(id){const el=document.getElementById(id);if(el)el.style.display=el.style.display==='none'?'':'none';}
function selAllUnits(){for(const o of document.getElementById('rFiltUnits').options)o.selected=true;}
function selAllCats(){for(const o of document.getElementById('rFiltCats').options)o.selected=true;}
function clearFilters(){
  for(const o of document.getElementById('rFiltUnits').options)o.selected=false;
  for(const o of document.getElementById('rFiltCats').options)o.selected=false;
}

function removeAlias(from){delete HIST_ALIASES[rmAcc(from).toUpperCase()];HIST_DB.forEach(e=>(e.units||[]).forEach(u=>{u.unitName=normalizeUnit(u.rawUnit||u.unitName);}));invalidateAggCache();saveHistDB();renderRelatorio();if(document.getElementById('tab-unif')?.classList.contains('active'))renderUnificar();}
async function removeHistEntry(id) {
  if (getUserRole() !== 'admin') { toast('Apenas Admin pode excluir planilhas.', 'red'); return; }
  if (!confirm("Tem certeza que deseja excluir esta planilha do banco de dados permanentemente?")) return;
  try {
    await deleteDoc(doc(COLLECTIONS.semcasHistDB, id));
    HIST_DB = HIST_DB.filter(e => e.id !== id);
    await saveHistDB();
    renderRelatorio();
    toast('Planilha removida.', 'green');
  } catch (e) {
    console.error(e);
    toast('Erro ao excluir a planilha.', 'red');
  }
}

// ─── Identificação de Buracos / Lapsos (Gaps) ──────────────────────
function analyzeGaps(unitName, unitEntries, globalWs, globalWe) {
  if (!isAbrigo(unitName)) {
    return `<div class="gap-note gap-info">ℹ️ <b>Perfil Sob Demanda:</b> Unidade de requisições pontuais/esporádicas (${unitEntries.length} pedidos no período analisado).</div>`;
  }
  
  let periods = unitEntries.map(e => {
    if (!e.weekStart || !e.weekEnd) return null;
    return {
      ws: new Date(e.weekStart + 'T12:00:00'),
      we: new Date(e.weekEnd + 'T12:00:00'),
      hasAssumed: e.yearAssumed
    };
  }).filter(Boolean);

  if (periods.length === 0) return `<div class="gap-note">⚠️ Sem datas válidas para calcular continuidade.</div>`;
  
  const hasAssumedYear = periods.some(p => p.hasAssumed);
  periods.sort((a,b) => a.ws - b.ws);
  
  // Mescla períodos consecutivos/sobrepostos (férias, planilhas longas)
  let merged = [periods[0]];
  for (let i=1; i < periods.length; i++) {
    let last = merged[merged.length-1];
    let curr = periods[i];
    
    // Se a próxima planilha começa em até 7 dias após o fim da anterior (cobre finais de semana/atraso aceitável na semana seguinte)
    let diffDays = (curr.ws - last.we) / (1000 * 3600 * 24);
    if (diffDays <= 7) {
      if (curr.we > last.we) last.we = curr.we;
    } else {
      merged.push(curr);
    }
  }

  let gaps = [];
  const fmt = (d) => `${pad2(d.getDate())}/${pad2(d.getMonth()+1)}/${d.getFullYear()}`;

  // Buraco inicial relativo ao período global (Ex: Se o ano começou e o abrigo só tem planilha em Agosto)
  if (globalWs) {
    let first = merged[0];
    let diffStart = (first.ws - globalWs) / (1000 * 3600 * 24);
    if (diffStart > 7) {
      let gapStart = new Date(globalWs);
      let gapEnd = new Date(first.ws); gapEnd.setDate(gapEnd.getDate() - 1);
      gaps.push(`${fmt(gapStart)} até ${fmt(gapEnd)} <span style="color:var(--muted);font-weight:normal">(Início do período analisado s/ planilhas)</span>`);
    }
  }

  // Buracos intermediários
  for (let i=0; i < merged.length - 1; i++) {
    let diffDays = (merged[i+1].ws - merged[i].we) / (1000 * 3600 * 24);
    if (diffDays > 7) {
      let gapStart = new Date(merged[i].we); gapStart.setDate(gapStart.getDate() + 1);
      let gapEnd = new Date(merged[i+1].ws); gapEnd.setDate(gapEnd.getDate() - 1);
      gaps.push(`${fmt(gapStart)} até ${fmt(gapEnd)}`);
    }
  }

  // Buraco final relativo ao período global
  if (globalWe) {
    let last = merged[merged.length-1];
    let diffEnd = (globalWe - last.we) / (1000 * 3600 * 24);
    if (diffEnd > 7) {
      let gapStart = new Date(last.we); gapStart.setDate(gapStart.getDate() + 1);
      let gapEnd = new Date(globalWe);
      gaps.push(`${fmt(gapStart)} até ${fmt(gapEnd)} <span style="color:var(--muted);font-weight:normal">(Fim do período analisado s/ planilhas)</span>`);
    }
  }
  
  let assumeWarn = hasAssumedYear ? ` <br><span style="color:#ef4444;font-weight:bold;font-size:10px">(⚠️ Aviso: O sistema assumiu o ano atual em algumas planilhas. Se o buraco for irreal, corrija o ano no Banco de Dados clicando no ícone ⚠️.)</span>` : '';

  if (gaps.length === 0) {
    return `<div class="gap-note gap-ok">✅ <b>Abastecimento Contínuo:</b> Foi calculado que este abrigo foi abastecido de forma contínua durante todo o período analisado (${globalWs?fmt(globalWs):''} a ${globalWe?fmt(globalWe):''}), sem falhas maiores que 7 dias.${assumeWarn}</div>`;
  } else {
    return `<div class="gap-note">⚠️ <b>Buracos Identificados (${gaps.length}):</b> Faltam planilhas / não houve abastecimento neste abrigo nos seguintes lapsos:<br> <b>&bull; ${gaps.join('</b><br><b>&bull; ')}</b>${assumeWarn}</div>`;
  }
}

function renderRelatorio(){
  if(window.__semcasHistDB && window.__semcasHistDB.length>0) HIST_DB=window.__semcasHistDB;
  if(getSemcasHistDB() && getSemcasHistDB().length>0) HIST_DB=getSemcasHistDB();
  HIST_DB_PARTIAL=!!window.__semcasHistDBPartial;
  applyAliasesToHistDB();
  populateDbUnitSelect();
  const allUnits=new Set(),allCats=new Set(),allYears=new Set();
  let totalRec=0;
  HIST_DB.forEach(e=>{
    if(e.year)allYears.add(e.year);
    (e.units||[]).forEach(u=>{
      allUnits.add(u.unitName);
      (u.categories||[]).forEach(c=>{allCats.add(c.catName);totalRec+=c.items.length;});
    });
  });

  const statFilesEl = document.getElementById('rStatFiles');
  const statWeeksEl = document.getElementById('rStatWeeks');
  const statUnitsEl = document.getElementById('rStatUnits');
  const statItemsEl = document.getElementById('rStatItems');
  if (statFilesEl && statWeeksEl && statUnitsEl && statItemsEl) {
    const nAssumed=HIST_DB.filter(e=>e.yearAssumed).length;
    statFilesEl.textContent=HIST_DB.length+(nAssumed?' ('+nAssumed+' ⚠️)':'');
    statWeeksEl.textContent=new Set(HIST_DB.map(e=>e.weekStart)).size;
    statUnitsEl.textContent=allUnits.size;
    statItemsEl.textContent=totalRec;
  }

  const fl=document.getElementById('rFileList');
  if (!fl) return;
  if(!HIST_DB.length){
    fl.innerHTML='<div style="font-size:11px;color:var(--muted);text-align:center;padding:10px;grid-column:1 / -1">Nenhum arquivo carregado</div>';
  }else{
    // Detectar duplicatas
    const _dupMap = findDuplicates();
    const _nDups = new Set();
    _dupMap.forEach((v,k) => { if(v.length) _nDups.add(k); });
    
    // Filtrar por busca
    const dbSearchTerm = (document.getElementById('dbSearch')?.value||'').toLowerCase();
    const unitFilter = (document.getElementById('rDbUnit')?.value || '').trim();
    if (!unitFilter && !dbSearchTerm) {
      fl.innerHTML = '<div style="font-size:11px;color:var(--muted);text-align:center;padding:10px;grid-column:1 / -1">Selecione uma unidade para listar as planilhas.</div>';
      return;
    }
    const filteredByUnit = unitFilter
      ? HIST_DB.filter(e => (e.units || []).some(u => String(u.unitName || '').toLowerCase() === unitFilter.toLowerCase()))
      : HIST_DB;
    const filteredDB = dbSearchTerm ? filteredByUnit.filter(e => e.fileName.toLowerCase().includes(dbSearchTerm)) : filteredByUnit;
    // Ordenar: duplicatas e sem-ano primeiro
    const sortedDB = [...filteredDB].sort((a,b) => {
      if(a.yearAssumed && !b.yearAssumed) return -1;
      if(!a.yearAssumed && b.yearAssumed) return 1;
      return 0;
    });
    const flPg=paginate(sortedDB, PAGE_STATE.files, 20);
    fl.innerHTML=flPg.items.map(e=>{
      const assumed=e.yearAssumed;
      const yrHtml=assumed
        ?'<span class="yr-assumed" onclick="editEntryYear(\''+e.id+'\')">⚠️ '+e.year+' (clique p/ corrigir)</span>'
        :'<span class="yr-detected">🟢 '+e.year+'</span>';
      const _isDup=_dupMap&&isDuplicate(e.id,_dupMap);
      return'<div class="file-item" data-file-id="'+e.id+'" style="'+(e.discrepancy?'background:#fff7ed;border-color:#fb923c':e.yearAssumed?'background:#fefce8;border-color:#fde047':'')+(_isDup?'background:#fef2f2;border-color:#fca5a5':'')+ '; min-width: 0;">'
        +'<div style="flex:1;overflow:hidden">'
        +'<div class="file-item-name" title="'+esc(e.fileName)+'">'+esc(e.fileName)+'</div>'
        +'<div class="file-item-date">'+esc(e.weekLabel||'?')+' · '+yrHtml+' · '+(e.units||[]).length+' unid.'
        +(_isDup?' <span style="color:#dc2626;font-weight:700">⚠️ POSSÍVEL DUPLICATA</span>':'')
        +(e.discrepancy?'<br><span style="color:#d97706;font-size:9px;font-weight:700">⚠️ ATENÇÃO: Nome do arquivo sugere <b>'+esc(e.discrepancy.fileDate)+'</b> mas dentro da planilha está <b>'+esc(e.discrepancy.contentDate)+'</b> — Verifique se a data interna está correta</span>':'')
        +'</div>'
        +'</div>'
        +'<div class="file-actions" style="display:flex;flex-wrap:wrap;gap:4px">'
        +'<button onclick="openEditor(\''+e.id+'\')">📝</button>'
        +'<button onclick="editEntryPeriod(\''+e.id+'\')">📅</button>'
        +'<button onclick="editEntryYear(\''+e.id+'\')">📆</button>'
        +'<button onclick="removeHistEntry(\''+e.id+'\')">✕</button>'
        +'</div>'
        +'</div>';
    }).join('');
    fl.innerHTML += '<div style="grid-column:1 / -1">' + paginationHTML('files', flPg.page, flPg.total, flPg.count) + '</div>';
    // Warning banners
    const nAssumedInDB = HIST_DB.filter(x => x.yearAssumed).length;
    const nDupsInDB = _nDups.size;
    let banners = '';
    if (HIST_DB_PARTIAL) {
      banners += '<div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:8px 12px;margin-bottom:8px;font-size:11px;color:#1e40af">'
        + '📉 <b>Modo econômico ativo</b>: apenas parte do histórico foi carregada automaticamente. '
        + '<button class="btn btn-s btn-sm" style="font-size:10px;margin-left:6px;border-color:#bfdbfe" onclick="loadAllHistDBAndRefresh()">Carregar tudo</button>'
        + '</div>';
    }
    if (nDupsInDB > 0) {
      banners += '<div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:8px;padding:8px 12px;margin-bottom:8px;font-size:11px;color:#991b1b">'
        + '🔴 <b>' + nDupsInDB + ' arquivo(s) possivelmente duplicado(s)</b> (destacados em vermelho). '
        + 'Mesmo período, mesmas unidades e mesmas quantidades. '
        + '<button class="btn btn-s btn-sm" style="font-size:10px;color:#dc2626;border-color:#fca5a5;margin-left:6px" onclick="removeDuplicatesAuto()">Remover duplicatas</button>'
        + '</div>';
    }
    if (nAssumedInDB > 0) {
      banners += '<div style="background:#fef3c7;border:1px solid #fde047;border-radius:8px;padding:8px 12px;margin-bottom:8px;font-size:11px;color:#92400e">'
        + '⚠️ <b>' + nAssumedInDB + ' arquivo(s) sem ano detectado</b> (destacados em amarelo). '
        + 'Clique no ⚠️ ao lado do ano para corrigir manualmente.'
        + '</div>';
    }
    if (banners) fl.insertAdjacentHTML('afterbegin', '<div style="grid-column:1 / -1">' + banners + '</div>');
  }
}

function getSelYears(){return [...document.querySelectorAll('#rYearChecks input:checked')].map(i=>+i.value);}
function selAllYears(){document.querySelectorAll('#rYearChecks input').forEach(i=>i.checked=true);}
function clearYears(){document.querySelectorAll('#rYearChecks input').forEach(i=>i.checked=false);}
function onModeChange(){
  const mode=document.getElementById('rFiltMode').value;
  document.getElementById('rankingOpts').style.display=mode==='ranking'?'block':'none';
}

function filterEntries(){
  const selYears=new Set(getSelYears());
  const dfrom=document.getElementById('rFiltDateFrom')?.value; // "2024-03"
  const dto=document.getElementById('rFiltDateTo')?.value;
  return HIST_DB.filter(e=>{
    if(selYears.size&&!selYears.has(e.year))return false;
    // Filtro por período mês/ano
    if(dfrom||dto){
      const emo=weekMonth(e); // "2024-03"
      if(dfrom && emo < dfrom) return false;
      if(dto && emo > dto) return false;
    }
    return true;
  });
}

function ri(n){return Math.round(n)||0;}

let FERIADOS_SET = new Set();

function countBusinessDays(d1, d2) {
  if (!d1 || !d2) return 1;
  let count = 0;
  const start = new Date(Math.min(d1.getTime(), d2.getTime()));
  const end = new Date(Math.max(d1.getTime(), d2.getTime()));
  
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const day = d.getDay();
    if (day !== 0 && day !== 6) {
      const iso = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
      if (!FERIADOS_SET.has(iso)) count++;
    }
  }
  return count > 0 ? count : 1;
}

function buildAgg(entries,selUnits,selCats){
  const agg={};
  
  const unitActiveMonths = {};
  const unitActiveWeeks = {};
  const unitDates = {};

  entries.forEach(e=>{
    const wk=e.id;
    const mo=weekMonth(e);
    const yr=String(e.year||'?');
    const ws = e.weekStart ? new Date(e.weekStart + 'T12:00:00') : null;
    const we = e.weekEnd ? new Date(e.weekEnd + 'T12:00:00') : null;
    
    (e.units||[]).forEach(u=>{
      if(selUnits.size&&!selUnits.has(u.unitName))return;
      
      if(!unitDates[u.unitName]) unitDates[u.unitName] = { min: null, max: null };
      if(ws && (!unitDates[u.unitName].min || ws < unitDates[u.unitName].min)) unitDates[u.unitName].min = ws;
      if(we && (!unitDates[u.unitName].max || we > unitDates[u.unitName].max)) unitDates[u.unitName].max = we;
      
      if(!unitActiveMonths[u.unitName]) unitActiveMonths[u.unitName] = new Set();
      if(!unitActiveWeeks[u.unitName]) unitActiveWeeks[u.unitName] = new Set();
      unitActiveMonths[u.unitName].add(mo);
      unitActiveWeeks[u.unitName].add(wk);

      (u.categories||[]).forEach(c=>{
        if(selCats.size&&!selCats.has(c.catName))return;
        (c.items||[]).forEach(it=>{
          const matKey=normMat(it.material);
          const k=u.unitName+'\x00'+c.catName+'\x00'+matKey;
          if(!agg[k])agg[k]={unit:u.unitName,cat:c.catName,material:it.material,
            weekQtys:{},monthQtys:{},yearQtys:{}, total: 0};
          
          const wkKey=u.unitName+'\x01'+wk;
          const moKey=u.unitName+'\x01'+mo;
          const yrKey=u.unitName+'\x01'+yr;
          
          agg[k].weekQtys[wkKey]=(agg[k].weekQtys[wkKey]||0)+it.qty;
          agg[k].monthQtys[moKey]=(agg[k].monthQtys[moKey]||0)+it.qty;
          agg[k].total += it.qty;
          
          if(!agg[k].yearQtys[yrKey])agg[k].yearQtys[yrKey]={yr,total:0,months:new Set(),weeks:new Set()};
          agg[k].yearQtys[yrKey].total+=it.qty;
          agg[k].yearQtys[yrKey].months.add(mo);
          agg[k].yearQtys[yrKey].weeks.add(wk);
        });
      });
    });
  });

  // Build per-file breakdown for each item
  const fileLabels = {};
  entries.forEach(e => { fileLabels[e.id] = { label: e.weekLabel || '?', fileName: e.fileName, year: e.year }; });
  
  return Object.values(agg).map(a=>{
    const uMonths = unitActiveMonths[a.unit].size || 1;
    const uWeeks = unitActiveWeeks[a.unit].size || 1;
    
    const ud = unitDates[a.unit];
    let bDays = 1;
    if (ud && ud.min && ud.max) {
      bDays = countBusinessDays(ud.min, ud.max);
    }
    const realAvgWeek = (a.total / bDays) * 5; 
    const realAvgMonth = (a.total / bDays) * 22;

    const avgWeek = a.total / uWeeks;
    const avgMonth = a.total / uMonths;

    const yearBreakdown=Object.values(a.yearQtys).map(y=>({
      yr:y.yr,total:y.total,nMonths:y.months.size,nWeeks:y.weeks.size,
      avgMonth:y.months.size?ri(y.total/y.months.size):0,
      avgWeek:y.weeks.size?ri(y.total/y.weeks.size):0,
    })).sort((a,b)=>a.yr-b.yr);

    const monthBreakdown=Object.entries(a.monthQtys)
      .map(([k,v])=>({mo:k.split('\x01')[1],qty:v}))
      .sort((a,b)=>a.mo.localeCompare(b.mo));
    
    // Per-file exact quantities
    const perFile = Object.entries(a.weekQtys).map(([k,v]) => {
      const fileId = k.split('\x01')[1];
      const fl = fileLabels[fileId] || {};
      return { fileId, label: fl.label || '?', fileName: fl.fileName || '?', year: fl.year, qty: v };
    }).sort((a,b) => (a.label||'').localeCompare(b.label||''));

    return{
      unit:a.unit,cat:a.cat,material:a.material,
      weekQtys:a.weekQtys, monthQtys:a.monthQtys, monthBreakdown, yearBreakdown, perFile,
      uWeeks, uMonths, bDays, realAvgWeek: ri(realAvgWeek), realAvgMonth: ri(realAvgMonth),
      total: a.total,
      avgWeek: ri(avgWeek), avgMonth: ri(avgMonth), avgYear: ri(avgMonth*12)
    };
  });
}

function gerarRelatorio(){
  document.getElementById('rReport').innerHTML='<div style="text-align:center;padding:40px;color:var(--muted)"><div style="font-size:24px;margin-bottom:8px">⏳</div>Processando '+HIST_DB.length+' arquivo(s)...</div>';
  
  if (typeof getFeriadosISOSetCached === 'function') {
    getFeriadosISOSetCached().then(set => {
      FERIADOS_SET = set || new Set();
      requestAnimationFrame(()=>{ _gerarRelatorioImpl(); });
    }).catch(err => {
      console.error(err);
      requestAnimationFrame(()=>{ _gerarRelatorioImpl(); });
    });
  } else {
    requestAnimationFrame(()=>{ _gerarRelatorioImpl(); });
  }
}
function _gerarRelatorioImpl(){
  const selUnits=new Set([...document.getElementById('rFiltUnits').selectedOptions].map(o=>o.value));
  const selCats=new Set([...document.getElementById('rFiltCats').selectedOptions].map(o=>o.value));
  const showZeros=document.getElementById('rFiltZeros').checked;
  const mode=document.getElementById('rFiltMode').value;
  const groupBy=document.getElementById('rFiltGroup').value;
  const entries=filterEntries();

  if(!entries.length){
    document.getElementById('rReport').innerHTML='<div class="rel-empty"><div class="ic">🔍</div>Nenhum dado para os anos/filtros selecionados.</div>';
    return;
  }
  
  // Calcula o escopo global (Início e Fim do período que a Chefia quer analisar)
  const yearsInData = [...new Set(entries.map(e=>e.year).filter(Boolean))].sort();
  let expectedWs = null, expectedWe = null;
  if (yearsInData.length > 0) {
    let minYear = Math.min(...yearsInData);
    let maxYear = Math.max(...yearsInData);
    expectedWs = new Date(minYear, 0, 1, 12, 0, 0); // 1º de Jan do primeiro ano
    let currentYear = new Date().getFullYear();
    if (maxYear === currentYear) {
      expectedWe = new Date(); // Até hoje
      expectedWe.setHours(12,0,0,0);
    } else {
      expectedWe = new Date(maxYear, 11, 31, 12, 0, 0); // Até 31 de Dez
    }
  }

  const entriesByUnit = {};
  entries.forEach(e => {
    (e.units || []).forEach(u => {
      if(!entriesByUnit[u.unitName]) entriesByUnit[u.unitName] = [];
      entriesByUnit[u.unitName].push(e);
    });
  });

  const data=buildAgg(entries,selUnits,selCats).filter(a=>showZeros||a.total>0);
  LAST_REPORT_DATA=data;
  
  if(!data.length){
    document.getElementById('rReport').innerHTML='<div class="rel-empty"><div class="ic">📭</div>Nenhum item encontrado.<br><span style="font-size:11px;color:var(--muted)">Tente marcar "Mostrar zeros" ou ajuste os filtros.</span></div>';
    return;
  }

  const nMonthsTotal=new Set(entries.map(e=>weekMonth(e))).size;
  const nUnits=new Set(data.map(r=>r.unit)).size;
  const nAssumed=entries.filter(e=>e.yearAssumed).length;

  let mathNote='';
  if(HIST_DB_PARTIAL){
    mathNote+='<div class="math-note">📉 <b>Modo econômico ativo</b>: o relatório pode estar incompleto porque apenas parte do histórico foi carregada. '
      +'<button class="btn btn-s btn-sm" style="font-size:10px;margin-left:6px" onclick="loadAllHistDBAndRefresh()">Carregar tudo</button>'
      +'</div>';
  }
  if(nAssumed>0){
    mathNote+='<div class="math-note">⚠️ <b>'+nAssumed+' arquivo(s)</b> com ano não detectado automaticamente. '
      +'As médias podem estar incorretas — corrija os anos na lista de arquivos (clique em ⚠️).</div>';
  }

  let h=mathNote
    +'<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;flex-wrap:wrap;gap:8px">'
    +'<div><b style="font-size:14px">'
    +(mode==='standard'?'Consumo Real (Totais e Médias)':mode==='ranking'?'Ranking de Consumo':'Comparação Ano a Ano')
    +'</b>'
    +'<div style="font-size:11px;color:var(--muted)">'+data.length+' itens · '+nUnits+' unid. · '+entries.length+' envios · '+nMonthsTotal+' meses ativos</div>'
    +'</div>'
    +'<div>'+yearsInData.map(y=>'<span class="year-badge">'+y+'</span>').join('')+'</div></div>';

  if(mode==='standard'){
    if(groupBy==='unit'){
      const byunit={};data.forEach(r=>{
        if(!byunit[r.unit])byunit[r.unit]={};
        if(!byunit[r.unit][r.cat])byunit[r.unit][r.cat]={};
        byunit[r.unit][r.cat][r.material]=r;
      });
      h+=buildTableByUnit(byunit);
    }else if(groupBy==='cat'){
      const bycat={};data.forEach(r=>{
        if(!bycat[r.cat])bycat[r.cat]={};
        if(!bycat[r.cat][r.material])bycat[r.cat][r.material]=[];
        bycat[r.cat][r.material].push(r);
      });
      h+=buildTableByCat(bycat);
    }else{
      h+=buildTableByItem(data);
    }
  }else if(mode==='ranking'){
    h+=buildRankingTable(data);
  }else{
    h+=buildYearCompTable(data,yearsInData);
  }

  document.getElementById('rReport').innerHTML=h;
}

function buildTableByUnit(byunit){
  let h='<div class="tbl-wrap"><table class="rel-table"><thead><tr>'
    +'<th>Unidade / Categoria / Item</th>'
    +'<th class="num" title="Quantos meses e semanas esta unidade funcionou/recebeu">Período Ativo</th>'
    +'<th class="num" title="Consumo exato extraído das planilhas para o período selecionado">Total Exato</th>'
    
    +'</tr></thead><tbody>';
    
  for(const [un,cats] of Object.entries(byunit).sort()){
    const unitTotal=Object.values(cats).flatMap(m=>Object.values(m)).reduce((s,r)=>s+r.total,0);
    h+='<tr class="cat-hdr"><td colspan="3"><span class="rel-badge rel-badge-unit">'+esc(un)+'</span>'
      +' <span style="font-size:10px;color:#64748b">total consumido: '+unitTotal+'</span>'
      +'</td></tr>';
      
    for(const [cat,mats] of Object.entries(cats).sort()){
      const catTotal=Object.values(mats).reduce((s,r)=>s+r.total,0);
      h+='<tr><td colspan="3" style="padding:5px 10px 5px 20px;background:#f8fafc;font-weight:700;font-size:11px">'
        +'<span class="rel-badge rel-badge-cat">'+esc(cat)+'</span>'
        +' <span style="font-size:10px;color:#64748b;font-weight:400">subtotal da categoria: '+catTotal+'</span></td></tr>';
      for(const [mat,r] of Object.entries(mats).sort()){
        const rid='rd_'+Math.random().toString(36).substring(2,8);
        h+='<tr style="cursor:pointer" onclick="toggleDetail(\''+rid+'\')" title="Clique para detalhar por mês/ano">'
          +'<td style="padding-left:32px">'+esc(mat)+' <span style="font-size:9px;color:#94a3b8">▾</span></td>'
          +'<td class="num" style="color:var(--muted); font-size:10px;">'+r.uMonths+' meses<br>('+r.uWeeks+' planilhas)</td>'
          +'<td class="num" style="font-weight:800;font-size:13px;">'+r.total+'</td>'
          
          +'</tr>'
          +buildDetailRow(rid, r, 6);
      }
    }
  }
  return h+'</tbody></table></div>';
}

function buildTableByCat(bycat){
  let h='<div class="tbl-wrap"><table class="rel-table"><thead><tr>'
    +'<th>Categoria / Item</th><th>Unidade</th>'
    +'<th class="num">Planilhas</th>'
    +'<th class="num">Total Exato</th>'
    +'</tr></thead><tbody>';
  for(const [cat,mats] of Object.entries(bycat).sort()){
    const tot=Object.values(mats).flat().reduce((s,r)=>s+r.total,0);
    h+='<tr class="cat-hdr"><td colspan="7"><span class="rel-badge rel-badge-cat">'+esc(cat)+'</span>'
      +' <span style="font-size:11px;color:#64748b">total consumido na categoria: '+tot+'</span></td></tr>';
    for(const [mat,rows] of Object.entries(mats).sort()){
      rows.sort((a,b)=>a.unit.localeCompare(b.unit));
      rows.forEach((r,i)=>{
        const rid='rd_'+Math.random().toString(36).substring(2,8);
        h+='<tr style="cursor:pointer" onclick="toggleDetail(\''+rid+'\')">'
          +'<td style="padding-left:20px;font-weight:'+(i===0?700:400)+'">'+(i===0?esc(mat):'')+'</td>'
          +'<td class="unit-col"><span class="rel-badge rel-badge-unit">'+esc(r.unit)+'</span></td>'
          +'<td class="num" style="color:var(--muted);font-size:11px">'+r.uWeeks+'</td>'
          +'<td class="num" style="font-weight:800;font-size:13px">'+r.total+'</td>'
          +'</tr>'
          +buildDetailRow(rid,r,4);
      });
    }
  }
  return h+'</tbody></table></div>';
}

function buildTableByItem(data){
  const byMat={};
  data.forEach(r=>{
    const k=r.cat+'\x00'+r.material;
    if(!byMat[k])byMat[k]={mat:r.material,cat:r.cat,rows:[]};
    byMat[k].rows.push(r);
  });
  let h='<div class="tbl-wrap"><table class="rel-table"><thead><tr>'
    +'<th>Item</th><th>Categoria</th><th>Unidades</th>'
    +'<th class="num">Total Global</th>'
    +'</tr></thead><tbody>';
  for(const [k,mo] of Object.entries(byMat).sort()){
    const totalAll=mo.rows.reduce((s,r)=>s+r.total,0);
    const rid='rd_'+Math.random().toString(36).substring(2,8);
    h+='<tr style="cursor:pointer" onclick="toggleDetail(\''+rid+'\')">'
      +'<td style="font-weight:700">'+esc(mo.mat)+'</td>'
      +'<td><span class="rel-badge rel-badge-cat">'+esc(mo.cat)+'</span></td>'
      +'<td style="font-size:10px">'+mo.rows.map(r=>'<span class="rel-badge rel-badge-unit" style="margin:1px;font-size:9px">'+esc(r.unit)+'</span>').join('')+'</td>'
      +'<td class="num" style="font-weight:800;font-size:14px">'+totalAll+'</td>'
      +'</tr>'
      +'<tr id="'+rid+'" style="display:none"><td colspan="4" style="padding:4px 10px 10px 20px;background:#f0f9ff">'
      +'<table style="font-size:11px;width:100%"><tr style="color:var(--muted);font-size:10px;font-weight:700"><td>Unidade</td><td style="text-align:right">Total</td></tr>'
      +mo.rows.sort((a,b)=>b.total-a.total).map(r=>'<tr><td><span class="rel-badge rel-badge-unit">'+esc(r.unit)+'</span></td><td style="text-align:right;font-weight:700">'+r.total+'</td></tr>').join('')
      +'</table>'
      +'</td></tr>';
  }
  return h+'</tbody></table></div>';
}

function buildRankingTable(data){
  const itemFilter=document.getElementById('rRankItem').value.trim().toUpperCase();
  const byMat={};
  data.forEach(r=>{
    if(itemFilter&&!normMat(r.material).includes(itemFilter))return;
    const k=r.cat+'\x00'+r.material;
    if(!byMat[k])byMat[k]={mat:r.material,cat:r.cat,rows:[]};
    byMat[k].rows.push(r);
  });
  if(!Object.keys(byMat).length)return'<div class="rel-empty"><div class="ic">🔍</div>Nenhum item encontrado com esse filtro.</div>';

  let h='<div class="tbl-wrap"><table class="rel-table"><thead><tr>'
    +'<th>Item</th><th>Unidade</th><th class="num">Total Exato</th>'
    +'<th class="num">Planilhas</th>'
    +'<th>Volume</th></tr></thead><tbody>';

  for(const [k,mo] of Object.entries(byMat).sort()){
    const rowsSorted=[...mo.rows].sort((a,b)=>b.total-a.total);
    const maxTotal=rowsSorted[0].total||1;
    h+='<tr class="cat-hdr"><td colspan="5"><span class="rel-badge rel-badge-cat">'+esc(mo.cat)+'</span> '
      +'<b style="font-size:13px">'+esc(mo.mat)+'</b></td></tr>';
    rowsSorted.forEach((r,i)=>{
      const pct=Math.round((r.total/maxTotal)*100);
      const medal=i===0?'🥇':i===1?'🥈':i===2?'🥉':'';
      h+='<tr>'
        +'<td style="padding-left:16px;font-size:11px;color:var(--muted)">'+medal+'</td>'
        +'<td><span class="rel-badge rel-badge-unit">'+esc(r.unit)+'</span></td>'
        +'<td class="num" style="font-weight:800">'+r.total+'</td>'
        +'<td class="num" style="color:var(--muted)">'+r.uWeeks+'</td>'
        +'<td style="padding:6px 10px">'
        +'<div style="display:flex;align-items:center;gap:8px">'
        +'<span class="rank-bar" style="width:'+pct+'px;max-width:120px"></span>'
        +'<span style="font-size:10px;color:var(--muted)">'+pct+'%</span>'
        +'</div></td>'
        +'</tr>';
    });
  }
  return h+'</tbody></table></div>';
}

function buildYearCompTable(data,yearsInData){
  if(yearsInData.length<2)return'<div class="rel-empty"><div class="ic">📅</div>Selecione pelo menos 2 anos para comparar.<br><span style="font-size:11px;color:var(--muted)">Carregue arquivos de anos diferentes e marque ambos nos filtros de ano.</span></div>';

  const byKey={};
  data.forEach(r=>{
    const k=r.unit+'\x00'+r.cat+'\x00'+r.material;
    if(!byKey[k])byKey[k]={unit:r.unit,cat:r.cat,mat:r.material,byYear:{}};
    r.yearBreakdown.forEach(y=>{byKey[k].byYear[y.yr]=y;});
  });

  const sortedYears = [...yearsInData].sort();
  const yr2 = sortedYears[sortedYears.length-1];
  const yr1 = sortedYears.length > 1 ? sortedYears[sortedYears.length-2] : sortedYears[0];

  let h='<div class="math-note" style="background:#f0f9ff;border-color:#bae6fd;color:#0c4a6e">'
    +'📊 Comparando o consumo exato de <b>'+yr1+'</b> vs <b>'+yr2+'</b>. '
    +'</div>';

  h+='<div style="overflow-x:auto"><table class="rel-table"><thead><tr>'
    +'<th>Unidade / Item</th><th>Categoria</th>';
  sortedYears.forEach(y=>h+='<th class="num" style="background:'+( y===yr1?'#fef9c3':'#dbeafe' )+'">'+y+'</th>');
  h+='<th class="num">Variação Total Consumido</th></tr>'
    +'<tr style="font-size:10px;color:var(--muted)">'
    +'<th></th><th></th>';
  sortedYears.forEach(()=>h+='<th class="num">Total Real</th>');
  h+='<th class="num"></th></tr></thead><tbody>';

  const rows=Object.values(byKey).sort((a,b)=>a.unit.localeCompare(b.unit)||a.mat.localeCompare(b.mat));
  let lastUnit='';
  rows.forEach(r=>{
    if(r.unit!==lastUnit){
      lastUnit=r.unit;
      h+='<tr class="cat-hdr"><td colspan="'+(3+sortedYears.length*2)+'"><span class="rel-badge rel-badge-unit">'+esc(r.unit)+'</span></td></tr>';
    }
    const d1=r.byYear[yr1],d2=r.byYear[yr2];
    const m1=d1?d1.total:0, m2=d2?d2.total:0;
    const diff=m2-m1;
    const trendCls=diff>0?'trend-up':diff<0?'trend-dn':'trend-eq';
    const trendSym=diff>0?'▲':diff<0?'▼':'—';
    h+='<tr>'
      +'<td style="padding-left:16px;font-weight:600">'+esc(r.mat)+'</td>'
      +'<td><span class="rel-badge rel-badge-cat" style="font-size:9px">'+esc(r.cat)+'</span></td>';
    sortedYears.forEach(y=>{
      const d=r.byYear[y];
      if(d){h+='<td class="num" style="font-weight:700">'+(d.total||0)+'</td>';}
      else{h+='<td class="num" style="color:#cbd5e1">—</td>';}
    });
    h+='<td class="num '+trendCls+'">'+trendSym+' '+(diff?Math.abs(diff):'')+'</td>'
      +'</tr>';
  });
  return h+'</tbody></table></div>';
}

function buildDetailRow(rid,r,colspan){
  let inner = '';
  
  // Per-file exact breakdown
  if (r.perFile && r.perFile.length) {
    inner += '<div style="font-size:10px;font-weight:700;color:#475569;margin-bottom:4px">📋 Quantidade por Planilha/Semana:</div>';
    inner += '<table style="width:100%;font-size:11px;border-collapse:collapse">';
    inner += '<tr style="font-size:9px;color:var(--muted)"><td style="padding:2px 4px">Período</td><td style="padding:2px 4px">Arquivo</td><td style="text-align:right;padding:2px 4px">Qtd Exata</td></tr>';
    r.perFile.forEach(f => {
      inner += '<tr style="border-bottom:1px solid #e0f2fe"><td style="padding:3px 4px;font-weight:600;white-space:nowrap">' + esc(f.label) + '</td>'
        + '<td style="padding:3px 4px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;max-width:200px;white-space:nowrap" title="' + esc(f.fileName) + '">' + esc(f.fileName) + '</td>'
        + '<td style="text-align:right;padding:3px 4px;font-weight:800;color:#1e40af;font-size:12px">' + f.qty + '</td></tr>';
    });
    inner += '</table>';
  }
  
  // Year totals (compact)
  if (r.yearBreakdown && r.yearBreakdown.length > 1) {
    inner += '<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:6px">';
    r.yearBreakdown.forEach(y => {
      inner += '<span style="background:#f1f5f9;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:700">' + y.yr + ': ' + y.total + '</span>';
    });
    inner += '</div>';
  }
  
  return '<tr id="' + rid + '" style="display:none"><td colspan="' + colspan + '" style="padding:6px 10px 12px 42px;background:#f0f9ff">' + inner + '</td></tr>';
}

// ═══════════════════════════════════════════════════════════════════
// PAINEL DE GESTÃO
// ═══════════════════════════════════════════════════════════════════



// ═══════════════════════════════════════════════════════════════════
// CLASSIFICAÇÃO DE UNIDADES POR TIPO
// ═══════════════════════════════════════════════════════════════════
const UNIT_TYPES = [
  { id:'sede',     label:'Sede/Admin',       icon:'🏛️', color:'#6366f1', re:/sede|semcas|admin|astec|arquivo|contrato|alta\s*complex/i },
  { id:'cras',     label:'CRAS',             icon:'🏠', color:'#3b82f6', re:/^cras\b/i },
  { id:'creas',    label:'CREAS',            icon:'🏢', color:'#8b5cf6', re:/^creas\b/i },
  { id:'ct',       label:'CT',               icon:'🏫', color:'#06b6d4', re:/^ct\b/i },
  { id:'centropop',label:'Centro Pop',       icon:'🤝', color:'#14b8a6', re:/centro\s*pop/i },
  { id:'conselho', label:'Conselho/PROCAD',  icon:'📋', color:'#f59e0b', re:/conselho|procad|aepeti/i },
  { id:'abrigo',   label:'Abrigo/Acolhimento',icon:'🛏️', color:'#ef4444', re:/abrigo|acolh|resid[eê]ncia|rep[uú]blica|luz\s*e\s*vida|recanto|ilpi|casa|mulher|elizangela|pop\s*rua/i },
  { id:'externo',  label:'Unidade Externa',  icon:'🔗', color:'#64748b', re:/abordagem|externo/i },
];

function classifyUnit(name) {
  if (!name) return { id:'outros', label:'Outros', icon:'❓', color:'#94a3b8' };
  for (const t of UNIT_TYPES) {
    if (t.re.test(name)) return t;
  }
  return { id:'outros', label:'Outros', icon:'❓', color:'#94a3b8' };
}

let _panTipo = '', _panUnit = '';

function setPanTipo(id) {
  _panTipo = (_panTipo === id) ? '' : id;
  _panUnit = '';
  document.getElementById('panUnitSel').value = '';
  buildPainel();
}

function clearPanFilters() {
  _panTipo = ''; _panUnit = '';
  document.getElementById('panUnitSel').value = '';
  buildPainel();
}

function renderPanFilters(allUnits) {
  const filtersEl = document.getElementById('panFilters');
  filtersEl.style.display = 'block';
  
  // Count units per type
  const typeCounts = {};
  allUnits.forEach(u => {
    const t = classifyUnit(u);
    typeCounts[t.id] = (typeCounts[t.id] || 0) + 1;
  });
  
  // Render type chips
  const chipsEl = document.getElementById('panTipoChips');
  chipsEl.innerHTML = '<span class="tipo-chip' + (!_panTipo ? ' active' : '') + '" onclick="clearPanFilters()">📊 Geral</span>'
    + UNIT_TYPES.filter(t => typeCounts[t.id]).map(t => 
      '<span class="tipo-chip' + (_panTipo === t.id ? ' active' : '') + '" onclick="setPanTipo(\'' + t.id + '\')" style="' + (_panTipo === t.id ? 'background:' + t.color + ';border-color:' + t.color : '') + '">'
      + t.icon + ' ' + t.label + ' <span class="cnt">(' + (typeCounts[t.id]||0) + ')</span></span>'
    ).join('');
  
  // Render unit dropdown (filtered by type)
  const unitSel = document.getElementById('panUnitSel');
  const filteredUnits = _panTipo ? allUnits.filter(u => classifyUnit(u).id === _panTipo) : allUnits;
  const prevVal = _panUnit;
  const _ufCounts = {};
  filteredUnits.forEach(u => { _ufCounts[u] = getUnitFiles(u).length; });
  unitSel.innerHTML = '<option value="">— Todas' + (_panTipo ? ' do tipo ' + (UNIT_TYPES.find(t=>t.id===_panTipo)?.label||'') : '') + ' —</option>'
    + filteredUnits.sort().map(u => '<option value="' + esc(u) + '"' + (u === prevVal ? ' selected' : '') + '>' + esc(u) + ' (' + (_ufCounts[u]||0) + ' arq.)</option>').join('');
}

// ═══════════════════════════════════════════════════════════════════
// COMPARATIVO ENTRE UNIDADES DO MESMO TIPO
// ═══════════════════════════════════════════════════════════════════
function buildComparativo(allAgg, units, tipoLabel, tipoColor) {
  if (units.length < 2) return '';
  
  // Stats per unit
  const stats = units.map(u => {
    const rows = allAgg.filter(r => r.unit === u);
    const total = rows.reduce((s,r) => s + r.total, 0);
    const avgMonth = rows.reduce((s,r) => s + r.avgMonth, 0);
    const nItems = rows.length;
    const topItem = rows.sort((a,b) => b.avgMonth - a.avgMonth)[0];
    return { unit: u, total, avgMonth, nItems, topItem, tipo: classifyUnit(u) };
  }).sort((a,b) => b.total - a.total);
  
  const maxTotal = stats[0]?.total || 1;
  const avgTotal = stats.reduce((s,r) => s + r.total, 0) / stats.length;
  const avgMonthAll = stats.reduce((s,r) => s + r.avgMonth, 0) / stats.length;
  
  // Insights
  const top = stats[0], bottom = stats[stats.length - 1];
  const aboveAvg = stats.filter(s => s.total > avgTotal * 1.2);
  const belowAvg = stats.filter(s => s.total < avgTotal * 0.8);
  
  let h = '';
  
  // KPIs comparativos
  h += '<div class="comp-grid">';
  h += '<div class="comp-card"><div class="comp-card-title">Total do Tipo</div><div class="comp-card-val" style="color:' + tipoColor + '">' + stats.reduce((s,r)=>s+r.total,0).toLocaleString('pt-BR') + '</div><div class="comp-card-sub">itens consumidos · ' + units.length + ' unidades</div></div>';
  h += '<div class="comp-card"><div class="comp-card-title">Média por Unidade</div><div class="comp-card-val">' + Math.round(avgTotal).toLocaleString('pt-BR') + '</div><div class="comp-card-sub">total acumulado médio</div></div>';
  h += '<div class="comp-card"><div class="comp-card-title">Maior Consumo</div><div class="comp-card-val" style="color:#dc2626">' + esc(top.unit) + '</div><div class="comp-card-sub">' + top.total.toLocaleString('pt-BR') + ' itens · ' + Math.round((top.total/maxTotal)*100) + '% do máximo</div></div>';
  h += '<div class="comp-card"><div class="comp-card-title">Menor Consumo</div><div class="comp-card-val" style="color:#059669">' + esc(bottom.unit) + '</div><div class="comp-card-sub">' + bottom.total.toLocaleString('pt-BR') + ' itens · ' + Math.round((bottom.total/maxTotal)*100) + '% do máximo</div></div>';
  h += '</div>';
  
  // Insights textuais
  if (aboveAvg.length > 0) {
    h += '<div class="insight-card">📊 <b>' + aboveAvg.length + ' unidade(s) acima da média</b> (>' + Math.round(avgTotal*1.2) + '): '
      + aboveAvg.map(s => '<b>' + esc(s.unit) + '</b> (' + s.total + ')').join(', ')
      + '. Consumo ' + Math.round(((aboveAvg[0].total - avgTotal)/avgTotal)*100) + '% acima da média geral.</div>';
  }
  if (belowAvg.length > 0) {
    h += '<div class="insight-card" style="background:linear-gradient(135deg,#fef2f2,#fee2e2);border-color:#fecaca">⚠️ <b>' + belowAvg.length + ' unidade(s) abaixo da média</b> (<' + Math.round(avgTotal*0.8) + '): '
      + belowAvg.map(s => '<b>' + esc(s.unit) + '</b> (' + s.total + ')').join(', ')
      + '. Verificar se estão sendo abastecidas corretamente.</div>';
  }
  
  // Ranking visual
  h += '<div style="margin-top:12px">';
  stats.forEach((s, i) => {
    const pct = Math.round((s.total / maxTotal) * 100);
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : (i+1) + 'º';
    const barColor = s.total > avgTotal * 1.2 ? '#ef4444' : s.total < avgTotal * 0.8 ? '#f59e0b' : '#3b82f6';
    h += '<div class="comp-rank">'
      + '<div class="comp-rank-pos" style="background:' + (i < 3 ? tipoColor + '20' : '#f1f5f9') + ';color:' + (i < 3 ? tipoColor : '#94a3b8') + '">' + medal + '</div>'
      + '<div style="flex:1;min-width:0">'
      + '<div style="font-weight:700;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(s.unit) + '</div>'
      + '<div class="comp-bar"><div class="comp-bar-fill" style="width:' + pct + '%;background:' + barColor + '"></div></div>'
      + '</div>'
      + '<div style="text-align:right;min-width:90px">'
      + '<div style="font-weight:800;font-size:13px">' + s.total.toLocaleString('pt-BR') + '</div>'
      + '<div style="font-size:10px;color:var(--muted)">méd/mês: ' + Math.round(s.avgMonth) + '</div>'
      + '</div>'
      + '</div>';
  });
  h += '</div>';
  
  return h;
}

function buildRankingCategoriaTipo(allAgg, units, tipoColor) {
  const catTot = {};
  allAgg.filter(r => units.includes(r.unit)).forEach(r => {
    if (!catTot[r.cat]) catTot[r.cat] = { cat: r.cat, total: 0, items: new Set() };
    catTot[r.cat].total += r.total;
    catTot[r.cat].items.add(r.material);
  });
  
  const sorted = Object.values(catTot).sort((a,b) => b.total - a.total);
  if (!sorted.length) return '';
  
  const maxT = sorted[0].total || 1;
  const totalGeral = sorted.reduce((s,c) => s + c.total, 0);
  
  let h = '<table class="eff-table"><thead><tr><th>#</th><th>Categoria</th><th class="rn">Total Exato</th><th class="rn">%</th><th class="rn">Itens Distintos</th><th>Volume</th></tr></thead><tbody>';
  sorted.forEach((c, i) => {
    const pct = totalGeral ? Math.round((c.total / totalGeral) * 100) : 0;
    const barW = Math.round((c.total / maxT) * 100);
    h += '<tr><td style="font-weight:800;color:var(--muted)">' + (i+1) + '</td>'
      + '<td style="font-weight:700"><span class="rel-badge rel-badge-cat">' + esc(c.cat) + '</span></td>'
      + '<td class="rn" style="font-weight:800;color:' + tipoColor + '">' + c.total.toLocaleString('pt-BR') + '</td>'
      + '<td class="rn" style="color:var(--muted)">' + pct + '%</td>'
      + '<td class="rn">' + c.items.size + '</td>'
      + '<td><span class="rank-bar" style="width:' + Math.max(barW,2) + 'px;max-width:100px;background:' + tipoColor + '"></span></td>'
      + '</tr>';
  });
  return h + '</tbody></table>';
}

function buildTopItemsTipo(allAgg, units) {
  const byItem = {};
  allAgg.filter(r => units.includes(r.unit)).forEach(r => {
    const k = normMat(r.material);
    if (!byItem[k]) byItem[k] = { mat: r.material, cat: r.cat, total: 0, avgMonth: 0, unitCount: new Set() };
    byItem[k].total += r.total;
    byItem[k].avgMonth += r.avgMonth;
    byItem[k].unitCount.add(r.unit);
  });
  const top = Object.values(byItem).sort((a,b) => b.total - a.total).slice(0, 15);
  if (!top.length) return '<p style="color:var(--muted);font-size:12px">Sem dados.</p>';
  const maxT = top[0].total || 1;
  
  let h = '<table class="eff-table"><thead><tr><th>#</th><th>Item</th><th>Categoria</th><th class="rn">Total</th><th class="rn">Méd/mês</th><th class="rn">Unidades</th><th>Volume</th></tr></thead><tbody>';
  top.forEach((r, i) => {
    const pct = Math.round((r.total/maxT)*100);
    h += '<tr><td style="font-weight:800;color:var(--muted)">' + (i+1) + '</td>'
      + '<td style="font-weight:700">' + esc(r.mat) + '</td>'
      + '<td><span class="rel-badge rel-badge-cat" style="font-size:9px">' + esc(r.cat) + '</span></td>'
      + '<td class="rn" style="font-weight:800">' + r.total + '</td>'
      + '<td class="rn" style="color:#1e40af;font-weight:700">' + Math.round(r.avgMonth) + '</td>'
      + '<td class="rn">' + r.unitCount.size + '/' + units.length + '</td>'
      + '<td><span class="rank-bar" style="width:' + Math.max(pct,2) + 'px;max-width:100px"></span></td>'
      + '</tr>';
  });
  h += '</tbody></table>';
  
  // Items exclusivos de certas unidades
  const exclusivos = Object.values(byItem).filter(r => r.unitCount.size === 1 && r.total > 5);
  if (exclusivos.length > 0) {
    h += '<div class="insight-card" style="margin-top:10px">🔎 <b>' + exclusivos.length + ' item(ns) consumido(s) por apenas 1 unidade</b>: '
      + exclusivos.slice(0,5).map(r => '<b>' + esc(r.mat) + '</b> (' + [...r.unitCount][0] + ')').join(', ')
      + (exclusivos.length > 5 ? ' e mais ' + (exclusivos.length-5) + '...' : '') + '</div>';
  }
  
  return h;
}

function buildUnitProfile(allAgg, unitName, allYears) {
  const rows = allAgg.filter(r => r.unit === unitName);
  if (!rows.length) return '<p style="color:var(--muted)">Sem dados para esta unidade.</p>';
  
  const total = rows.reduce((s,r) => s + r.total, 0);
  const tipo = classifyUnit(unitName);
  const nCats = new Set(rows.map(r => r.cat)).size;
  const nItems = rows.length;
  const uMonths = rows[0]?.uMonths || 1;
  const uWeeks = rows[0]?.uWeeks || 1;
  const bDays = rows[0]?.bDays || 1;
  
  let h = '';
  
  // Header com perfil
  const unitFiles = getUnitFiles(unitName);
  
  h += '<div style="display:flex;gap:12px;align-items:center;margin-bottom:16px;flex-wrap:wrap">'
    + '<div style="width:48px;height:48px;border-radius:12px;background:' + tipo.color + '20;display:flex;align-items:center;justify-content:center;font-size:24px">' + tipo.icon + '</div>'
    + '<div style="flex:1"><div style="font-size:16px;font-weight:800">' + esc(unitName) + '</div>'
    + '<div style="font-size:11px;color:var(--muted)">' + tipo.label + ' · ' + uMonths + ' meses ativos · ' + bDays + ' dias úteis computados · ' + nCats + ' categorias · ' + nItems + ' itens · <b>' + unitFiles.length + ' arquivo(s)</b> no banco</div></div></div>';
  
  // Seção de arquivos de origem
  h += '<div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:10px;padding:12px;margin-bottom:16px">'
    + '<div style="font-weight:800;font-size:12px;margin-bottom:6px;color:#0369a1">📂 Arquivos de Origem (' + unitFiles.length + ')</div>'
    + buildUnitFilesHTML(unitName)
    + '</div>';
  
  // KPIs da unidade
  h += '<div class="comp-grid">'
    + '<div class="comp-card"><div class="comp-card-title">Consumo Total Real</div><div class="comp-card-val" style="color:' + tipo.color + '">' + total.toLocaleString('pt-BR') + '</div><div class="comp-card-sub">itens entregues acumulados</div></div>'
    + '<div class="comp-card"><div class="comp-card-title">Média Mensal Real</div><div class="comp-card-val">' + Math.round(total / (bDays/22)) + '</div><div class="comp-card-sub">itens/mês (dias úteis)</div></div>'
    + '<div class="comp-card"><div class="comp-card-title">Suprimento Semanal</div><div class="comp-card-val">' + Math.round(total / (bDays/5)) + '</div><div class="comp-card-sub">itens/semana p/ suprir</div></div>'
    + '<div class="comp-card"><div class="comp-card-title">Projeção Anual</div><div class="comp-card-val">' + Math.round(total / (bDays/252)).toLocaleString('pt-BR') + '</div><div class="comp-card-sub">estimativa 12 meses</div></div>'
    + '</div>';
  
  // Top 10 itens
  const topItems = [...rows].sort((a,b) => b.realAvgWeek - a.realAvgWeek).slice(0, 15);
  h += '<div style="margin-top:12px"><div style="font-weight:800;font-size:12px;margin-bottom:8px">Top 15 Itens (Quantidade Real p/ Suprir Semanalmente)</div>';
  const maxAvg = topItems[0]?.realAvgWeek || 1;
  topItems.forEach((r, i) => {
    const pct = Math.round((r.realAvgWeek / maxAvg) * 100);
    h += '<div class="comp-rank">'
      + '<div class="comp-rank-pos" style="background:#f1f5f9;color:' + tipo.color + ';font-size:10px">' + (i+1) + '</div>'
      + '<div style="flex:1"><div style="font-weight:600;font-size:11px">' + esc(r.material) + ' <span style="color:var(--muted);font-size:9px">' + esc(r.cat) + '</span></div>'
      + '<div class="comp-bar"><div class="comp-bar-fill" style="width:' + pct + '%;background:' + tipo.color + '"></div></div></div>'
      + '<div style="text-align:right"><div style="font-weight:800;color:#10b981">' + r.realAvgWeek + ' p/ semana</div>'
      + '<div style="font-size:10px;color:var(--muted)">total entregue: ' + r.total + '</div></div></div>';
  });
  h += '</div>';
  
  // Distribuição por categoria
  const catTot = {};
  rows.forEach(r => { catTot[r.cat] = (catTot[r.cat]||0) + r.total; });
  const catSorted = Object.entries(catTot).sort((a,b) => b[1] - a[1]);
  const catMax = catSorted[0]?.[1] || 1;
  h += '<div style="margin-top:16px"><div style="font-weight:800;font-size:12px;margin-bottom:8px">Distribuição por Categoria</div>';
  const colors = ['#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#84cc16'];
  catSorted.forEach(([cat, tot], i) => {
    const pct = (tot/total*100).toFixed(1);
    h += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;font-size:11px">'
      + '<span style="min-width:120px;font-weight:600">' + esc(cat) + '</span>'
      + '<div style="flex:1;height:10px;background:#f1f5f9;border-radius:5px;overflow:hidden"><div style="height:100%;width:' + pct + '%;background:' + colors[i%colors.length] + ';border-radius:5px"></div></div>'
      + '<span style="min-width:60px;text-align:right;font-weight:700">' + pct + '%</span></div>';
  });
  h += '</div>';
  
  // Evolução por ano (se houver)
  if (allYears.length >= 2) {
    h += '<div style="margin-top:16px"><div style="font-weight:800;font-size:12px;margin-bottom:8px">Evolução Anual</div>';
    const yrData = {};
    rows.forEach(r => r.yearBreakdown.forEach(y => { yrData[y.yr] = (yrData[y.yr]||0) + y.total; }));
    const yrSorted = Object.entries(yrData).sort();
    if (yrSorted.length >= 2) {
      const prev = yrSorted[yrSorted.length-2], curr = yrSorted[yrSorted.length-1];
      const diff = curr[1] - prev[1];
      const pctChange = prev[1] ? Math.round((diff/prev[1])*100) : 0;
      h += '<div class="insight-card">' + (diff > 0 ? '📈' : diff < 0 ? '📉' : '➡️')
        + ' <b>' + prev[0] + ' → ' + curr[0] + ':</b> '
        + (diff > 0 ? '+' : '') + diff + ' itens (' + (diff >= 0 ? '+' : '') + pctChange + '%). '
        + 'Total ' + prev[0] + ': <span class="val">' + prev[1] + '</span> → '
        + curr[0] + ': <span class="val">' + curr[1] + '</span></div>';
    }
    h += '</div>';
  }
  
  return h;
}


// ═══════════════════════════════════════════════════════════════════
// MAPEAMENTO UNIDADE → ARQUIVOS
// ═══════════════════════════════════════════════════════════════════
function getUnitFiles(unitName) {
  const files = [];
  HIST_DB.forEach(e => {
    const hasUnit = (e.units||[]).some(u => u.unitName === unitName);
    if (hasUnit) {
      files.push({
        id: e.id,
        fileName: e.fileName,
        weekLabel: e.weekLabel || '?',
        year: e.year,
        yearAssumed: e.yearAssumed,
        month: e.month,
        nItems: (e.units||[]).filter(u=>u.unitName===unitName).flatMap(u=>(u.categories||[]).flatMap(c=>c.items)).length
      });
    }
  });
  // Ordenar por data
  files.sort((a,b) => {
    if (a.year !== b.year) return (a.year||0) - (b.year||0);
    return (a.month||0) - (b.month||0);
  });
  return files;
}

function buildUnitFilesHTML(unitName) {
  const files = getUnitFiles(unitName);
  if (!files.length) return '<div style="font-size:11px;color:var(--muted)">Nenhum arquivo encontrado.</div>';
  
  let h = '<div style="max-height:200px;overflow-y:auto">';
  const byYear = {};
  files.forEach(f => { const y = f.year||'?'; if(!byYear[y]) byYear[y]=[]; byYear[y].push(f); });
  
  Object.entries(byYear).sort((a,b)=>+b[0]-+a[0]).forEach(([yr, fls]) => {
    h += '<div style="font-size:10px;font-weight:800;color:var(--muted);margin-top:6px;margin-bottom:3px">' 
      + yr + ' <span style="font-weight:400">(' + fls.length + ' arquivo' + (fls.length>1?'s':'') + ')</span></div>';
    fls.forEach(f => {
      const yrIcon = f.yearAssumed ? '<span style="color:#f59e0b" title="Ano assumido">⚠️</span>' : '<span style="color:#10b981">🟢</span>';
      h += '<div style="display:flex;align-items:center;gap:6px;padding:3px 6px;margin-bottom:2px;background:#f8fafc;border-radius:5px;font-size:10px">'
        + yrIcon
        + '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600" title="' + esc(f.fileName) + '">' + esc(f.fileName) + '</span>'
        + '<span style="color:var(--muted);flex-shrink:0">' + esc(f.weekLabel) + '</span>'
        + '<span style="color:var(--accent);flex-shrink:0;font-weight:700">' + f.nItems + ' itens</span>'
        + '</div>';
    });
  });
  h += '</div>';
  return h;
}


// ═══════════════════════════════════════════════════════════════════
// ABA BURACOS — Análise detalhada de continuidade
// ═══════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════
// NAVEGAÇÃO ARQUIVO — Inspecionar e ir direto ao banco de dados
// ═══════════════════════════════════════════════════════════════════
function getFileDetail(fileId) {
  const e = HIST_DB.find(x => x.id === fileId);
  if (!e) return null;
  return {
    id: e.id,
    fileName: e.fileName,
    weekLabel: e.weekLabel || '?',
    year: e.year,
    yearAssumed: e.yearAssumed,
    units: (e.units || []).map(u => ({
      unitName: u.unitName,
      rawUnit: u.rawUnit || u.unitName,
      categories: (u.categories || []).map(c => ({
        catName: c.catName,
        nItems: c.items.length,
        totalQty: c.items.reduce((s, i) => s + (i.qty || 0), 0)
      }))
    }))
  };
}

function buildFileInspector(fileId) {
  const d = getFileDetail(fileId);
  if (!d) return '<span style="color:var(--muted);font-size:10px">Arquivo não encontrado</span>';
  
  let h = '<div class="fi-body">';
  h += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">';
  h += '<div><b>' + esc(d.fileName) + '</b><br><span style="color:var(--muted);font-size:10px">' + esc(d.weekLabel) + ' · ' + d.year + (d.yearAssumed ? ' ⚠️' : ' 🟢') + '</span></div>';
  h += '<button class="fi-go-btn" onclick="event.stopPropagation();goToFile(\'' + d.id + '\')">📂 Ir ao Banco de Dados →</button>';
  h += '</div>';
  
  d.units.forEach(u => {
    h += '<div class="fi-unit">';
    h += '<div class="fi-unit-name">' + esc(u.unitName);
    if (u.rawUnit !== u.unitName) h += ' <span style="font-size:9px;color:#d97706;font-weight:400">(original: ' + esc(u.rawUnit) + ')</span>';
    h += '</div>';
    u.categories.forEach(c => {
      h += '<div class="fi-cat"><span>' + esc(c.catName) + '</span><span style="color:var(--muted)">' + c.nItems + ' itens · qtd: ' + c.totalQty + '</span></div>';
    });
    h += '</div>';
  });
  h += '</div>';
  return h;
}


// ═══════════════════════════════════════════════════════════════════
// ORIGEM — Rastrear unidade/categoria até o arquivo fonte
// ═══════════════════════════════════════════════════════════════════
function showOrigemUnidade() {
  const el = document.getElementById('origemUnidade');
  const sel = [...document.getElementById('rFiltUnits').selectedOptions].map(o => o.value);
  if (!sel.length) { el.innerHTML = ''; return; }
  
  let h = '';
  sel.forEach(unitName => {
    // Buscar todos os arquivos que contêm essa unidade
    const files = [];
    HIST_DB.forEach(e => {
      const match = (e.units || []).filter(u => u.unitName === unitName);
      if (match.length) {
        const cats = match.flatMap(u => (u.categories || []).map(c => c.catName));
        const rawNames = [...new Set(match.map(u => u.rawUnit || u.unitName))];
        files.push({ id: e.id, fileName: e.fileName, year: e.year, weekLabel: e.weekLabel || '?', yearAssumed: e.yearAssumed, cats, rawNames });
      }
    });
    
    h += '<div class="origem-box">';
    h += '<div style="font-weight:800;font-size:10px;color:#0369a1;margin-bottom:4px">📂 ' + esc(unitName) + ' — encontrada em ' + files.length + ' arquivo(s):</div>';
    
    if (!files.length) {
      h += '<div style="color:var(--muted)">Nenhum arquivo encontrado.</div>';
    } else {
      files.forEach(f => {
        const yr = f.yearAssumed ? '⚠️' + f.year : '🟢' + f.year;
        const rawDiff = f.rawNames.filter(r => r !== unitName);
        h += '<div class="origem-item">';
        h += '<span class="origem-fname" title="' + esc(f.fileName) + '">' + esc(f.fileName) + '</span>';
        if (rawDiff.length) h += '<span style="color:#d97706;font-size:9px;font-weight:700" title="Nome original na planilha">(' + esc(rawDiff[0]) + ')</span>';
        h += '<span class="origem-meta">' + yr + ' · ' + esc(f.weekLabel) + '</span>';
        h += '<button class="fi-go-btn" onclick="goToFile(\'' + f.id + '\')" style="flex-shrink:0">Ir →</button>';
        h += '</div>';
      });
    }
    h += '</div>';
  });
  
  el.innerHTML = h;
}

function showOrigemCategoria() {
  const el = document.getElementById('origemCategoria');
  const sel = [...document.getElementById('rFiltCats').selectedOptions].map(o => o.value);
  if (!sel.length) { el.innerHTML = ''; return; }
  
  let h = '';
  sel.forEach(catName => {
    const files = [];
    HIST_DB.forEach(e => {
      const matchUnits = [];
      (e.units || []).forEach(u => {
        const hasCat = (u.categories || []).some(c => c.catName === catName);
        if (hasCat) matchUnits.push(u.unitName);
      });
      if (matchUnits.length) {
        files.push({ id: e.id, fileName: e.fileName, year: e.year, weekLabel: e.weekLabel || '?', yearAssumed: e.yearAssumed, units: [...new Set(matchUnits)] });
      }
    });
    
    h += '<div class="origem-box">';
    h += '<div style="font-weight:800;font-size:10px;color:#0369a1;margin-bottom:4px">📂 Categoria "' + esc(catName) + '" — encontrada em ' + files.length + ' arquivo(s):</div>';
    
    if (!files.length) {
      h += '<div style="color:var(--muted)">Nenhum arquivo encontrado.</div>';
    } else {
      files.forEach(f => {
        const yr = f.yearAssumed ? '⚠️' + f.year : '🟢' + f.year;
        h += '<div class="origem-item">';
        h += '<span class="origem-fname" title="' + esc(f.fileName) + '">' + esc(f.fileName) + '</span>';
        h += '<span style="font-size:9px;color:#475569">' + f.units.map(u => esc(u)).join(', ') + '</span>';
        h += '<span class="origem-meta">' + yr + ' · ' + esc(f.weekLabel) + '</span>';
        h += '<button class="fi-go-btn" onclick="goToFile(\'' + f.id + '\')" style="flex-shrink:0">Ir →</button>';
        h += '</div>';
      });
    }
    h += '</div>';
  });
  
  el.innerHTML = h;
}

function goToFile(fileId) {
  // Find which page this file is on
  const idx = HIST_DB.findIndex(e => e.id === fileId);
  if (idx < 0) { toast('Arquivo não encontrado no banco.', 'red'); return; }
  
  const pageSize = 20; // file list uses 20
  const page = Math.floor(idx / pageSize) + 1;
  PAGE_STATE.files = page;
  
  // Switch to Relatório tab
  goTab('rel');
  
  // After render, highlight the file
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const fileItems = document.querySelectorAll('#rFileList .file-item');
      const posInPage = idx % pageSize;
      if (fileItems[posInPage]) {
        fileItems[posInPage].classList.add('file-highlight');
        fileItems[posInPage].scrollIntoView({ behavior: 'smooth', block: 'center' });
        setTimeout(() => fileItems[posInPage].classList.remove('file-highlight'), 3000);
      }
    });
  });
}

function toggleFileInspector(btnEl, fileId) {
  event.stopPropagation();
  const container = btnEl.closest('.unif-card') || btnEl.closest('.gap-unit') || btnEl.parentElement;
  let inspector = container.querySelector('.file-inspector');
  
  if (inspector) {
    inspector.remove();
    return;
  }
  
  inspector = document.createElement('div');
  inspector.className = 'file-inspector';
  inspector.innerHTML = buildFileInspector(fileId);
  container.appendChild(inspector);
}

function showUnitFiles(btnEl, unitName) {
  event.stopPropagation();
  const container = btnEl.closest('.unif-card');
  let panel = container.querySelector('.unif-files-panel');
  
  if (panel) {
    panel.remove();
    return;
  }
  
  const files = [];
  HIST_DB.forEach(e => {
    const matchUnits = (e.units || []).filter(u => u.unitName === unitName);
    if (matchUnits.length) {
      files.push({ id: e.id, fileName: e.fileName, weekLabel: e.weekLabel || '?', year: e.year, yearAssumed: e.yearAssumed,
        units: matchUnits.map(u => ({ unitName: u.unitName, rawUnit: u.rawUnit, categories: (u.categories||[]).map(c => ({ catName: c.catName, nItems: c.items.length })) }))
      });
    }
  });
  
  files.sort((a, b) => (b.year || 0) - (a.year || 0));
  
  panel = document.createElement('div');
  panel.className = 'unif-files-panel';
  panel.style.cssText = 'margin-top:8px;border-top:1px solid var(--border);padding-top:8px;max-height:280px;overflow-y:auto';
  
  let h = '<div style="font-size:10px;font-weight:800;color:var(--muted);margin-bottom:6px">📂 ARQUIVOS QUE CONTÊM ESTA UNIDADE (' + files.length + ')</div>';
  
  files.forEach(f => {
    const yrIcon = f.yearAssumed ? '⚠️' : '🟢';
    const cats = f.units.flatMap(u => u.categories);
    const rawName = f.units[0]?.rawUnit || '';
    const hasRawDiff = rawName && rawName !== unitName;
    
    h += '<div style="background:#fff;border:1px solid var(--border);border-radius:8px;padding:8px 10px;margin-bottom:4px;font-size:11px">';
    h += '<div style="display:flex;align-items:center;gap:6px;justify-content:space-between">';
    h += '<div style="flex:1;min-width:0">';
    h += '<div style="font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + esc(f.fileName) + '">' + yrIcon + ' ' + esc(f.fileName) + '</div>';
    h += '<div style="color:var(--muted);font-size:10px">' + esc(f.weekLabel) + ' · ' + f.year;
    if (hasRawDiff) h += ' · <span style="color:#d97706">nome original: <b>' + esc(rawName) + '</b></span>';
    h += '</div>';
    h += '</div>';
    h += '<button class="fi-go-btn" onclick="event.stopPropagation();goToFile(\'' + f.id + '\')">Ir →</button>';
    h += '</div>';
    
    // Categories
    if (cats.length) {
      h += '<div style="display:flex;flex-wrap:wrap;gap:3px;margin-top:4px">';
      cats.forEach(c => {
        h += '<span style="background:#f1f5f9;padding:1px 6px;border-radius:4px;font-size:9px;font-weight:600">' + esc(c.catName) + ' (' + c.nItems + ')</span>';
      });
      h += '</div>';
    }
    h += '</div>';
  });
  
  panel.innerHTML = h;
  container.appendChild(panel);
}


const CONTINUIDADE_REGEX = /abrigo|casa|resid[eê]ncia|acolher|rep[uú]blica|luz e vida|recanto|ilpi|cat|acolhimento|mulheres|centro\s*pop|pop\s*rua/i;
function needsContinuidade(name) { return CONTINUIDADE_REGEX.test(name); }


// ═══════════════════════════════════════════════════════════════════
// IMPRESSÃO — Relatório de Buracos em A4
// ═══════════════════════════════════════════════════════════════════
function openPrintBuracos() {
  const panel = document.getElementById('printBuracosPanel');
  panel.style.display = 'block';
  
  // Populate year
  const allYears = [...new Set(HIST_DB.map(e => e.year).filter(Boolean))].sort();
  const ySel = document.getElementById('printBurYear');
  const curBurYear = document.getElementById('burYearSel').value;
  ySel.innerHTML = '<option value="">Todos os anos</option>' + allYears.map(y => '<option value="'+y+'"'+(String(y)===curBurYear?' selected':'')+'>'+y+'</option>').join('');
  
  // Populate units
  const unitNames = new Set();
  HIST_DB.forEach(e => (e.units||[]).forEach(u => { if(needsContinuidade(u.unitName)) unitNames.add(u.unitName); }));
  const uSel = document.getElementById('printBurUnits');
  uSel.innerHTML = [...unitNames].sort().map(u => '<option value="'+esc(u)+'">'+esc(u)+'</option>').join('');
}

function doPrintBuracos() {
  const selYear = document.getElementById('printBurYear').value ? +document.getElementById('printBurYear').value : null;
  const selUnits = new Set([...document.getElementById('printBurUnits').selectedOptions].map(o => o.value));
  
  const entries = selYear ? HIST_DB.filter(e => e.year === selYear) : HIST_DB;
  const today = new Date(); today.setHours(12,0,0,0);
  
  let periodStart, periodEnd;
  if (selYear) {
    periodStart = new Date(selYear, 0, 1, 12);
    periodEnd = selYear === today.getFullYear() ? new Date(today) : new Date(selYear, 11, 31, 12);
  } else {
    const yrs = [...new Set(entries.map(e=>e.year).filter(Boolean))].sort();
    periodStart = new Date(Math.min(...yrs), 0, 1, 12);
    const maxY = Math.max(...yrs);
    periodEnd = maxY === today.getFullYear() ? new Date(today) : new Date(maxY, 11, 31, 12);
  }
  
  // Collect units
  const unitEntries = {};
  entries.forEach(e => {
    (e.units||[]).forEach(u => {
      if (!needsContinuidade(u.unitName)) return;
      if (selUnits.size && !selUnits.has(u.unitName)) return;
      if (!unitEntries[u.unitName]) unitEntries[u.unitName] = [];
      unitEntries[u.unitName].push(e);
    });
  });
  
  const unitNames = Object.keys(unitEntries).sort();
  if (!unitNames.length) { toast('Nenhuma unidade encontrada.','red'); return; }
  
  const results = unitNames.map(u => buildGapReport(u, unitEntries[u], periodStart, periodEnd));
  results.sort((a,b) => b.missingDays - a.missingDays);
  
  // Build A4 HTML
  let body = '';
  
  // Header
  body += '<div style="text-align:center;margin-bottom:16px;border-bottom:3px solid #0f172a;padding-bottom:10px">';
  body += '<div style="font-size:14px;font-weight:800;text-transform:uppercase">Prefeitura de São Luís</div>';
  body += '<div style="font-size:12px;font-weight:700;text-transform:uppercase">Secretaria Municipal da Criança e Assistência Social – SEMCAS</div>';
  body += '<div style="font-size:10px;font-weight:600;color:#475569;text-transform:uppercase">Coordenação de Administração e Patrimônio</div>';
  body += '</div>';
  
  body += '<h1 style="font-size:16px;font-weight:800;margin-bottom:4px">Relatório de Buracos no Abastecimento</h1>';
  body += '<div style="font-size:11px;color:#475569;margin-bottom:12px">';
  body += 'Data do relatório: <b>' + fmtD(today) + '</b> · ';
  body += 'Período analisado: <b>' + fmtD(periodStart) + ' a ' + fmtD(periodEnd) + '</b>';
  if (selYear) body += ' · Ano: <b>' + selYear + '</b>';
  body += ' · Unidades: <b>' + results.length + '</b>';
  body += '</div>';
  
  // Summary table
  const totalMissing = results.reduce((s,r) => s + r.missing.length, 0);
  const totalMissingDays = results.reduce((s,r) => s + r.missingDays, 0);
  const okCount = results.filter(r => r.missing.length === 0).length;
  
  body += '<table style="width:100%;border-collapse:collapse;font-size:11px;margin-bottom:16px;border:1px solid #e2e8f0">';
  body += '<tr><td style="padding:6px 10px;background:#f0fdf4;font-weight:700;border:1px solid #e2e8f0">✅ Completos</td><td style="padding:6px 10px;font-weight:800;border:1px solid #e2e8f0">' + okCount + '</td>';
  body += '<td style="padding:6px 10px;background:#fef2f2;font-weight:700;border:1px solid #e2e8f0">🔴 Com Falhas</td><td style="padding:6px 10px;font-weight:800;border:1px solid #e2e8f0">' + (results.length - okCount) + '</td>';
  body += '<td style="padding:6px 10px;background:#f8fafc;font-weight:700;border:1px solid #e2e8f0">Períodos Faltando</td><td style="padding:6px 10px;font-weight:800;border:1px solid #e2e8f0">' + totalMissing + '</td>';
  body += '<td style="padding:6px 10px;background:#fefce8;font-weight:700;border:1px solid #e2e8f0">Dias Descobertos</td><td style="padding:6px 10px;font-weight:800;border:1px solid #e2e8f0">' + totalMissingDays + '</td></tr>';
  body += '</table>';
  
  // Each unit
  results.forEach(r => {
    const tipo = classifyUnit(r.unit);
    const hasMissing = r.missing.length > 0;
    
    body += '<div style="border:1px solid #e2e8f0;border-radius:8px;margin-bottom:14px;overflow:hidden;page-break-inside:avoid">';
    
    // Unit header
    body += '<div style="background:' + (hasMissing ? '#fef2f2' : '#f0fdf4') + ';padding:8px 12px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #e2e8f0">';
    body += '<div><span style="font-size:14px">' + tipo.icon + '</span> <b style="font-size:13px">' + esc(r.unit) + '</b>';
    body += '<span style="font-size:10px;color:#475569;margin-left:8px">' + r.files.length + ' arquivo(s) · Cadência ~' + (r.cadenceDays||7) + ' dias</span></div>';
    body += '<span style="font-size:11px;font-weight:700;padding:3px 10px;border-radius:10px;' + (hasMissing ? 'background:#fee2e2;color:#991b1b' : 'background:#d1fae5;color:#065f46') + '">';
    body += hasMissing ? '🔴 ' + r.missingDays + ' dias sem abastecimento' : '✅ Completo';
    body += '</span></div>';
    
    // Timeline visual (compact for print)
    body += '<div style="padding:8px 12px;display:flex;flex-wrap:wrap;gap:2px">';
    r.timeline.forEach(t => {
      const bg = t.type === 'covered' ? '#d1fae5' : '#fee2e2';
      const border = t.type === 'covered' ? '#6ee7b7' : '#fca5a5';
      body += '<div style="background:' + bg + ';border:1px solid ' + border + ';border-radius:4px;padding:2px 6px;font-size:8px;font-weight:700">';
      body += (t.type === 'covered' ? '✅ ' : '❌ ') + t.label + ' (' + t.days + 'd)';
      body += '</div>';
    });
    body += '</div>';
    
    // File map
    if (r.files.length > 0) {
      body += '<div style="padding:4px 12px"><div style="font-size:9px;font-weight:800;color:#475569;margin-bottom:3px">ARQUIVOS CARREGADOS:</div>';
      body += '<table style="width:100%;font-size:9px;border-collapse:collapse">';
      body += '<tr style="background:#f8fafc;font-weight:700"><td style="padding:2px 4px;border:1px solid #e2e8f0">Arquivo</td><td style="padding:2px 4px;border:1px solid #e2e8f0">Início</td><td style="padding:2px 4px;border:1px solid #e2e8f0">Fim</td><td style="padding:2px 4px;border:1px solid #e2e8f0">Dias</td></tr>';
      r.files.forEach(f => {
        const dur = f.ws && f.we ? Math.round((f.we - f.ws) / 86400000) + 1 : '?';
        body += '<tr><td style="padding:2px 4px;border:1px solid #f1f5f9">' + esc(f.fileName) + '</td>';
        body += '<td style="padding:2px 4px;border:1px solid #f1f5f9">' + (f.ws ? fmtD(f.ws) : '—') + '</td>';
        body += '<td style="padding:2px 4px;border:1px solid #f1f5f9">' + (f.we ? fmtD(f.we) : '—') + '</td>';
        body += '<td style="padding:2px 4px;border:1px solid #f1f5f9;font-weight:700">' + dur + '</td></tr>';
      });
      body += '</table></div>';
    }
    
    // Missing periods
    if (r.missing.length > 0) {
      body += '<div style="padding:4px 12px 8px"><div style="font-size:9px;font-weight:800;color:#991b1b;margin-bottom:3px">PERÍODOS FALTANTES (' + r.missing.length + '):</div>';
      body += '<table style="width:100%;font-size:9px;border-collapse:collapse">';
      body += '<tr style="background:#fef2f2;font-weight:700;color:#991b1b"><td style="padding:2px 4px;border:1px solid #fecaca">#</td><td style="padding:2px 4px;border:1px solid #fecaca">De</td><td style="padding:2px 4px;border:1px solid #fecaca">Até</td><td style="padding:2px 4px;border:1px solid #fecaca">Dias</td><td style="padding:2px 4px;border:1px solid #fecaca">Observação</td></tr>';
      r.missing.forEach((m, i) => {
        body += '<tr><td style="padding:2px 4px;border:1px solid #fecaca;font-weight:800">' + (i+1) + '</td>';
        body += '<td style="padding:2px 4px;border:1px solid #fecaca;font-weight:700">' + fmtD(m.from) + '</td>';
        body += '<td style="padding:2px 4px;border:1px solid #fecaca">' + fmtD(m.to) + '</td>';
        body += '<td style="padding:2px 4px;border:1px solid #fecaca;font-weight:700;color:#dc2626">' + m.days + '</td>';
        body += '<td style="padding:2px 4px;border:1px solid #fecaca;color:#475569">' + esc(m.note) + '</td></tr>';
      });
      body += '</table></div>';
    } else {
      body += '<div style="padding:6px 12px;font-size:10px;color:#065f46">✅ Abastecimento contínuo em todo o período analisado.</div>';
    }
    
    body += '</div>';
  });
  
  // Footer
  body += '<div style="margin-top:20px;padding-top:10px;border-top:1px solid #e2e8f0;font-size:9px;color:#94a3b8;display:flex;justify-content:space-between">';
  body += '<span>Gerado pelo Sistema SEMCAS Almoxarifado em ' + fmtD(today) + '</span>';
  body += '<span>Página única — ' + results.length + ' unidade(s) analisada(s)</span>';
  body += '</div>';
  
  // Open print window
  const w = window.open('', '_blank', 'width=850,height=1100');
  if (!w) { toast('Permita popups para imprimir!', 'red'); return; }
  
  w.document.write('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Relatório de Buracos - SEMCAS</title><style>');
  w.document.write('*{box-sizing:border-box;margin:0;padding:0}');
  w.document.write('body{font-family:"Segoe UI",system-ui,sans-serif;color:#0f172a;padding:12mm 10mm;background:#fff;font-size:11px}');
  w.document.write('@page{size:A4 portrait;margin:8mm}');
  w.document.write('@media print{*{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;color-adjust:exact!important}}');
  w.document.write('</style></head><body>');
  w.document.write(body);
  w.document.write('<script>window.onload=function(){window.print()}<\/script>');
  w.document.write('</body></html>');
  w.document.close();
  
  document.getElementById('printBuracosPanel').style.display = 'none';
}

function renderBuracos() {
  const el = document.getElementById('buracosContent');
  if (!HIST_DB.length) {
    el.innerHTML = '<div class="empty"><div class="ic">🕳️</div>Carregue planilhas na aba Relatório para analisar.</div>';
    return;
  }
  
  const allYears = [...new Set(HIST_DB.map(e => e.year).filter(Boolean))].sort();
  const ySel = document.getElementById('burYearSel');
  const prevY = ySel.value;
  ySel.innerHTML = '<option value="">Todos os anos</option>' + allYears.map(y => '<option value="'+y+'"'+(String(y)===prevY?' selected':'')+'>'+y+'</option>').join('');
  
  const selYear = ySel.value ? +ySel.value : null;
  const entries = selYear ? HIST_DB.filter(e => e.year === selYear) : HIST_DB;
  
  const unitEntries = {};
  entries.forEach(e => {
    (e.units || []).forEach(u => {
      if (!needsContinuidade(u.unitName)) return;
      if (!unitEntries[u.unitName]) unitEntries[u.unitName] = [];
      unitEntries[u.unitName].push(e);
    });
  });
  
  const unitNames = Object.keys(unitEntries).sort();
  if (!unitNames.length) {
    el.innerHTML = '<div class="empty"><div class="ic">🕳️</div>Nenhum abrigo/Centro Pop nos dados' + (selYear ? ' de ' + selYear : '') + '.</div>';
    return;
  }
  
  // Determinar o período COMPLETO de análise (ano inteiro, não só entre arquivos)
  const today = new Date(); today.setHours(12,0,0,0);
  let periodStart, periodEnd;
  
  if (selYear) {
    periodStart = new Date(selYear, 0, 1, 12); // 1 de janeiro
    periodEnd = selYear === today.getFullYear() ? new Date(today) : new Date(selYear, 11, 31, 12); // Até hoje ou 31/dez
  } else {
    const yearsInData = [...new Set(entries.map(e => e.year).filter(Boolean))].sort();
    const minY = Math.min(...yearsInData);
    const maxY = Math.max(...yearsInData);
    periodStart = new Date(minY, 0, 1, 12);
    periodEnd = maxY === today.getFullYear() ? new Date(today) : new Date(maxY, 11, 31, 12);
  }
  
  const results = unitNames.map(u => buildGapReport(u, unitEntries[u], periodStart, periodEnd));
  
  // Summary
  const ok = results.filter(r => r.missing.length === 0).length;
  const withGaps = results.filter(r => r.missing.length > 0);
  const totalMissing = results.reduce((s,r) => s + r.missing.length, 0);
  const totalMissingDays = results.reduce((s,r) => s + r.missingDays, 0);
  
  let h = '<div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px;padding:10px 14px;margin-bottom:12px;font-size:12px;color:#0c4a6e">'
    + '📅 <b>Data de hoje:</b> ' + fmtD(today)
    + ' · <b>Período analisado:</b> ' + fmtD(periodStart) + ' até ' + fmtD(periodEnd)
    + ' (' + Math.round((periodEnd - periodStart) / 86400000) + ' dias)'
    + (selYear ? ' · <b>Ano filtrado:</b> ' + selYear : ' · Todos os anos')
    + '</div>';
  h += '<div class="gap-summary">';
  h += '<div class="gap-sum-card"><div class="gap-sum-val" style="color:#059669">' + ok + '</div><div class="gap-sum-lbl">✅ Completos</div></div>';
  h += '<div class="gap-sum-card"><div class="gap-sum-val" style="color:#dc2626">' + withGaps.length + '</div><div class="gap-sum-lbl">🔴 Com Falhas</div></div>';
  h += '<div class="gap-sum-card"><div class="gap-sum-val">' + totalMissing + '</div><div class="gap-sum-lbl">Períodos Faltando</div></div>';
  h += '<div class="gap-sum-card"><div class="gap-sum-val">' + totalMissingDays + '</div><div class="gap-sum-lbl">Dias Descobertos</div></div>';
  h += '<div class="gap-sum-card"><div class="gap-sum-val">' + unitNames.length + '</div><div class="gap-sum-lbl">Monitorados</div></div>';
  h += '</div>';
  
  results.sort((a,b) => b.missing.length - a.missing.length || b.missingDays - a.missingDays);
  
  results.forEach(r => {
    const tipo = classifyUnit(r.unit);
    const hasMissing = r.missing.length > 0;
    const cadTxt = r.cadenceDays ? 'Cadência detectada: ~' + r.cadenceDays + ' dias' : 'Cadência não identificada';
    
    h += '<div class="gap-unit">';
    
    // Header
    h += '<div class="gap-unit-hd" onclick="this.nextElementSibling.style.display=this.nextElementSibling.style.display===\'none\'?\'block\':\'none\'">';
    h += '<div class="gap-unit-icon" style="background:' + tipo.color + '20">' + tipo.icon + '</div>';
    h += '<div style="flex:1"><div class="gap-unit-name">' + esc(r.unit) + '</div>';
    h += '<div class="gap-unit-sub">' + r.files.length + ' arquivo(s) · ' + cadTxt + ' · ';
    h += fmtD(r.periodStart) + ' até ' + fmtD(r.periodEnd) + ' (' + r.totalSpanDays + ' dias)';
    h += '</div></div>';
    h += '<span class="gap-badge ' + (hasMissing ? (r.missing.length > 3 ? 'gap-badge-danger' : 'gap-badge-warn') : 'gap-badge-ok') + '">' 
      + (hasMissing ? '🔴 ' + r.missingDays + ' dias sem abastecimento' : '✅ Abastecimento contínuo') + '</span>';
    h += '</div>';
    
    // Body
    h += '<div style="display:' + (hasMissing ? 'block' : 'none') + '">';
    
    // ─── MAPA DE ARQUIVOS ────────────────────────
    h += '<div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px;padding:10px;margin-bottom:10px">';
    h += '<div style="font-weight:800;font-size:11px;color:#0369a1;margin-bottom:6px">📂 Arquivos Carregados — Mapa Arquivo ↔ Período (' + r.files.length + ')</div>';
    h += '<div class="tbl-wrap"><table style="width:100%;font-size:11px;border-collapse:collapse">';
    h += '<tr style="font-size:9px;color:var(--muted);font-weight:700;background:#e0f2fe"><td style="padding:4px 6px">#</td><td style="padding:4px 6px">Nome do Arquivo</td><td style="padding:4px 6px">Data Início</td><td style="padding:4px 6px">Data Fim</td><td style="padding:4px 6px">Duração</td><td style="padding:4px 6px">Ano</td></tr>';
    r.files.forEach((f, i) => {
      const dur = f.ws && f.we ? Math.round((f.we - f.ws) / 86400000) + 1 : '?';
      const discWarn = f.discrepancy ? '<br><span style="color:#d97706;font-size:9px">⚠️ Arquivo diz <b>'+esc(f.discrepancy.fileDate)+'</b> mas planilha diz <b>'+esc(f.discrepancy.contentDate)+'</b></span>' : '';
      h += '<tr style="border-bottom:1px solid #e0f2fe;'+(f.discrepancy?'background:#fff7ed':'')+'">'
        + '<td style="padding:4px 6px;font-weight:800;color:var(--muted)">' + (i+1) + '</td>'
        + '<td style="padding:4px 6px;font-weight:600;max-width:250px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + esc(f.fileName) + '">' + esc(f.fileName) + discWarn + '</td>'
        + '<td style="padding:4px 6px;font-weight:700">' + (f.ws ? fmtD(f.ws) : '—') + '</td>'
        + '<td style="padding:4px 6px">' + (f.we ? fmtD(f.we) : '—') + '</td>'
        + '<td style="padding:4px 6px;color:var(--accent);font-weight:700">' + dur + ' dias</td>'
        + '<td style="padding:4px 6px">' + (f.yearAssumed ? '⚠️ ' + f.year + ' (assumido)' : '🟢 ' + f.year) + '</td>'
        + '</tr>';
    });
    h += '</table></div></div>';
    
    // ─── LINHA DO TEMPO VISUAL ────────────────────────
    if (r.timeline.length > 0) {
      h += '<div style="margin-bottom:10px">';
      h += '<div style="font-weight:800;font-size:11px;margin-bottom:6px">📅 Linha do Tempo — Períodos Cobertos e Buracos</div>';
      h += '<div class="gap-timeline-wrap">';
      r.timeline.forEach(t => {
        const bg = t.type === 'covered' ? '#d1fae5' : t.type === 'gap' ? '#fee2e2' : '#fef3c7';
        const border = t.type === 'covered' ? '#6ee7b7' : t.type === 'gap' ? '#fca5a5' : '#fcd34d';
        const icon = t.type === 'covered' ? '✅' : t.type === 'gap' ? '❌' : '⚠️';
        h += '<div class="gap-tl-block" style="background:' + bg + ';border:1px solid ' + border + '" title="' + esc(t.tooltip) + '">'
          + '<div style="font-weight:700">' + icon + ' ' + t.label + '</div>'
          + '<div style="color:var(--muted);font-size:9px">' + t.days + ' dias' + (t.file ? ' · ' + esc(t.file.length > 30 ? t.file.substring(0,28)+'...' : t.file) : '') + '</div>'
          + '</div>';
      });
      h += '</div></div>';
    }
    
    // ─── PERÍODOS FALTANTES ────────────────────────
    if (r.missing.length > 0) {
      h += '<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:12px;margin-bottom:8px">';
      h += '<div style="font-weight:800;font-size:12px;color:#991b1b;margin-bottom:8px">🔴 Períodos Faltantes (' + r.missing.length + ') — Total: ' + r.missingDays + ' dias sem abastecimento</div>';
      h += '<div style="font-size:11px;color:#991b1b;margin-bottom:8px">Estas são as datas que <b>não possuem planilha</b> no banco de dados. A coordenadora precisa providenciar os arquivos correspondentes:</div>';
      h += '<div class="tbl-wrap"><table style="width:100%;font-size:11px;border-collapse:collapse">';
      h += '<tr style="font-size:9px;color:#991b1b;font-weight:700;background:#fee2e2"><td style="padding:4px 6px">#</td><td style="padding:4px 6px">De (início)</td><td style="padding:4px 6px">Até (fim)</td><td style="padding:4px 6px">Dias</td><td style="padding:4px 6px">Observação</td></tr>';
      r.missing.forEach((m, i) => {
        h += '<tr style="border-bottom:1px solid #fecaca">'
          + '<td style="padding:4px 6px;font-weight:800;color:#dc2626">' + (i+1) + '</td>'
          + '<td style="padding:4px 6px;font-weight:700">' + fmtD(m.from) + '</td>'
          + '<td style="padding:4px 6px;font-weight:700">' + fmtD(m.to) + '</td>'
          + '<td style="padding:4px 6px;font-weight:800;color:#dc2626">' + m.days + ' dias</td>'
          + '<td style="padding:4px 6px;color:var(--muted)">' + esc(m.note) + '</td>'
          + '</tr>';
      });
      h += '</table></div></div>';
    } else {
      h += '<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:10px;font-size:12px;color:#166534">✅ <b>Abastecimento contínuo.</b> Todo o período de ' + fmtD(r.periodStart) + ' a ' + fmtD(r.periodEnd) + ' está coberto por planilhas no banco de dados.</div>';
    }
    
    if (r.hasAssumedYear) {
      h += '<div style="background:#fefce8;border:1px solid #fde047;border-radius:6px;padding:6px 10px;font-size:10px;color:#92400e;margin-top:6px">⚠️ Algum(ns) arquivo(s) com ano assumido. Corrija na aba Relatório → Banco de Dados.</div>';
    }
    
    h += '</div></div>';
  });
  
  el.innerHTML = h;
}

function fmtD(d) { return pad2(d.getDate()) + '/' + pad2(d.getMonth()+1) + '/' + d.getFullYear(); }

function buildGapReport(unitName, unitEntries, periodStart, periodEnd) {
  const files = unitEntries.map(e => ({
    id: e.id, fileName: e.fileName, label: e.weekLabel || '?', year: e.year, yearAssumed: e.yearAssumed,
    discrepancy: e.discrepancy || null,
    ws: e.weekStart ? new Date(e.weekStart + 'T12:00:00') : null,
    we: e.weekEnd ? new Date(e.weekEnd + 'T12:00:00') : null,
  })).filter(f => f.ws && f.we).sort((a,b) => a.ws - b.ws);
  
  const hasAssumedYear = unitEntries.some(e => e.yearAssumed);
  const totalSpanDays = Math.max(Math.round((periodEnd - periodStart) / 86400000), 1);
  
  if (!files.length) return { unit: unitName, files: unitEntries.map(e=>({id:e.id,fileName:e.fileName,label:e.weekLabel,year:e.year,yearAssumed:e.yearAssumed,ws:null,we:null})), missing: [{from:periodStart,to:periodEnd,days:totalSpanDays,note:'Nenhuma planilha encontrada no período inteiro'}], missingDays: totalSpanDays, timeline: [{type:'gap',label:fmtD(periodStart)+' → '+fmtD(periodEnd),days:totalSpanDays,file:null,tooltip:'Nenhum arquivo para esta unidade'}], cadenceDays: null, periodStart, periodEnd, totalSpanDays, hasAssumedYear };
  
  // Detect cadence
  const durations = files.map(f => Math.round((f.we - f.ws) / 86400000) + 1);
  const medianDur = durations.length ? durations.sort((a,b)=>a-b)[Math.floor(durations.length/2)] : 7;
  const cadenceDays = medianDur;
  const tolerance = Math.max(cadenceDays + 3, 10);
  
  // Merge overlapping/adjacent periods
  const merged = [{ ws: new Date(files[0].ws), we: new Date(files[0].we), files: [files[0].fileName] }];
  for (let i = 1; i < files.length; i++) {
    const last = merged[merged.length - 1];
    const diff = (files[i].ws - last.we) / 86400000;
    if (diff <= tolerance) {
      if (files[i].we > last.we) last.we = new Date(files[i].we);
      last.files.push(files[i].fileName);
    } else {
      merged.push({ ws: new Date(files[i].ws), we: new Date(files[i].we), files: [files[i].fileName] });
    }
  }
  
  // Build timeline + missing — usando o PERÍODO COMPLETO (ano inteiro)
  const timeline = [];
  const missing = [];
  let missingDays = 0;
  
  // GAP INICIAL: do início do período até o primeiro arquivo
  if (merged[0].ws > periodStart) {
    const gapDays = Math.round((merged[0].ws - periodStart) / 86400000);
    if (gapDays > 0) {
      const gapTo = new Date(merged[0].ws); gapTo.setDate(gapTo.getDate() - 1);
      const nPeriods = Math.ceil(gapDays / cadenceDays);
      timeline.push({ type: 'gap', label: fmtD(periodStart) + ' → ' + fmtD(gapTo), days: gapDays, file: null, tooltip: 'Sem planilhas desde o início do período (' + gapDays + ' dias)' });
      missing.push({ from: new Date(periodStart), to: gapTo, days: gapDays, note: 'Início do ano sem planilhas (~' + nPeriods + ' envio(s) faltando)' });
      missingDays += gapDays;
    }
  }
  
  // PERÍODOS COBERTOS + GAPS INTERMEDIÁRIOS
  merged.forEach((p, i) => {
    const covDays = Math.round((p.we - p.ws) / 86400000) + 1;
    timeline.push({
      type: 'covered', label: fmtD(p.ws) + ' → ' + fmtD(p.we),
      days: covDays, file: p.files.join(', '),
      tooltip: 'Coberto: ' + fmtD(p.ws) + ' até ' + fmtD(p.we) + ' (' + covDays + ' dias)'
    });
    
    if (i < merged.length - 1) {
      const nextStart = merged[i+1].ws;
      const gapDays = Math.round((nextStart - p.we) / 86400000) - 1;
      if (gapDays > 0) {
        const gapFrom = new Date(p.we); gapFrom.setDate(gapFrom.getDate() + 1);
        const gapTo = new Date(nextStart); gapTo.setDate(gapTo.getDate() - 1);
        const nPeriods = Math.ceil(gapDays / cadenceDays);
        timeline.push({ type: 'gap', label: fmtD(gapFrom) + ' → ' + fmtD(gapTo), days: gapDays, file: null, tooltip: 'BURACO: ' + gapDays + ' dias sem planilha' });
        missing.push({ from: gapFrom, to: gapTo, days: gapDays, note: 'Provável ' + nPeriods + ' planilha(s) faltando (' + nPeriods + '×~' + cadenceDays + ' dias)' });
        missingDays += gapDays;
      }
    }
  });
  
  // GAP FINAL: do último arquivo até o fim do período (hoje ou 31/dez)
  const lastWe = merged[merged.length - 1].we;
  if (lastWe < periodEnd) {
    const gapDays = Math.round((periodEnd - lastWe) / 86400000);
    if (gapDays > 0) {
      const gapFrom = new Date(lastWe); gapFrom.setDate(gapFrom.getDate() + 1);
      const nPeriods = Math.ceil(gapDays / cadenceDays);
      timeline.push({ type: 'gap', label: fmtD(gapFrom) + ' → ' + fmtD(periodEnd), days: gapDays, file: null, tooltip: 'Sem planilhas até o fim do período (' + gapDays + ' dias)' });
      missing.push({ from: gapFrom, to: new Date(periodEnd), days: gapDays, note: 'Fim do período sem planilhas (~' + nPeriods + ' envio(s) faltando)' });
      missingDays += gapDays;
    }
  }
  
  return { unit: unitName, files, missing, missingDays, timeline, cadenceDays, periodStart, periodEnd, totalSpanDays, hasAssumedYear };
}



// ═══════════════════════════════════════════════════════════════════
// ABA UNIFICAR — Gestão de nomes de unidades
// ═══════════════════════════════════════════════════════════════════
let UNIF_SEL = [];

function toggleUnifSel(u) {
  const i = UNIF_SEL.indexOf(u);
  if (i >= 0) UNIF_SEL.splice(i, 1);
  else UNIF_SEL.push(u);
  renderUnificar();
}

function unifRemoveSel(u) {
  UNIF_SEL = UNIF_SEL.filter(x => x !== u);
  renderUnificar();
}

function clearUnifSel() {
  UNIF_SEL = [];
  renderUnificar();
}

function renderUnificar() {
  const el = document.getElementById('unifContent');
  const aliasEl = document.getElementById('unifAliases');
  const mergePanel = document.getElementById('unifMergePanel');
  if (!el) return;
  
  // Collect all unit names from DB
  const allRawUnits = new Map();
  HIST_DB.forEach(e => {
    (e.units || []).forEach(u => {
      const raw = u.rawUnit || u.unitName;
      const canon = u.unitName;
      if (!allRawUnits.has(canon)) allRawUnits.set(canon, { canonical: canon, rawNames: new Set(), files: new Set(), items: 0, tipo: classifyUnit(canon) });
      const entry = allRawUnits.get(canon);
      entry.rawNames.add(raw);
      entry.files.add(e.fileName);
      (u.categories || []).forEach(c => { entry.items += c.items.length; });
    });
  });
  
  if (!allRawUnits.size) {
    el.innerHTML = '<div class="empty"><div class="ic">🔗</div>Carregue planilhas na aba Relatório para ver as unidades.</div>';
    if (aliasEl) aliasEl.innerHTML = '';
    if (mergePanel) mergePanel.style.display = 'none';
    return;
  }
  
  const search = (document.getElementById('unifSearch')?.value || '').toLowerCase();
  const units = [...allRawUnits.values()]
    .filter(u => !search || u.canonical.toLowerCase().includes(search) || [...u.rawNames].some(r => r.toLowerCase().includes(search)))
    .sort((a, b) => a.canonical.localeCompare(b.canonical));
  
  // Remove unif selections that no longer exist
  UNIF_SEL = UNIF_SEL.filter(s => allRawUnits.has(s));
  
  // Merge panel
  if (mergePanel) {
    if (UNIF_SEL.length >= 2) {
      mergePanel.style.display = 'block';
      let mp = '<div class="unif-merge-panel">';
      mp += '<div style="font-weight:800;font-size:14px;margin-bottom:8px">🔗 Unificar ' + UNIF_SEL.length + ' unidade(s)</div>';
      mp += '<p style="font-size:11px;color:var(--muted);margin-bottom:10px">Todas serão renomeadas para o nome canônico abaixo em todo o banco de dados.</p>';
      mp += '<div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:10px">';
      UNIF_SEL.forEach(u => {
        mp += '<span style="background:#dbeafe;color:#1e40af;padding:4px 10px;border-radius:8px;font-size:11px;font-weight:700;display:inline-flex;align-items:center;gap:4px">' + esc(u) + ' <span style="cursor:pointer;opacity:.6" onclick="event.stopPropagation();unifRemoveSel(\'' + esc(u).replace(/'/g, "\\'") + '\')">✕</span></span>';
      });
      mp += '</div>';
      mp += '<label class="lbl">Nome canônico (como vai aparecer nos relatórios):</label>';
      mp += '<input class="input" id="unifTarget" value="' + esc(UNIF_SEL[0]) + '" style="margin-bottom:10px">';
      mp += '<div style="display:flex;gap:8px">';
      mp += '<button class="btn btn-p" onclick="doUnifMerge()">✅ Unificar</button>';
      mp += '<button class="btn btn-s" onclick="clearUnifSel()">Cancelar</button>';
      mp += '</div></div>';
      mergePanel.innerHTML = mp;
    } else {
      mergePanel.style.display = 'none';
    }
  }
  
  // Unit cards grid
  let h = '<div class="unif-grid">';
  units.forEach(u => {
    const isSel = UNIF_SEL.includes(u.canonical);
    const rawList = [...u.rawNames].filter(r => r !== u.canonical);
    
    h += '<div class="unif-card' + (isSel ? ' selected' : '') + '" onclick="toggleUnifSel(\'' + u.canonical.replace(/'/g, "\\'") + '\')">';
    h += '<div class="unif-card-check">' + (isSel ? '✓' : '') + '</div>';
    h += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">';
    h += '<span style="font-size:18px">' + u.tipo.icon + '</span>';
    h += '<div><div style="font-weight:700;font-size:13px">' + esc(u.canonical) + '</div>';
    h += '<div style="font-size:10px;color:var(--muted)">' + u.tipo.label + ' · ' + u.files.size + ' arq. · ' + u.items + ' itens</div></div></div>';
    
    if (rawList.length > 0) {
      h += '<div style="margin-top:6px;font-size:10px;color:#d97706;background:#fefce8;padding:4px 8px;border-radius:6px">';
      h += '📝 Também aparece como: <b>' + rawList.map(r => esc(r)).join('</b>, <b>') + '</b>';
      h += '</div>';
    }
    h += '</div>';
  });
  h += '</div>';
  
  if (UNIF_SEL.length === 1) {
    h += '<div style="margin-top:12px;font-size:12px;color:var(--muted);text-align:center">Selecione mais uma unidade para unificar com <b>' + esc(UNIF_SEL[0]) + '</b></div>';
  } else if (UNIF_SEL.length === 0) {
    h += '<div style="margin-top:12px;font-size:12px;color:var(--muted);text-align:center">Clique em 2 ou mais unidades que são a mesma para unificar</div>';
  }
  
  el.innerHTML = h;
  
  // Active aliases
  if (aliasEl) {
    const rules = typeof HIST_ALIASES === 'object' && !Array.isArray(HIST_ALIASES) ? Object.entries(HIST_ALIASES) : [];
    if (rules.length) {
      let ah = '<div style="font-weight:800;font-size:13px;margin-bottom:10px">📜 Regras de Unificação Ativas (' + rules.length + ')</div>';
      rules.forEach(([from, to]) => {
        ah += '<div class="unif-alias">';
        ah += '<span style="background:#fee2e2;color:#991b1b;padding:3px 10px;border-radius:8px;font-size:11px;font-weight:700">' + esc(from) + '</span>';
        ah += '<span style="color:var(--muted);font-size:14px">→</span>';
        ah += '<span style="background:#d1fae5;color:#065f46;padding:3px 10px;border-radius:8px;font-size:11px;font-weight:700">' + esc(to) + '</span>';
        ah += '<span style="flex:1"></span>';
        ah += '<button class="btn btn-s btn-sm" style="color:var(--red);border-color:#fca5a5;font-size:10px" onclick="removeAlias(\'' + from.replace(/'/g, "\\'") + '\')">↩️ Desfazer</button>';
        ah += '</div>';
      });
      ah += '<div style="margin-top:8px"><button class="btn btn-s btn-sm" style="font-size:10px;color:#dc2626" onclick="clearAllAliases()">🗑️ Desfazer todas as unificações</button></div>';
      aliasEl.innerHTML = ah;
    } else {
      aliasEl.innerHTML = '<div style="font-size:11px;color:var(--muted);text-align:center;padding:10px">Nenhuma regra de unificação ativa.</div>';
    }
  }
}

function doUnifMerge() {
  const target = document.getElementById('unifTarget')?.value?.trim();
  if (!target) { toast('Informe o nome canônico!', 'red'); return; }
  if (UNIF_SEL.length < 2) { toast('Selecione pelo menos 2 unidades!', 'red'); return; }
  
  let nChanged = 0;
  UNIF_SEL.forEach(u => {
    if (u !== target) {
      HIST_ALIASES[rmAcc(u).toUpperCase()] = target;
      nChanged++;
    }
  });
  
  // Re-normalize all units in HIST_DB
  HIST_DB.forEach(e => (e.units || []).forEach(u => {
    u.unitName = normalizeUnit(u.rawUnit || u.unitName);
  }));
  
  UNIF_SEL = [];
  invalidateAggCache();
  saveHistDB();
  renderUnificar();
  toast(nChanged + ' unidade(s) unificada(s) como "' + target + '"', 'green');
}

function clearAllAliases() {
  if (!confirm('Desfazer TODAS as unificações? Os nomes originais serão restaurados.')) return;
  HIST_ALIASES = {};
  HIST_DB.forEach(e => (e.units || []).forEach(u => {
    u.unitName = normalizeUnit(u.rawUnit || u.unitName);
  }));
  invalidateAggCache();
  saveHistDB();
  renderUnificar();
  renderRelatorio();
  toast('Todas as unificações desfeitas.', 'green');
}


function buildReqStats(){
  const nReq=REQS.filter(r=>r.status==='requisitado').length;
  const nSep=REQS.filter(r=>r.status==='separando').length;
  const nPronto=REQS.filter(r=>r.status==='pronto').length;
  const nEntregue=REQS.filter(r=>r.status==='entregue').length;
  if(!nReq && !nSep && !nPronto && !nEntregue) return null;
  
  let h='<div style="margin-bottom:20px">'
    +'<h2 style="font-size:16px;font-weight:800;margin-bottom:12px">🔄 Fluxo de Requisições Hoje</h2>'
    +'<div class="pan-grid">'
    +kpi(nReq,'Na Fila','aguardando','','#6366f1')
    +kpi(nSep,'Separando','em andamento','','#f59e0b')
    +kpi(nPronto,'Prontas','aguardando retirada','','#10b981')
    +kpi(nEntregue,'Entregues','finalizadas','','#3b82f6')
    +'</div></div>';
  return h;
}

function buildPainel(){
  const el=document.getElementById('panContent');
  if(HIST_DB.length > 50) el.innerHTML='<div style="text-align:center;padding:40px;color:var(--muted)"><div style="font-size:24px;margin-bottom:8px">⏳</div>Calculando painel com '+HIST_DB.length+' arquivo(s)...</div>';
  
  if (typeof getFeriadosISOSetCached === 'function') {
    getFeriadosISOSetCached().then(set => {
      FERIADOS_SET = set || new Set();
      requestAnimationFrame(()=>{ _buildPainelImpl(); });
    }).catch(err => {
      console.error(err);
      requestAnimationFrame(()=>{ _buildPainelImpl(); });
    });
  } else {
    requestAnimationFrame(()=>{ _buildPainelImpl(); });
  }
}
function _buildPainelImpl(){
  if(window.__semcasHistDB && window.__semcasHistDB.length>0) HIST_DB=window.__semcasHistDB;
  if(getSemcasHistDB() && getSemcasHistDB().length>0) HIST_DB=getSemcasHistDB();
  HIST_DB_PARTIAL=!!window.__semcasHistDBPartial;
  applyAliasesToHistDB();
  const el=document.getElementById('panContent');
  _panUnit = document.getElementById('panUnitSel')?.value || '';
  
  if(!HIST_DB.length){
    document.getElementById('panFilters').style.display='none';
    const reqStats = buildReqStats();
    if(!reqStats) {
      el.innerHTML='<div class="pan-empty"><div class="ic">📈</div><b>Painel de Gestão</b>'
        +'<br><span style="font-size:13px">Carregue planilhas na aba Relatório '
        +'<b>ou registre requisições</b> para gerar análise automática.</span></div>';
    } else {
      el.innerHTML=reqStats;
    }
    return;
  }

  const allAggFull=getCachedAgg(HIST_DB,new Set(),new Set());
  if(!allAggFull.length){
    el.innerHTML='<div class="pan-empty"><div class="ic">⚠️</div>'
      +'<b>Sem itens com quantidade no banco.</b>'
      +'<br><span style="font-size:12px">'+HIST_DB.length+' arquivo(s) carregado(s), mas sem itens com qtd > 0.'
      +'<br>Verifique se as planilhas têm a coluna "Quantidade solicitada" preenchida.</span></div>';
    return;
  }

  const allUnitsRaw=[...new Set(allAggFull.map(r=>r.unit))].sort();
  const allYears=[...new Set(HIST_DB.map(e=>e.year).filter(Boolean))].sort();
  
  // Render filtros
  renderPanFilters(allUnitsRaw);
  
  // Aplicar filtros
  let allAgg = allAggFull;
  let allUnits = allUnitsRaw;
  const filteredTipo = _panTipo ? UNIT_TYPES.find(t => t.id === _panTipo) : null;
  
  if (_panUnit) {
    allAgg = allAggFull.filter(r => r.unit === _panUnit);
    allUnits = [_panUnit];
  } else if (_panTipo) {
    const tipoUnits = new Set(allUnitsRaw.filter(u => classifyUnit(u).id === _panTipo));
    allAgg = allAggFull.filter(r => tipoUnits.has(r.unit));
    allUnits = [...tipoUnits].sort();
  }
  const totalWeeks=new Set(HIST_DB.map(e=>e.weekStart)).size;
  const totalMonths=new Set(HIST_DB.map(e=>weekMonth(e))).size;
  const totalDeliveries=allAgg.reduce((s,r)=>s+r.total,0);
  const totalDeliveriesGlobal=allAggFull.reduce((s,r)=>s+r.total,0);
  const nAssumed=HIST_DB.filter(e=>e.yearAssumed).length;

  const unitStats={};
  allUnits.forEach(u=>{
    const rows=allAgg.filter(r=>r.unit===u);
    const tot=rows.reduce((s,r)=>s+r.total,0);
    unitStats[u]={total:tot,items:rows.length,rows};
  });

  const totalItems=allAgg.length;
  let h='';

  h+='<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:8px">'
    +'<div><h1 style="font-size:18px;font-weight:800;margin:0">📈 Painel de Gestão'
    +(_panUnit?' — '+esc(_panUnit):_panTipo&&filteredTipo?' — '+filteredTipo.icon+' '+filteredTipo.label:' (Geral)')
    +'</h1>'
    +'<div style="font-size:11px;color:var(--muted)">Gerado automaticamente · '
    +allYears.map(y=>'<span class="year-badge" style="font-size:9px">'+y+'</span>').join('')
    +'</div></div>'
    +'<button class="btn btn-s btn-sm" onclick="buildPainel()">🔄 Atualizar</button></div>';

  if(HIST_DB_PARTIAL){
    h+='<div class="alert-card alert-blue"><div class="alert-icon">📉</div>'
      +'<div class="alert-body"><b>Modo econômico ativo</b>'
      +'O sistema carregou apenas uma parte do banco histórico para economizar leituras no Firebase. '
      +'<button class="btn btn-s btn-sm" style="margin-left:6px" onclick="loadAllHistDBAndRefresh()">Carregar tudo</button>'
      +'</div></div>';
  }

  if(nAssumed>0){
    h+='<div class="alert-card alert-yellow"><div class="alert-icon">⚠️</div>'
      +'<div class="alert-body"><b>'+nAssumed+' arquivo(s) com ano não detectado</b>'
      +'As médias anuais podem estar imprecisas. Corrija os anos na aba Relatório → Banco de Dados.</div></div>';
  }

  // Fluxo de requisições (se houver)
  const reqStatsHtml = buildReqStats();
  if(reqStatsHtml) h += reqStatsHtml;

  h+='<div class="pan-grid">'
    +kpi(allYears.length,'Anos','de dados',allYears.join(', '),'#6d28d9')
    +kpi(HIST_DB.length,'Arquivos',totalWeeks+' envios ativos','','#0284c7')
    +kpi(totalMonths,'Meses','de histórico','','#0891b2')
    +kpi(allUnits.length,'Unidades','monitoradas','','#059669')
    +kpi(totalItems,'Combinações','item × unidade','','#d97706')
    +kpi(totalDeliveries.toLocaleString('pt-BR'),'Itens','total acumulado planilhas','','#dc2626')
    +'</div>';

  // ─── Modo Perfil de Unidade ───────────────────────────────
  if (_panUnit) {
    h += panSection('📋 Perfil Detalhado', 'Análise completa de ' + esc(_panUnit), buildUnitProfile(allAgg, _panUnit, allYears));
  }
  
  // ─── Modo Comparativo por Tipo ──────────────────────────
  if (_panTipo && filteredTipo && !_panUnit && allUnits.length >= 2) {
    h += panSection(filteredTipo.icon + ' Comparativo — ' + filteredTipo.label, 
      'Ranking e análise entre as ' + allUnits.length + ' unidades do tipo ' + filteredTipo.label,
      buildComparativo(allAgg, allUnits, filteredTipo.label, filteredTipo.color));
    
    h += panSection('🗂️ Ranking por Categoria — ' + filteredTipo.label,
      'Total entregue por categoria neste tipo de unidade',
      buildRankingCategoriaTipo(allAgg, allUnits, filteredTipo.color));

    h += panSection('📦 Itens mais consumidos — ' + filteredTipo.label,
      'Top 15 itens entre todas as unidades ' + filteredTipo.label,
      buildTopItemsTipo(allAgg, allUnits));
  }
  
  h+=panSection('🚨 Alertas e Atenção','Situações que exigem atenção do coordenador',buildAlertas(allAgg,totalWeeks,totalMonths));

  h+='<div class="two-col">'
    +panSection('📦 Top 10 Itens mais Consumidos','Total acumulado em todas as unidades',buildTopItems(allAgg))
    +panSection('🏢 Consumo por Unidade','Total acumulado e ranking',buildUnitRanking(allAgg,allUnits))
    +'</div>';

  h+=panSection('📊 Análise de Variabilidade','CV (Coef. de Variação) alto = consumo irregular = risco de desperdício ou falta',buildVariabilidade(allAgg));
  h+=panSection('🗂️ Distribuição por Categoria','Quanto cada categoria representa do total',buildCatDistrib(allAgg,totalDeliveries));
  h+=panSection('📅 Sazonalidade Mensal','Meses com maior e menor demanda (todos os itens somados)',buildSazonalidade());

  if(allYears.length>=2){
    h+=panSection('📈 Evolução Anual por Unidade','Comparação do total consumido por unidade entre os anos disponíveis',buildEvolucaoAnual(allAgg,allYears,allUnits));
  }

  h+=panSection('🔍 Detalhamento por Unidade','Top 5 itens mais consumidos em cada unidade (baseado em média mensal)',buildUnitDetail(allAgg,allUnits));

  el.innerHTML=h;
}

function kpi(val,lbl,sub,tip,color){
  return'<div class="kpi" title="'+esc(tip||'')+'">'
    +'<div class="kpi-val" style="color:'+color+'">'+val+'</div>'
    +'<div class="kpi-lbl">'+lbl+'</div>'
    +'<div class="kpi-sub">'+sub+'</div>'
    +'</div>';
}
function panSection(title,sub,body){
  return'<div class="pan-section"><h2>'+title+'</h2><p class="sub">'+sub+'</p>'+body+'</div>';
}

function buildAlertas(allAgg,totalWeeks,totalMonths){
  const alerts=[];

  const unitWeeks={};
  HIST_DB.forEach(e=>(e.units||[]).forEach(u=>{ if(!unitWeeks[u.unitName])unitWeeks[u.unitName]=new Set(); unitWeeks[u.unitName].add(e.weekStart); }));
  const lowCoverage=Object.entries(unitWeeks).filter(([u,ws])=>ws.size<totalWeeks*0.5&&ws.size<totalWeeks-1);
  if(lowCoverage.length){
    alerts.push({type:'yellow',icon:'📁',
      title:'Cobertura de dados incompleta em '+lowCoverage.length+' unidade(s)',
      body:'Unidades com menos de 50% dos envios totais: '
        +lowCoverage.map(([u,ws])=>'<b>'+esc(u)+'</b> ('+ws.size+' envios)').join(', ')
        +'.'});
  }

  const highCV=allAgg.filter(r=>{
    const vals=Object.values(r.weekQtys);
    if(vals.length<3||r.total===0)return false;
    const mean=r.total/vals.length;
    const sd=Math.sqrt(vals.reduce((s,v)=>s+Math.pow(v-mean,2),0)/vals.length);
    return (sd/mean)>0.5;
  });
  if(highCV.length>0){
    const top=highCV.sort((a,b)=>{
      const cvA=cvOf(a),cvB=cvOf(b);return cvB-cvA;
    }).slice(0,3);
    alerts.push({type:'blue',icon:'📉',
      title:highCV.length+' item(s) com consumo muito irregular (CV > 50%)',
      body:'Consumo inconsistente pode indicar desperdício ou falta de planejamento: '
        +top.map(r=>'<b>'+esc(r.material)+'</b> em <b>'+esc(r.unit)+'</b>').join(', ')+'.'});
  }

  const trending=allAgg.filter(r=>{
    if(r.monthBreakdown.length<3)return false;
    const half=Math.floor(r.monthBreakdown.length/2);
    const first=r.monthBreakdown.slice(0,half).reduce((s,m)=>s+m.qty,0);
    const last=r.monthBreakdown.slice(-half).reduce((s,m)=>s+m.qty,0);
    return first>0&&(last-first)/first>0.2;
  });
  if(trending.length){
    alerts.push({type:'red',icon:'📈',
      title:trending.length+' item(s) com demanda crescente',
      body:'Atenção ao estoque: '
        +trending.slice(0,4).map(r=>'<b>'+esc(r.material)+'</b> ('+esc(r.unit)+')').join(', ')
        +(trending.length>4?'...':'')+'.'});
  }

  // Sugestão de estoque mínimo para itens de alta demanda
  const highDemand=allAgg.filter(r=>r.avgMonth>=10).sort((a,b)=>b.avgMonth-a.avgMonth).slice(0,5);
  if(highDemand.length){
    alerts.push({type:'blue',icon:'📦',
      title:'Estoque mínimo sugerido — Top '+highDemand.length+' itens',
      body:'Com base no consumo médio mensal real: '
        +highDemand.map(r=>'<b>'+esc(r.material)+'</b> ('+esc(r.unit)+') → mín. <b>'+Math.ceil(r.avgMonth*1.3)+'</b>/mês').join(' · ')+'.'});
  }

  if(!alerts.length){
    return'<div class="alert-card alert-green"><div class="alert-icon">✅</div>'
      +'<div class="alert-body"><b>Nenhum alerta crítico</b>Dados dentro dos padrões esperados.</div></div>';
  }
  return alerts.map(a=>'<div class="alert-card alert-'+a.type+'">'
    +'<div class="alert-icon">'+a.icon+'</div>'
    +'<div class="alert-body"><b>'+a.title+'</b>'+a.body+'</div></div>').join('');
}

function cvOf(r){
  const vals=Object.values(r.weekQtys);
  if(!vals.length||r.total===0)return 0;
  const mean=r.total/vals.length;
  const sd=Math.sqrt(vals.reduce((s,v)=>s+Math.pow(v-mean,2),0)/vals.length);
  return sd/mean;
}

function buildTopItems(allAgg){
  const byItem={};
  allAgg.forEach(r=>{
    const k=normMat(r.material);
    if(!byItem[k])byItem[k]={mat:r.material,cat:r.cat,total:0,realAvgMonth:0,units:0};
    byItem[k].total+=r.total;
    // A média mês global do item pode ser re-calculada, mas faremos a soma grosseira para simplificar no painel
    byItem[k].realAvgMonth+=r.realAvgMonth;
    byItem[k].units++;
  });
  const top=Object.values(byItem).sort((a,b)=>b.total-a.total).slice(0,10);
  const maxT=top[0]?.total||1;
  let h='<table class="eff-table"><thead><tr><th>#</th><th>Item</th><th>Categoria</th><th class="rn">Total Entregue</th><th class="rn">Méd/mês (real)</th><th>Volume</th></tr></thead><tbody>';
  top.forEach((r,i)=>{
    const pct=Math.round((r.total/maxT)*100);
    h+='<tr><td style="font-weight:800;color:var(--muted)">'+(i+1)+'</td>'
      +'<td style="font-weight:700">'+esc(r.mat)+'</td>'
      +'<td><span class="rel-badge rel-badge-cat" style="font-size:9px">'+esc(r.cat)+'</span></td>'
      +'<td class="rn" style="color:#059669;font-weight:bold">'+r.total+'</td>'
      +'<td class="rn" style="color:#1e40af">'+Math.round(r.realAvgMonth)+'</td>'
      +'<td><span class="rank-bar" style="width:'+Math.max(pct,2)+'px;max-width:100px"></span></td>'
      +'</tr>';
  });
  return h+'</tbody></table>';
}

function buildUnitRanking(allAgg,allUnits){
  const unitTot={};
  allAgg.forEach(r=>{ unitTot[r.unit]=(unitTot[r.unit]||0)+r.total; });
  const sorted=allUnits.map(u=>({u,t:unitTot[u]||0})).sort((a,b)=>b.t-a.t);
  const maxT=sorted[0]?.t||1;
  let h='<table class="eff-table"><thead><tr><th>#</th><th>Unidade</th><th class="rn">Total Exato</th><th class="rn">%</th><th>Participação</th></tr></thead><tbody>';
  const totalAll=sorted.reduce((s,r)=>s+r.t,0);
  sorted.forEach((r,i)=>{
    const pct=totalAll?Math.round((r.t/totalAll)*100):0;
    const barW=Math.round((r.t/maxT)*100);
    h+='<tr><td style="font-weight:800;color:var(--muted)">'+(i+1)+'</td>'
      +'<td><span class="rel-badge rel-badge-unit">'+esc(r.u)+'</span></td>'
      +'<td class="rn" style="font-weight:800">'+r.t+'</td>'
      +'<td class="rn" style="color:var(--muted)">'+pct+'%</td>'
      +'<td><span class="rank-bar" style="width:'+Math.max(barW,2)+'px;max-width:80px"></span></td>'
      +'</tr>';
  });
  return h+'</tbody></table>';
}

function buildVariabilidade(allAgg){
  const rows=allAgg.filter(r=>r.total>0&&Object.values(r.weekQtys).length>=3).map(r=>{
    const cv=cvOf(r);
    return{...r,cv};
  }).sort((a,b)=>b.cv-a.cv).slice(0,15);

  let h='<table class="eff-table"><thead><tr>'
    +'<th>Item</th><th>Unidade</th><th class="rn">Suprim./sem</th><th class="rn">Méd/mês</th>'
    +'<th class="rn">Mín</th><th class="rn">Máx</th>'
    +'<th>Variabilidade</th><th>Interpretação</th>'
    +'</tr></thead><tbody>';

  rows.forEach(r=>{
    const vals=Object.values(r.weekQtys).sort((a,b)=>a-b);
    const minV=vals[0], maxV=vals[vals.length-1];
    const cvPct=Math.round(r.cv*100);
    const cvCls=r.cv<0.2?'cv-low':r.cv<0.5?'cv-med':'cv-hi';
    const interp=r.cv<0.2?'✅ Estável':r.cv<0.5?'⚡ Moderado':'🔴 Irregular';
    h+='<tr>'
      +'<td style="font-weight:700">'+esc(r.material)+'</td>'
      +'<td class="unit-col"><span class="rel-badge rel-badge-unit">'+esc(r.unit)+'</span></td>'
      +'<td class="rn" style="color:#10b981;font-weight:bold">'+r.realAvgWeek+'</td>'
      +'<td class="rn" style="color:#1e40af">'+r.realAvgMonth+'</td>'
      +'<td class="rn" style="color:#64748b">'+minV+'</td>'
      +'<td class="rn" style="color:#64748b">'+maxV+'</td>'
      +'<td style="text-align:center"><span class="heat-cell '+cvCls+'">CV '+cvPct+'%</span></td>'
      +'<td style="font-size:11px">'+interp+'</td>'
      +'</tr>';
  });
  h+='</tbody></table>';
  h+='<div style="font-size:10px;color:var(--muted);margin-top:8px">'
    +'CV = Coeficiente de Variação (Desvio Padrão ÷ Média). '
    +'<span class="heat-cell cv-low" style="font-size:10px;padding:1px 6px">CV &lt;20%</span> Estável &nbsp;'
    +'<span class="heat-cell cv-med" style="font-size:10px;padding:1px 6px">20-50%</span> Moderado &nbsp;'
    +'<span class="heat-cell cv-hi" style="font-size:10px;padding:1px 6px">CV &gt;50%</span> Irregular'
    +'</div>';
  return h;
}

function buildCatDistrib(allAgg,totalDeliveries){
  const catTot={};
  allAgg.forEach(r=>{ catTot[r.cat]=(catTot[r.cat]||0)+r.total; });
  const sorted=Object.entries(catTot).sort((a,b)=>b[1]-a[1]);
  const total=sorted.reduce((s,[,v])=>s+v,0)||1;
  let h='<table class="eff-table"><thead><tr><th>Categoria</th><th class="rn">Total acum.</th><th class="rn">%</th><th>Distribuição</th></tr></thead><tbody>';
  const colors=['#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#84cc16','#f97316'];
  sorted.forEach(([cat,tot],i)=>{
    const pct=(tot/total*100).toFixed(1);
    const barW=Math.round(tot/total*160);
    h+='<tr><td><span class="rel-badge rel-badge-cat">'+esc(cat)+'</span></td>'
      +'<td class="rn" style="font-weight:800">'+tot+'</td>'
      +'<td class="rn" style="font-weight:700;color:#1e40af">'+pct+'%</td>'
      +'<td><span style="display:inline-block;height:10px;width:'+Math.max(barW,2)+'px;background:'+colors[i%colors.length]+';border-radius:3px;vertical-align:middle"></span>'
      +' <span style="font-size:10px;color:var(--muted)">'+pct+'%</span></td></tr>';
  });
  return h+'</tbody></table>';
}

function buildSazonalidade(){
  const MONTH_NAMES=['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  const byMonth={};
  HIST_DB.forEach(e=>{
    const mo=parseInt((e.weekStart||'').substring(5,7));
    if(!mo)return;
    const tot=(e.units||[]).flatMap(u=>(u.categories||[]).flatMap(c=>(c.items||[]).map(i=>i.qty))).reduce((s,v)=>s+v,0);
    if(!byMonth[mo])byMonth[mo]={total:0,count:0};
    byMonth[mo].total+=tot;
    byMonth[mo].count++;
  });
  const months=Object.entries(byMonth).sort((a,b)=>+a[0]-+b[0]);
  if(!months.length)return'<p style="color:var(--muted);font-size:12px">Dados insuficientes para análise de sazonalidade.</p>';
  const avgs=months.map(([m,d])=>({m:+m,avg:d.count?Math.round(d.total/d.count):0,total:d.total,count:d.count}));
  const maxAvg=Math.max(...avgs.map(a=>a.avg))||1;
  const bestMonth=avgs.reduce((a,b)=>a.avg>b.avg?a:b);
  const worstMonth=avgs.filter(a=>a.count>0).reduce((a,b)=>a.avg<b.avg?a:b);

  let h='<div style="display:flex;gap:6px;align-items:flex-end;margin-bottom:12px;padding:8px;background:#f8fafc;border-radius:8px;overflow-x:auto">';
  for(let m=1;m<=12;m++){
    const d=avgs.find(a=>a.m===m);
    const avg=d?d.avg:0;
    const h_bar=d?Math.max(Math.round((avg/maxAvg)*60),2):2;
    const isBest=d&&d.m===bestMonth.m;
    const isWorst=d&&d.count>0&&d.m===worstMonth.m;
    const color=isBest?'#10b981':isWorst?'#ef4444':'#3b82f6';
    h+='<div style="display:flex;flex-direction:column;align-items:center;min-width:36px">'
      +'<div style="font-size:9px;font-weight:700;color:'+color+';margin-bottom:2px">'+(avg||'—')+'</div>'
      +'<div style="width:28px;height:'+h_bar+'px;background:'+color+';border-radius:3px 3px 0 0;'+(d?'':'opacity:0.2')+'"></div>'
      +'<div style="font-size:9px;color:var(--muted);margin-top:3px">'+MONTH_NAMES[m-1]+'</div>'
      +'</div>';
  }
  h+='</div>';
  h+='<div style="display:flex;gap:12px;flex-wrap:wrap;font-size:11px">'
    +'<span style="color:#10b981;font-weight:700">📈 Maior demanda: '+MONTH_NAMES[bestMonth.m-1]+' (méd. '+bestMonth.avg+'/mês ativo)</span>'
    +'<span style="color:#ef4444;font-weight:700">📉 Menor demanda: '+MONTH_NAMES[worstMonth.m-1]+' (méd. '+worstMonth.avg+'/mês ativo)</span>'
    +'</div>';
  return h;
}

function buildEvolucaoAnual(allAgg,allYears,allUnits){
  const data={};
  allAgg.forEach(r=>{
    if(!data[r.unit])data[r.unit]={};
    r.yearBreakdown.forEach(y=>{
      if(!data[r.unit][y.yr])data[r.unit][y.yr]={total:0,avgMonth:0,items:0};
      data[r.unit][y.yr].total+=y.total;
      data[r.unit][y.yr].avgMonth+=y.avgMonth;
      data[r.unit][y.yr].items++;
    });
  });
  
  const sortedYears = [...allYears].sort();
  const yr2 = sortedYears[sortedYears.length-1];
  const yr1 = sortedYears.length > 1 ? sortedYears[sortedYears.length-2] : sortedYears[0];
  
  let h='<table class="eff-table"><thead><tr><th>Unidade</th>';
  allYears.forEach(y=>h+='<th class="rn">'+y+'</th>');
  h+='<th class="rn">Variação ('+yr1+' vs '+yr2+')</th><th>Tendência</th></tr></thead><tbody>';
  allUnits.forEach(u=>{
    const d=data[u]||{};
    const v1=d[yr1]?.total||0, v2=d[yr2]?.total||0;
    const diff=v2-v1;
    const pct=v1?Math.round((diff/v1)*100):null;
    const trend=diff>0?'<span class="trend-up">▲ +'+diff+' ('+(pct!==null?pct+'%':'')+')</span>'
      :diff<0?'<span class="trend-dn">▼ '+Math.abs(diff)+' ('+(pct!==null?pct+'%':'')+')</span>'
      :'<span class="trend-eq">— Estável</span>';
    h+='<tr><td><span class="rel-badge rel-badge-unit">'+esc(u)+'</span></td>';
    allYears.forEach(y=>{
      const val=d[y]?.total;
      h+='<td class="rn" style="font-weight:700">'+(val!=null?val:'<span style="color:#cbd5e1">—</span>')+'</td>';
    });
    h+='<td class="rn" style="font-weight:700">'+( pct!==null?(diff>=0?'+':'')+pct+'%':'—' )+'</td>'
      +'<td>'+trend+'</td></tr>';
  });
  return h+'</tbody></table>';
}

function buildUnitDetail(allAgg,allUnits){
  let h='<div class="two-col">';
  allUnits.forEach(u=>{
    const rows=allAgg.filter(r=>r.unit===u&&r.total>0).sort((a,b)=>b.avgMonth-a.avgMonth).slice(0,5);
    if(!rows.length)return;
    const unitTotal=allAgg.filter(r=>r.unit===u).reduce((s,r)=>s+r.total,0);
    h+='<div style="background:#f8fafc;border:1px solid var(--border);border-radius:10px;padding:12px">'
      +'<div style="font-weight:800;font-size:12px;margin-bottom:8px">'
      +'<span class="rel-badge rel-badge-unit">'+esc(u)+'</span>'
      +' <span style="font-size:10px;color:var(--muted)">total acum: '+unitTotal+'</span></div>'
      +'<table style="width:100%;font-size:11px;border-collapse:collapse">'
      +'<tr style="font-size:9px;color:var(--muted)"><td>Item</td><td style="text-align:right">Méd/mês</td><td style="text-align:right">Total acum.</td></tr>';
    rows.forEach(r=>{
      h+='<tr><td style="padding:3px 0;font-weight:600">'+esc(r.material)+'</td>'
        +'<td style="text-align:right;color:#1e40af;font-weight:700">'+r.avgMonth+'</td>'
        +'<td style="text-align:right;color:var(--muted)">'+r.total+'</td></tr>';
    });
    h+='</table></div>';
  });
  return h+'</div>';
}


/*
 ═══════════════════════════════════════════════════════════════════
 🔥 FIREBASE — Guia de Migração
 ═══════════════════════════════════════════════════════════════════
 
 1. Adicione no <head> (4 scripts Firebase):
    firebase-app-compat.js
    firebase-firestore-compat.js
    firebase-auth-compat.js
    firebase-storage-compat.js
    (todos de https://www.gstatic.com/firebasejs/10.x/)

 2. Inicialize:
    DataStore.initFirebase({
      apiKey: "...", authDomain: "...", projectId: "...",
      storageBucket: "...", messagingSenderId: "...", appId: "..."
    });

 3. Estrutura Firestore sugerida:
    semcas/hist_v4   -> array de arquivos historicos
    semcas/aliases   -> mapa de unificacao de nomes
    semcas/reqs      -> requisicoes ativas/finalizadas
    semcas/config    -> configuracoes gerais

 4. Storage (planilhas originais):
    firebase.storage().ref().child('planilhas/'+Date.now()+'_'+file.name).put(file)

 5. Auth (controle de acesso):
    firebase.auth().onAuthStateChanged(user => { ... })
 ═══════════════════════════════════════════════════════════════════
*/

// Inicialização


let __separacaoBooted = false;

function populateUnidadesSelect() {
  const sel = document.getElementById("rU");
  if (!sel) return;
  const unidades = (getUnidades() || []).filter((u) => (u?.atendeMateriais ?? true) === true);
  if (!unidades.length) return;

  const previous = sel.value || "";
  const groups = new Map();

  for (const u of unidades) {
    const nome = String(u?.nome || u?.unidadeNome || "").trim();
    if (!nome) continue;
    let tipo = String(u?.tipoUnidade || u?.tipo || "OUTROS").trim().toUpperCase();
    if (tipo === "SEMCAS") tipo = "SEDE";
    if (!groups.has(tipo)) groups.set(tipo, []);
    const sigla = String(u?.sigla || "").trim();
    groups.get(tipo).push({ nome, sigla });
  }

  for (const arr of groups.values()) arr.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  const tiposOrdenados = [...groups.keys()].sort((a, b) => a.localeCompare(b, "pt-BR"));

  sel.innerHTML = "";
  const opt0 = document.createElement("option");
  opt0.value = "";
  opt0.textContent = "-- Auto-detectar da planilha --";
  sel.appendChild(opt0);

  for (const tipo of tiposOrdenados) {
    const og = document.createElement("optgroup");
    og.label = tipo;
    for (const { nome, sigla } of groups.get(tipo)) {
      const opt = document.createElement("option");
      opt.value = nome;
      opt.textContent = sigla ? `${nome} [${sigla}]` : nome;
      og.appendChild(opt);
    }
    sel.appendChild(og);
  }

  if (previous) {
    const match = [...sel.options].find((o) => o.value === previous);
    if (match) sel.value = previous;
  }
}

function wrapPermissions() {
  const can = (action) => {
    const role = getUserRole(); // ← lê a role ATUAL, não a do init
    if (role === "admin") return true;
    if (role === "editor")
      return ["separar", "editar_ficha", "marcar_pronto", "entregar", "visualizar"].includes(action);
    return false;
  };
  if (typeof window.registrar === "function") {
    const orig = window.registrar;
    window.registrar = async () => {
      if (!isReady()) return showAlert("alert-login", "Não autenticado.", "error");
      if (!can("registrar")) return showAlert("connectionStatus", "Permissão negada: apenas Admin pode registrar.", "error");
      return orig();
    };
  }
}

export function initSeparacao() {
  ensureSeparacaoStyles();
  if (__separacaoBooted) return;
  __separacaoBooted = true;
  try { populateUnidadesSelect(); } catch (e) { console.error(e); }
  try { applySeparacaoRoleUI(); } catch (e) { console.error(e); }
  try {
    const EXPORTS = { goTab, registrar, previewReq, pegarParaSeparar, entregarReq, abrirFicha, fecharFicha, marcarPronto, marcarProntoLista, voltarSeparacao, printReq, printFicha, cancelarReq, excluirHistoricoReq, renderBuracos, renderUnificar, buildPainel, gerarRelatorio, exportarCSV, handleFile, handleHistFiles, ck, okModal, closeModal, showModal, editEntryYear, editEntryPeriod, toggleDetail, removeHistEntry, openEditor, closeEditor, saveEditor, edRemoveItem, edAddItem, edAddCat, clearHistDB, clearMateriaisDB, removeDuplicatesAuto, recalcAllDates, exportBackup, importBackup, goToFile, goPage, onModeChange, clearFilters, clearPanFilters, clearYears, selAllYears, clearAllAliases, doUnifMerge, toggleUnifSel, unifRemoveSel, clearUnifSel, removeAlias, openPrintBuracos, doPrintBuracos, showOrigemUnidade, showOrigemCategoria, renderRelatorio, setPanTipo, loadAllHistDBAndRefresh, PAGE_STATE, debouncedRenderPS, debouncedRenderES, debouncedRenderPE, debouncedRenderHI };
    Object.entries(EXPORTS).forEach(([k, v]) => { window[k] = v; });
  } catch (e) { console.error(e); }
  try { loadHistDB(); } catch (e) { console.error(e); }
  try { wrapPermissions(); } catch (_) {}
}

export function onSeparacaoTabChange() {
  initSeparacao();
  try { populateUnidadesSelect(); } catch (e) { console.error(e); }
  try { applySeparacaoRoleUI(); } catch (e) { console.error(e); }
  try { renderAll(); } catch (e) { console.error(e); }
}

export function renderSeparacao() {
  try {
    // ── FIX: Re-sync from Firestore cache on every render cycle ──
    // The auth.js listeners update the cache, but local REQS/HIST_DB
    // are only loaded once at init. Re-read them to stay fresh.
    const freshHist = getSemcasHistDB() || [];
    if (freshHist.length > 0 || HIST_DB.length === 0) {
      HIST_DB = freshHist;
    }
    const freshAliases = getSemcasAliases() || {};
    if (Object.keys(freshAliases).length > 0 || Object.keys(HIST_ALIASES).length === 0) {
      HIST_ALIASES = freshAliases;
    }
    applyAliasesToHistDB();
    applySeparacaoRoleUI();
    syncReqsFromCache();
    renderAll();
  } catch (e) { console.error(e); }
}
