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
function displayUnit(unidade){
  if(!unidade)return'Unidade';
  const units=getUnidades()||[];
  const norm=s=>rmAcc(String(s||'')).toLowerCase().trim().replace(/\s+/g,' ');
  const target=norm(unidade);
  const u=units.find(x=>norm(x?.nome||x?.unidadeNome||'')===target);
  if(u?.tipo){
    let tipo=String(u.tipo).toUpperCase().trim();
    if(tipo==='SEMCAS')tipo='SEDE';
    const uUp=rmAcc(unidade).toUpperCase();
    if(!uUp.startsWith(tipo))return tipo+' '+unidade;
  }
  return unidade;
}
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
function isHeader(r){
  const f=n(r[0]).toLowerCase();
  if(f==='material'||f==='materiais'||f==='materias'||f==='item') return true;
  // Also check if row looks like a header by checking subsequent columns
  if(/^materia/i.test(f)){
    const rest=(r.slice(1)||[]).map(c=>n(c).toLowerCase()).join(' ');
    if(/unid|quantid|qualid|solicita|atendid/i.test(rest)) return true;
  }
  return false;
}
function isFooter(r){const lo=n(r[0]).toLowerCase();return lo.includes('separado por')||lo.includes('separo por')||lo.includes('entregue por')||lo.includes('recebido por')||lo.includes('atenciosamente')||/^material\s+separad/i.test(lo)||/^material\s+entregue/i.test(lo)||/^material\s+recebid/i.test(lo)}
function isSkipLine(f){const lo=String(f||'').toLowerCase();return lo.includes('nome da unid')||/^materia[ils]*\s+para\s+consumo/i.test(lo)||/^solicita[cç][aã]o\s+de\s+materia/i.test(lo)||/^\s*data\s*:/i.test(lo)||/^\d{1,2}[\/\.]\d{1,2}[\/\.]\d{2,4}\s*$/.test(f)||/^fornecimento\s+de/i.test(lo)||/^unidade\s+de\s+acolhimento/i.test(lo)}
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
// Limpa nome de categoria: remove unidade/data embutidos
// Ex: "1- ALIMENTOS PROCESSADO- CRAS / SCFV-16/04/2026" → "ALIMENTOS PROCESSADO"
function cleanCatName(raw) {
  let s = raw;
  // Strip número+traço do início
  s = s.replace(/^\d+\s*[-–—.]\s*/, '');
  // Strip data dd/mm/aaaa ou dd\mm\aaaa no final ou no meio
  s = s.replace(/[-–\s]*\d{1,2}[\\/\.]\d{1,2}[\\/\.]\d{2,4}\s*$/, '');
  // Strip data textual "08 DE ABRIL 2026"
  s = s.replace(/[-–\s]*\d{1,2}\s+DE\s+\w+\s+\d{2,4}\s*$/i, '');
  // Strip "- UNIDADE / PROGRAMA" do final (ex: "- CRAS / SCFV")
  s = s.replace(/[-–]\s*(CRAS|CREAS|CT|SEDE|SCFV|PCF|PAIF|PAEFI)\b.*$/i, '');
  // Strip prefixos descritivos: "DESCRIÇÃO DE", "PEDIDO DE", "LANCHE PARA", "FORNECIMENTO DE"
  s = s.replace(/^(DESCRI[CÇ][AÃ]O\s+DE|PEDIDO\s+DE|LANCHE\s+PARA|FORNECIMENTO\s+DE|SOLICITA[CÇ][AÃ]O\s+DE)\s+/i, '');
  // Strip trailing dashes/spaces
  s = s.replace(/[-–\s]+$/, '').trim();
  // Se ficou vazio, volta o original sem o número
  if (!s) s = raw.replace(/^\d+\s*[-–—.]\s*/, '').replace(/[-–\s]+$/, '').trim();
  return s || raw;
}

// ═══════════════════════════════════════════════════════════════════
// CLASSIFICAÇÃO AUTOMÁTICA DE CATEGORIAS
// Mapeia variações para 5 categorias padrão
// ═══════════════════════════════════════════════════════════════════
const STD_CATEGORIES = [
  { id: 'descartavel', name: 'MATERIAL DESCARTÁVEL',         re: /descart[aá]vel|descartaveis/i, priority: 1 },
  { id: 'higiene',     name: 'MATERIAL DE HIGIENE PESSOAL',  re: /\bhigi[eê]n[ei]\b|uso\s+higi[eê]nico/i, priority: 2 },
  { id: 'limpeza',     name: 'MATERIAL DE LIMPEZA',          re: /limpeza|lavar|cozinha/i, priority: 3 },
  { id: 'expediente',  name: 'MATERIAL DE EXPEDIENTE',       re: /expediente|escrit[oó]rio|papelaria|consumo/i, priority: 4 },
  { id: 'processados', name: 'ALIMENTOS PROCESSADOS',        re: /aliment|processad|industrializ|lanche|scfv|pcf|kit\s*pcf|perec[íi]v|cereai?s?|gr[aã]os?/i, priority: 5 },
];

function classifyCategory(catName) {
  if (!catName) return null;
  const cleaned = cleanCatName(catName);
  const lo = rmAcc(cleaned).toLowerCase();
  
  // Casos especiais: "HIGIENE E LIMPEZA" → prioriza LIMPEZA (mais comum)
  if (/\bhigi[eê]n[ei].+limpeza|limpeza.+higi[eê]n/i.test(lo)) {
    return STD_CATEGORIES.find(c => c.id === 'limpeza');
  }
  
  // Aplica em ordem de prioridade (descartável antes de limpeza, etc.)
  for (const cat of STD_CATEGORIES.sort((a, b) => a.priority - b.priority)) {
    if (cat.re.test(lo)) return cat;
  }
  return null;
}

function suggestCategoryStandard(rawCatName) {
  const matched = classifyCategory(rawCatName);
  return matched ? matched.name : null;
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
      const m=f.match(/nome\s+da\s+unid(?:ade|e)?\s*[:;]?\s*(.+)/i);
      if(m){
        let name=m[1].trim();
        name=name.replace(/\s+\d{1,2}\s*[\/\.]\s*\d{1,2}\s*[\/\.]\s*\d{2,4}\s*$/,'');
        name=name.replace(/\s*[-–]\s*\d.*/,'').replace(/[\s:;–-]+$/,'').trim();
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
  
  // ── DETECÇÃO DE FORMATO: Escaneia headers para determinar layout de colunas ──
  // Formato A (4 colunas): Material | Unidade | Qtd Solicitada | Qtd Atendida
  // Formato B (3 colunas): Material | Qtd Solicitada | Qtd Atendida (sem coluna Unidade)
  let colMode = 'auto'; // 'standard' | 'no-unit'
  for (const row of rows) {
    const r = row.map(c => c == null ? '' : c);
    const f = n(r[0]).toLowerCase();
    if (/^materia/i.test(f)) {
      const c1 = n(r[1]).toLowerCase();
      const c2 = n(r[2]).toLowerCase();
      // Se col B é "Quantidade solicitada" ou "Qtd" (não "Unidade"), é formato sem coluna Unidade
      if (/quantid|qtd|solicita/i.test(c1) && !/unid/i.test(c1)) {
        colMode = 'no-unit';
      } else if (/^(unid|und)/i.test(c1)) {
        colMode = 'standard';
      }
      // Também verifica "Qualidade solicitada" (typo comum do ODT)
      if (/qualid/i.test(c1) && !/unid/i.test(c1)) {
        colMode = 'no-unit';
      }
      break;
    }
  }
  
  for(const row of rows){
    const r=row.map(c=>c==null?'':c);
    if(r.every(c=>!n(c)))continue;
    const f=n(r[0]);
    if(isFooter(r)||isSkipLine(f))continue;
    if(isHeader(r)){
      // Re-detecta colMode para cada header (pode mudar dentro do mesmo arquivo)
      const c1h = n(r[1]).toLowerCase();
      if (/quantid|qtd|solicita|qualid/i.test(c1h) && !/unid/i.test(c1h)) colMode = 'no-unit';
      else if (/^(unid|und)/i.test(c1h)) colMode = 'standard';
      if(cat&&cat.items.length>0){cat={name:'Outros Itens',items:[]};cats.push(cat)}
      continue;
    }
    if(isCategory(r)){cat={name:cleanCatName(f),items:[]};cats.push(cat);continue}
    if(!f)continue;
    
    let unid, qs, qa;
    
    if (colMode === 'no-unit') {
      // ── FORMATO 3 COLUNAS: Material | QtdSolicitada | QtdAtendida ──
      // Col B contém qty+unidade misturados ex: "01 PCT", "05 UND", "02UND"
      const raw1 = n(r[1]); // ex: "01 PCT"
      const raw2 = n(r[2]); // ex: "1PCT", "PCT", "0", 0
      
      // Extrair número e unidade da coluna "Qtd Solicitada"
      const mSol = raw1.match(/^(\d+)\s*(.*)$/);
      if (mSol) {
        qs = mSol[1]; // "01"
        unid = mSol[2].trim(); // "PCT"
      } else {
        qs = raw1;
        unid = '';
      }
      
      // Qtd Atendida: pode ser "1PCT", "PCT" (=1), "0", 0, ""
      const rawQa = String(raw2).trim();
      if (!rawQa || rawQa === '0') {
        qa = rawQa;
      } else {
        // Se é só unidade sem número (ex: "PCT", "UND") → assume qty = 1
        const mAte = rawQa.match(/^(\d+)\s*(.*)$/);
        if (mAte) {
          qa = mAte[1]; // "1" de "1PCT"
        } else if (/^[A-Za-z]+$/i.test(rawQa)) {
          // Puro texto de unidade sem número → é 1 (ex: "PCT" = 1 PCT)
          qa = '1';
        } else {
          qa = rawQa;
        }
      }
    } else {
      // ── FORMATO PADRÃO 4 COLUNAS ──
      unid = n(r[1]);
      qs = n(r[2]);
      qa = n(r[3]);
      
      // ── FIX: Coluna vazia entre solicitada e atendida (ODT com 5 colunas) ──
      if(!qa && r.length > 4 && n(r[4])) qa = n(r[4]);
      
      // ── FIX: Fallback para 3-col mesmo sem header (auto-detect por row) ──
      if (!qa && unid && /^\d+\s*[A-Za-z]/.test(unid)) {
        const m = unid.match(/^(\d+)\s*(.*)$/);
        if (m) {
          const potentialQa = qs;
          if (!potentialQa || /^\d/.test(potentialQa) || potentialQa === '0' || /^[A-Za-z]+$/i.test(potentialQa)) {
            qa = potentialQa || '';
            qs = m[1];
            unid = m[2].trim();
            // Se qa é só unidade sem número → 1
            if (qa && /^[A-Za-z]+$/i.test(qa)) qa = '1';
          }
        }
      }
      
      // Tratamento para formato de 2 colunas (Material | Quantidade)
      if(!qs && !qa && /^\d+/.test(unid) && !isNaN(extractNum(unid))) {
          qs = unid;
          unid = '';
      }
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
    if(isCategory([f])){cat={name:cleanCatName(f),items:[]};cats.push(cat);continue}
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

function isOdtFile(name) {
  return /\.odt$/i.test(name || '');
}

async function odtToRows(arrayBuffer) {
  let xmlText = '';
  if (typeof JSZip !== 'undefined') {
    const zip = await JSZip.loadAsync(arrayBuffer);
    const contentFile = zip.file('content.xml');
    if (!contentFile) throw new Error('ODT sem content.xml');
    xmlText = await contentFile.async('string');
  } else {
    throw new Error('JSZip não carregado.');
  }
  
  const doc = new DOMParser().parseFromString(xmlText, 'text/xml');
  const NS_TEXT = 'urn:oasis:names:tc:opendocument:xmlns:text:1.0';
  const NS_TABLE = 'urn:oasis:names:tc:opendocument:xmlns:table:1.0';
  const NS_OFFICE = 'urn:oasis:names:tc:opendocument:xmlns:office:1.0';
  
  // ── Extrai texto de um elemento com espaços entre sub-elementos ──
  function extractCellText(cell) {
    const parts = [];
    const paras = cell.getElementsByTagNameNS(NS_TEXT, 'p');
    if (paras.length > 0) {
      for (let pi = 0; pi < paras.length; pi++) {
        const spans = paras[pi].getElementsByTagNameNS(NS_TEXT, 'span');
        if (spans.length > 0) {
          const spanTexts = [];
          for (let si = 0; si < spans.length; si++) {
            const t = (spans[si].textContent || '').trim();
            if (t) spanTexts.push(t);
          }
          if (spanTexts.length) parts.push(spanTexts.join(' '));
          else {
            const t = (paras[pi].textContent || '').trim();
            if (t) parts.push(t);
          }
        } else {
          const t = (paras[pi].textContent || '').trim();
          if (t) parts.push(t);
        }
      }
    } else {
      const t = (cell.textContent || '').trim();
      if (t) parts.push(t);
    }
    return parts.join(' ').replace(/\s+/g, ' ').trim();
  }
  
  const rows = [];
  const body = doc.getElementsByTagNameNS(NS_OFFICE, 'text')[0] || doc.getElementsByTagNameNS(NS_OFFICE, 'body')[0];
  if (!body) return rows;
  
  const children = body.children || body.childNodes;
  for (let ci = 0; ci < children.length; ci++) {
    const el = children[ci];
    
    // Parágrafo de texto → pode ser nome de categoria
    if (el.localName === 'p') {
      const txt = extractCellText(el);
      if (txt && txt.length > 2) {
        rows.push([txt]);
      }
    }
    
    // Tabela → extrai linhas
    if (el.localName === 'table') {
      const trs = el.getElementsByTagNameNS(NS_TABLE, 'table-row');
      for (let ri = 0; ri < trs.length; ri++) {
        const tr = trs[ri];
        const cells = tr.getElementsByTagNameNS(NS_TABLE, 'table-cell');
        const rowData = [];
        for (let xi = 0; xi < cells.length; xi++) {
          const cell = cells[xi];
          const repeat = parseInt(cell.getAttribute('table:number-columns-repeated') || '1');
          const text = extractCellText(cell);
          if (repeat > 10 && !text) continue;
          for (let rp = 0; rp < Math.min(repeat, 6); rp++) {
            rowData.push(text);
          }
        }
        while (rowData.length > 0 && !rowData[rowData.length - 1]) rowData.pop();
        if (rowData.length > 0 && rowData.some(c => c)) rows.push(rowData);
      }
    }
  }
  
  return rows;
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
// FILE UPLOAD
// ═══════════════════════════════════════════════════════════════════
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
      // ── DOCX: converte tabelas para rows[][] via mammoth ──
      rows = await docxToRows(ev.target.result);
      // Cria um wb falso para compatibilidade com detectAllUnits
      wb = { SheetNames: ['Sheet1'], Sheets: { Sheet1: {} } };
    } else if (isOdtFile(file.name)) {
      // ── ODT: extrai tabelas do content.xml via JSZip ──
      rows = await odtToRows(ev.target.result);
      wb = { SheetNames: ['Sheet1'], Sheets: { Sheet1: {} } };
    } else {
      // ── Excel/ODS: pipeline original ──
      wb = XLSX.read(a, {type:'array', cellDates: true});
      const ws = wb.Sheets[wb.SheetNames[0]];
      rows = getSafeRows(ws);
    }

    tmpParsed=parseSheet(rows);
    tmpParsed.fileName=file.name;
    tmpParsed._wb=wb;
    tmpParsed._rows=rows;
    if (isDocxFile(file.name)) tmpParsed.formato = 'docx';
    if (isOdtFile(file.name)) tmpParsed.formato = 'odt';
    
    // Tenta arranjar um nome razoável se a unidade for "Unidade"
    if (tmpParsed.unitName === 'Unidade' || tmpParsed.unitName === 'Desconhecida') {
        const m = file.name.match(/(CRAS|CREAS|CENTRO POP|CT|PROCAD|AEPETI|ASTEC|ILPI|CAT|POP RUA)[a-z\s_0-9-ãõáéíóú]+/i);
        if(m) tmpParsed.unitName = normalizeUnit(m[0].replace(/[-_]/g, ' ').trim());
    }

    const el=document.getElementById('detectInfo');
    const totalItens=tmpParsed.categories.reduce((s,c)=>s+c.items.length,0);
    const per=typeof parsePeriodFromRows==='function'?parsePeriodFromRows(rows):null;
    const fy=typeof finalizePeriod==='function'?finalizePeriod(per,new Date().getFullYear()):null;
    const perTag=fy&&fy.label!=='?'
      ?'<span style="font-size:10px;color:var(--muted);margin-left:4px">📅 '+fy.label+(fy.yearAssumed?' <span style="color:#f59e0b">⚠️ ano assumido</span>':'')+'</span>'
      :'';
    const fmtTag=tmpParsed.formato==='docx'
      ?'<span class="format-tag" style="background:#e0e7ff;color:#3730a3">Formato DOCX</span>'
      :tmpParsed.formato==='odt'
      ?'<span class="format-tag" style="background:#fef3c7;color:#92400e">Formato ODT</span>'
      :tmpParsed.formato==='abrigo'
      ?'<span class="format-tag fmt-abrigo">Formato Abrigo</span>'
      :'<span class="format-tag fmt-padrao">Formato Padrão</span>';
    const nUnitsInFile=detectAllUnits(wb,rows);
    const multiTag=nUnitsInFile>1
      ?'<span style="font-size:10px;background:#dcfce7;color:#166534;padding:1px 7px;border-radius:8px;margin-left:4px">'+nUnitsInFile+' unidades</span>'
      :'';
    const uSel=document.getElementById('rU');
    // Normaliza o nome da unidade contra o banco de dados
    const normalizedDetected = normalizeUnit(tmpParsed.unitName) || tmpParsed.unitName;
    const isUnknown = !normalizedDetected || normalizedDetected === 'Desconhecida' || normalizedDetected === 'Unidade';
    const unitDisplayTag = isUnknown
      ? '<b style="color:#ef4444">⚠️ Unidade não detectada — selecione manualmente</b>'
      : '<b>'+esc(normalizedDetected)+'</b>';
    el.innerHTML=unitDisplayTag+' '+fmtTag+multiTag+perTag
      +'<br>'+tiposPills(tmpParsed.tipos)
      +' <span style="font-size:11px;color:var(--muted)">('+totalItens+' itens)</span>';
    const normFn = (x) => rmAcc(String(x||'')).toUpperCase().replace(/\s+/g,' ').trim();
    const normDet = normFn(normalizedDetected);
    let found = false;
    // Busca correspondência exata primeiro
    for (let i = 0; i < uSel.options.length; i++) {
      if (uSel.options[i].value && normFn(uSel.options[i].value) === normDet) {
        uSel.selectedIndex = i; found = true; break;
      }
    }
    // Depois busca parcial
    if (!found) {
      for (let i = 0; i < uSel.options.length; i++) {
        const optNorm = normFn(uSel.options[i].value);
        if (uSel.options[i].value && optNorm.length >= 4 && normDet.includes(optNorm)) {
          uSel.selectedIndex = i; found = true; break;
        }
      }
    }
    if (!found) uSel.selectedIndex = 0;
    // Destaca o select se a unidade não foi detectada
    if (isUnknown || !found) {
      uSel.style.borderColor = '#f59e0b';
      uSel.style.boxShadow = '0 0 0 3px rgba(245,158,11,.15)';
    } else {
      uSel.style.borderColor = '';
      uSel.style.boxShadow = '';
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
  const canReg = !!tmpParsed;
  document.getElementById('bR').disabled=!canReg;
  const bPreview = document.getElementById('bPreview');
  if(bPreview) bPreview.disabled=!canReg;
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
  
  titleEl.textContent='👁️ Pré-visualização: '+displayUnit(req.unidade);
  
  const actions = document.getElementById('fichaModalActions');
  const legend = document.getElementById('fichaModalLegend');
  if (actions) actions.style.display = 'none';
  if (legend) legend.style.display = 'none';
  
  bodyEl.innerHTML=buildFichaHTML(req, true);
  modalEl.classList.add('open');
  
  // Limpar os fstats na pré-visualização, pois não há contagem real ainda
  statsEl.innerHTML='';
}

// ═══════════════════════════════════════════════════════════════════
// VALIDAÇÃO PRÉ-REGISTRO — Detecta itens compostos e erros de nome
// ═══════════════════════════════════════════════════════════════════

const KNOWN_COLORS = /\b(AZUL|AZUIS|PRETA|PRETAS|VERMELHA|VERMELHAS|VERDE|AMARELA|BRANCA|BRANCO|PRETO|ROSA|LARANJA)\b/i;
const KNOWN_SIZES = /\b(\d+\s*L|\d+\s*ML|\d+\s*G|\d+\s*KG|GRANDE|PEQUENO|MEDIO|MEDIO|P|M|G|GG)\b/i;

// Anotações inúteis que as unidades colocam nos nomes dos materiais
const JUNK_PARENS = /\s*\(\s*(URGENTE|FALTA|SEM\s*ESTOQUE|REPOSI[ÇC][AÃ]O|FALTANDO|PRECISA|NECESSARIO|NECESS[AÁ]RIO|IMPORTANTE|PRIORIDADE|VERIFICAR|FAVOR|POR\s*FAVOR|OBS|OBSERVA[ÇC][AÃ]O|ATEN[ÇC][AÃ]O|SOLICITA[ÇC][AÃ]O|PEDIDO|\d+\s*(?:PACOTE|PCT|UND|UNID|CX|CAIXA|LITRO|KG|ROLO|RESMA|PAR)S?)\s*\)\s*$/i;
const JUNK_SUFFIX = /\s*[-–—]\s*$|^\s*[""]|[""]\s*$/g;
const JUNK_TRAILING = /\s+(URGENTE|FALTA|SEM\s*ESTOQUE)\s*$/i;

function cleanMaterialJunk(name) {
  if (!name) return name;
  let s = name.trim();
  // Remove aspas em volta: "BOM AR" → BOM AR
  s = s.replace(/^[""\u201C\u201D]+|[""\u201C\u201D]+$/g, '').trim();
  // Remove (URGENTE), (FALTA), etc
  s = s.replace(JUNK_PARENS, '').trim();
  // Remove "- URGENTE", trailing "URGENTE"
  s = s.replace(JUNK_TRAILING, '').trim();
  // Remove traço/dash solto no final: "PAPEL HIGIÊNICO –"
  s = s.replace(/\s*[-–—]+\s*$/, '').trim();
  
  // ─── Normaliza parênteses com qualificador simples ───
  // "Canetas ( azul)" → "Canetas azul"
  // "Cola (branca)" → "Cola branca"
  // Mas NÃO mexe em "(cores variadas)", "(15L/50L)", "(doce e salgado)"
  s = s.replace(/\(\s*([^)]{1,20})\s*\)\s*$/i, (match, inner) => {
    const innerTrim = inner.trim();
    const words = innerTrim.split(/\s+/);
    // Se é 1 palavra simples (cor, tipo) → remove parens
    if (words.length === 1 && !/\/|,/.test(innerTrim) && !/urgente|falta|estoque/i.test(innerTrim)) {
      return ' ' + innerTrim;
    }
    // Se contém "/" ou "E" ou "," → deixa (será tratado pelo detector de splits)
    if (/\/|\bE\b|,/i.test(innerTrim)) return match;
    // Se é descritivo (2+ palavras) → mantém parens
    return match;
  }).trim();
  
  // Remove espaços duplos
  s = s.replace(/\s+/g, ' ').trim();
  return s || name;
}

// ═══════════════════════════════════════════════════════════════════
// NORMALIZAÇÃO GRAMATICAL — Plural → Singular + Ortografia
// ═══════════════════════════════════════════════════════════════════

const SINGULAR_EXCEPTIONS = new Set([
  'CLIPS','GRAMPOS','MATERIAIS','MATERIAS','ITENS',
  'DIVERSOS','PROCESSADOS','INDUSTRIALIZADOS',
  'CEREAIS','DESCARTAVEIS','PERECIVEIS',
  // Invariáveis / já singular terminando em S
  'LAPIS','ATLAS','VIRUS','ONIBUS','PIRES','TRES',
  'GAS','MAIS','MENOS','DOIS','SEIS','GRATIS',
  'GUARDANAPOS','MULTIUSO'
]);

function singularizePT(word) {
  if (!word || word.length < 4) return word;
  const w = rmAcc(word).toUpperCase().replace(/[^A-Z]/g,'');
  if (SINGULAR_EXCEPTIONS.has(w)) return word;
  // Detecta se o sufixo é lowercase para preservar case
  const isLower = word.slice(-1) === word.slice(-1).toLowerCase();
  const rep = (s) => isLower ? s.toLowerCase() : s;
  if (/[ÕO][Ee][Ss]$/i.test(word)) return word.replace(/[ÕO][Ee][Ss]$/i, rep('ÃO'));
  if (/[ÃA][Ee][Ss]$/i.test(word)) return word.replace(/[ÃA][Ee][Ss]$/i, rep('ÃO'));
  if (/[ÉE][Ii][Ss]$/i.test(word)) return word.replace(/[ÉE][Ii][Ss]$/i, rep('EL'));
  if (/[Uu][Ii][Ss]$/i.test(word)) return word.replace(/[Uu][Ii][Ss]$/i, rep('UL'));
  if (/[ÓO][Ii][Ss]$/i.test(word)) return word.replace(/[ÓO][Ii][Ss]$/i, rep('OL'));
  if (/[RSZ][Ee][Ss]$/i.test(word) && word.length > 5) return word.replace(/[Ee][Ss]$/i, '');
  if (/[AEIOUÃÕaeiouãõ][Ss]$/i.test(word)) return word.replace(/[Ss]$/, '');
  return word;
}

function singularizeMaterial(name) {
  if (!name) return name;
  const SKIP = new Set(['DE','DO','DA','DOS','DAS','EM','NO','NA','PARA','POR','COM','E','OU','P/','C/','S/']);
  
  // Separa a parte principal da parte entre parênteses
  const parenMatch = name.match(/^(.+?)(\s*\([^)]*\)\s*)$/);
  let mainPart = parenMatch ? parenMatch[1] : name;
  const parenPart = parenMatch ? parenMatch[2] : '';
  
  // Singulariza apenas a parte principal (fora dos parênteses)
  mainPart = mainPart.split(/\s+/).map(w => {
    if (SKIP.has(w.toUpperCase()) || w.length < 3 || !/[Ss]$/.test(w)) return w;
    return singularizePT(w);
  }).join(' ');
  
  return (mainPart + parenPart).trim();
}

const SPELLING_FIXES = [
  // ─── ERROS DA LISTA REAL DE REQUISIÇÕES ────
  [/\bDESIFETANTE\b/gi,'DESINFETANTE'],
  [/\bPAPEL\s+HIGIENIICO\b/gi,'PAPEL HIGIÊNICO'],
  [/\bALMODADA\b/gi,'ALMOFADA'],
  [/\bGAMPEADOR\b/gi,'GRAMPEADOR'],
  [/\bFRANELA\b/gi,'FLANELA'],
  [/\bPANO\s+TOLHA\b/gi,'PAPEL TOALHA'],
  [/\bPAPEL\s+TOLHA\b/gi,'PAPEL TOALHA'],
  [/\bTESSOURA\b/gi,'TESOURA'],
  [/\bLEITELIQUIDO\b/gi,'LEITE LÍQUIDO'],
  [/\bSPEDRA\b/gi,'PEDRA'],
  [/\bPOSTICHE\b/gi,'POST-IT'],[/\bPOSTITE\b/gi,'POST-IT'],[/\bPOST IT\b/gi,'POST-IT'],
  [/\bPRANCETA\b/gi,'PRANCHETA'],[/\bPLANCHETA\b/gi,'PRANCHETA'],
  [/\bLAPIZ\b/gi,'LÁPIS'],
  [/\bVASOURA\b/gi,'VASSOURA'],[/\bPIASABA\b/gi,'PIAÇAVA'],[/\bPIACAVA\b/gi,'PIAÇAVA'],
  [/\bEMBARRA\b/gi,'EM BARRA'],[/\bEMPEDRA\b/gi,'EM PEDRA'],[/\bEMPO\b/gi,'EM PÓ'],
  [/\bLAVRA\b/gi,'LAVAR'],[/\bDESCATAVEL\b/gi,'DESCARTÁVEL'],
  [/\bESCANCELA\b/gi,'ESCARCELA'],[/\bESCANCELAS\b/gi,'ESCARCELAS'],
  [/\bCANETA\s+ESFEROGR[AÃ]FICA\b/gi,'CANETA'],
  [/\bCHAMEQUINHO\b/gi,'CHAMEX'],
  [/\bESTRATO\b/gi,'EXTRATOR'],
  [/\bGUARADANAPOS\b/gi,'GUARDANAPOS'],
  [/\bVERG[EÊ]\b/gi,'VERGÊ'],
  [/\bFOSFORO\b/gi,'FÓSFORO'],
  [/\bOFF\s*STICK\b/gi,'POST-IT'],
  [/\bBOM\s*BRIL\b/gi,'PALHA DE AÇO'],[/\bBOMBRIL\b/gi,'PALHA DE AÇO'],
  [/\bLA\s+DE\s+ACO\b/gi,'PALHA DE AÇO'],[/\bLA\s+DE\s+AÇO\b/gi,'PALHA DE AÇO'],
  [/\bMAIZENA\b/gi,'AMIDO DE MILHO'],[/\bNESCAU\b/gi,'ACHOCOLATADO EM PÓ'],
  [/\bSABAO\s+EMBARRA\b/gi,'SABÃO EM BARRA'],
  [/\bSABAO\s+EMPEDRA\b/gi,'SABÃO EM PEDRA'],
  [/\bDET\.\s*LAVA\s*LOUCA\b/gi,'DETERGENTE LAVA-LOUÇAS'],
  [/\bLAVA\s*LOU[CÇ]AS?\b/gi,'DETERGENTE LAVA-LOUÇAS'],
  [/\bCREEM\s*CRACKER\b/gi,'CREAM CRACKER'],
  [/\bREHEADO\b/gi,'RECHEADO'],
  [/\bBISCOITOS?\s+DE\s+POVILHO\b/gi,'BISCOITO DE POLVILHO'],
  [/\bMIGUAL\b/gi,'MINGAU'],[/\bMINGUAU\b/gi,'MINGAU'],
  [/\bSAFONADA\b/gi,'SANFONADA'],[/\bPAPEL\s+CARTAO\b/gi,'PAPEL CARTÃO'],
  [/\bEV\.?A\b/gi,'EVA'],[/\bT\.?N\.?T\b/gi,'TNT'],
  [/\bSABONETE\s+BARRA\b/gi,'SABONETE EM BARRA'],
  // ─── ACENTUAÇÃO ─────────────────────
  [/\bACUCAR\b/gi,'AÇÚCAR'],[/\bAGUA\b/gi,'ÁGUA'],[/\bALCOOL\b/gi,'ÁLCOOL'],
  [/\bOLEO\b/gi,'ÓLEO'],[/\bSABAO\b/gi,'SABÃO'],
  [/\bFEIJAO\b/gi,'FEIJÃO'],[/\bMACARRAO\b/gi,'MACARRÃO'],[/\bFLOCAO\b/gi,'FLOCÃO'],
  [/\bESCOVAO\b/gi,'ESCOVÃO'],[/\bSANITARIA\b/gi,'SANITÁRIA'],[/\bHIGIENICO\b/gi,'HIGIÊNICO'],
  [/\bDESCARTAVEL\b/gi,'DESCARTÁVEL'],[/\bDESCARTAVEIS\b/gi,'DESCARTÁVEIS'],
  [/\bLIQUIDO\b/gi,'LÍQUIDO'],[/\bLIQUIDA\b/gi,'LÍQUIDA'],
  [/\bTERMICA\b/gi,'TÉRMICA'],[/\bTERMICO\b/gi,'TÉRMICO'],
  [/\bPLASTICA\b/gi,'PLÁSTICA'],[/\bPLASTICO\b/gi,'PLÁSTICO'],
  [/\bELASTICO\b/gi,'ELÁSTICO'],[/\bELASTICA\b/gi,'ELÁSTICA'],
  [/\bMASCARA\b/gi,'MÁSCARA'],[/\bCAFE\b/gi,'CAFÉ'],[/\bCHA\b/gi,'CHÁ'],
  [/\bLAMPADA\b/gi,'LÂMPADA'],[/\bLATEX\b/gi,'LÁTEX'],[/\bPIACAVA\b/gi,'PIAÇAVA'],
  [/\bALCOOLICA\b/gi,'ALCOÓLICA'],[/\bLEITE EM PO\b/gi,'LEITE EM PÓ'],
  [/\bPE\b/gi,'PÉ'],[/\bPAO\b/gi,'PÃO'],[/\bCRACHA\b/gi,'CRACHÁ'],
  [/\bCORDAO\b/gi,'CORDÃO'],[/\bBALAO\b/gi,'BALÃO'],[/\bSOLUVEL\b/gi,'SOLÚVEL'],
  [/\bTOPAZIO\b/gi,'TOPÁZIO'],[/\bANTIBACTER(IA)?\b/gi,'ANTIBACTERIANO'],
  [/\bMILIMETRADO\b/gi,'MILIMETRADO'],[/\bAGUAS\b/gi,'ÁGUAS'],
  [/\bBANHEIRO\b/gi,'BANHEIRO'],[/\bLIMPADOR\b/gi,'LIMPADOR'],
  [/\bSAPOLIO\b/gi,'SAPÓLIO'],[/\bCATALOGO\b/gi,'CATÁLOGO'],
  [/\bHIDRAULICO\b/gi,'HIDRÁULICO'],[/\bELETRICO\b/gi,'ELÉTRICO'],
  [/\bAPARELHO\b/gi,'APARELHO'],[/\bPOMBO\b/gi,'POMBO'],
  [/\bINCOLOR\b/gi,'INCOLOR'],[/\bGERIATRIA\b/gi,'GERIÁTRICA'],
  [/\bGERIATRICA\b/gi,'GERIÁTRICA'],[/\bGERIATRICO\b/gi,'GERIÁTRICO'],
  [/\bABELHA\b/gi,'ABELHA'],[/\bCOLONIA\b/gi,'COLÔNIA'],
  [/\bUMEDECIDO\b/gi,'UMEDECIDO'],[/\bAZEDO\b/gi,'AZEDO'],
  [/\bMUCILON\b/gi,'MUCILON'],[/\bCREMOGEMA\b/gi,'CREMOGEMA'],
  [/\bQUIT\b/gi,'KIT'],[/\bKIT\b/gi,'KIT'],
  [/\bINFANTIL\b/gi,'INFANTIL'],[/\bINSTANTANEO\b/gi,'INSTANTÂNEO'],
  [/\bINSTANTANEA\b/gi,'INSTANTÂNEA'],[/\bQUIMICO\b/gi,'QUÍMICO'],
  [/\bQUIMICA\b/gi,'QUÍMICA'],[/\bSANITARIO\b/gi,'SANITÁRIO'],
  [/\bEMBALAGEM\b/gi,'EMBALAGEM'],[/\bGRATUITO\b/gi,'GRATUITO'],
  [/\bALUMINIO\b/gi,'ALUMÍNIO'],[/\bATOMICO\b/gi,'ATÔMICO'],
  [/\bATOMICA\b/gi,'ATÔMICA'],[/\bRECARREGAVEL\b/gi,'RECARREGÁVEL'],
  
  // ─── LÁPIS sempre em singular (invariável) ───
  [/\bLAPIS\b/gi,'LÁPIS'],
  
  // ─── ERROS COMUNS DE DIGITAÇÃO ─────────────
  [/\bDESINFETANE\b/gi,'DESINFETANTE'],[/\bDETERJENTE\b/gi,'DETERGENTE'],
  [/\bDESINFETANTE\s+DESIENFETANTE\b/gi,'DESINFETANTE'],[/\bDISENFETANTE\b/gi,'DESINFETANTE'],
  [/\bHIJENICO\b/gi,'HIGIÊNICO'],[/\bHIJIENICO\b/gi,'HIGIÊNICO'],
  [/\bVASSORA\b/gi,'VASSOURA'],[/\bVASOURA\b/gi,'VASSOURA'],
  [/\bGUADANAPO\b/gi,'GUARDANAPO'],[/\bGAUDINAPO\b/gi,'GUARDANAPO'],
  [/\bTESORA\b/gi,'TESOURA'],[/\bALCOL\b/gi,'ÁLCOOL'],[/\bACOOL\b/gi,'ÁLCOOL'],
  [/\bSHANPOO\b/gi,'SHAMPOO'],[/\bXAMPU\b/gi,'SHAMPOO'],
  [/\bESPOJA\b/gi,'ESPONJA'],[/\bESFREGAO\b/gi,'ESFREGÃO'],
  [/\bMASSADORA\b/gi,'AMASSADORA'],[/\bBORACHA\b/gi,'BORRACHA'],
  [/\bCOPOS?\s+DESCATAVEL/gi,'COPOS DESCARTÁVEIS'],
  [/\bSABONET\b/gi,'SABONETE'],[/\bASOLHO\b/gi,'ASSOALHO'],
  [/\bCANIVET\b/gi,'CANIVETE'],[/\bARMARIO\b/gi,'ARMÁRIO'],
  [/\bMOVEL\b/gi,'MÓVEL'],[/\bMOVEIS\b/gi,'MÓVEIS'],
  [/\bARMAZEM\b/gi,'ARMAZÉM'],[/\bPIRE\b/gi,'PIRES'],
  [/\bCELOFAN\b/gi,'CELOFANE'],[/\bGRAMPIADOR\b/gi,'GRAMPEADOR'],
  [/\bPERFURA\b/gi,'PERFURADOR'],[/\bEXTILETE\b/gi,'ESTILETE'],
  [/\bRAZORBLADE\b/gi,'LÂMINA DE BARBEAR'],
  
  // ─── VARIAÇÕES DE NOME ─────────────────────
  [/\bFITA\s+DUREX\s+TRANSPARENTE\b/gi,'FITA ADESIVA TRANSPARENTE'],
  [/\bSABAO\s+DE\s+COCO\b/gi,'SABÃO DE COCO'],
  [/\bOMO\b/gi,'SABÃO EM PÓ'],[/\bBRILHANTE\b/gi,'SABÃO EM PÓ'],
  [/\bYPE\b/gi,'DETERGENTE'],[/\bYPÊ\b/gi,'DETERGENTE'],
  [/\bQBOA\b/gi,'ÁGUA SANITÁRIA'],[/\bQBOA\b/gi,'ÁGUA SANITÁRIA'],
  [/\bKBOA\b/gi,'ÁGUA SANITÁRIA'],
];

function fixSpelling(name) {
  if (!name) return name;
  let s = name;
  for (const [re, fix] of SPELLING_FIXES) s = s.replace(re, fix);
  return s;
}

function normalizeMaterialName(rawName) {
  if (!rawName) return rawName;
  let s = cleanMaterialJunk(rawName);
  s = fixSpelling(s);
  s = singularizeMaterial(s);
  return s;
}

function detectItemIssues(parsed) {
  if (!parsed || !parsed.categories) return [];
  const issues = [];

  parsed.categories.forEach((cat, catIdx) => {
    cat.items.forEach((item, itemIdx) => {
      const rawMat = String(item.material || '').trim();
      if (rawMat.length < 3) return;
      
      // Pré-limpeza: remove junk ANTES de analisar splits
      const mat = cleanMaterialJunk(rawMat);
      const matNorm = normMat(mat);

      // ═══ FASE -1: ITENS AMBÍGUOS QUE SEMPRE SEPARAM ═══
      
      // ── COPO ──
      const isCopo = /^\s*COPO/i.test(matNorm) || /^\s*COPOS/i.test(matNorm);
      const hasAgua = /\b(AGUA|H2O)\b/i.test(matNorm);
      const hasCafe = /\b(CAFE|CAFEZINHO|EXPRESSO)\b/i.test(matNorm);
      
      if (isCopo && !hasAgua && !hasCafe) {
        issues.push({
          type: 'split', catIdx, itemIdx, original: rawMat, item,
          splits: [
            { material: 'COPO DESCARTÁVEL PARA ÁGUA', unidade: item.unidade },
            { material: 'COPO DESCARTÁVEL PARA CAFÉ', unidade: item.unidade }
          ],
          reason: 'Copo genérico — separe em Água e Café'
        });
        return;
      }
      if (isCopo && hasAgua && matNorm !== 'COPO DESCARTAVEL PARA AGUA') {
        issues.push({ type: 'rename', catIdx, itemIdx, original: rawMat, item, suggested: 'COPO DESCARTÁVEL PARA ÁGUA', reason: 'Padronizar nome do copo' });
        return;
      }
      if (isCopo && hasCafe && matNorm !== 'COPO DESCARTAVEL PARA CAFE') {
        issues.push({ type: 'rename', catIdx, itemIdx, original: rawMat, item, suggested: 'COPO DESCARTÁVEL PARA CAFÉ', reason: 'Padronizar nome do copo' });
        return;
      }
      
      // ── SABÃO ── (em pó, em barra, em pedra, líquido)
      const isSabao = /^\s*(SABAO|SABOES)\s*$/i.test(matNorm) || /^\s*(SABAO|SABOES)\s+(PARA|DE|P\/)/i.test(matNorm);
      const sabaoType = matNorm.match(/\bEM\s*(PO|BARRA|PEDRA)\b|\bLIQUIDO\b|\b(PO|BARRA|PEDRA)\b/i);
      if ((/^\s*SABAO\b/i.test(matNorm) || /^\s*SABOES\b/i.test(matNorm)) && !sabaoType && !hasAgua) {
        issues.push({
          type: 'split', catIdx, itemIdx, original: rawMat, item,
          splits: [
            { material: 'SABÃO EM PÓ', unidade: item.unidade },
            { material: 'SABÃO EM BARRA', unidade: item.unidade },
            { material: 'SABÃO LÍQUIDO', unidade: item.unidade }
          ],
          reason: 'Sabão genérico — especifique tipo (pó, barra, líquido)'
        });
        return;
      }
      
      // ── LEITE ── (em pó, líquido, condensado)
      const isLeite = /^\s*LEITE\s*$/i.test(matNorm);
      if (isLeite) {
        issues.push({
          type: 'split', catIdx, itemIdx, original: rawMat, item,
          splits: [
            { material: 'LEITE EM PÓ', unidade: item.unidade },
            { material: 'LEITE LÍQUIDO', unidade: item.unidade },
            { material: 'LEITE CONDENSADO', unidade: item.unidade }
          ],
          reason: 'Leite genérico — especifique tipo'
        });
        return;
      }
      
      // ── COLA ── (branca, bastão, quente, isopor)
      const isColaGeneric = /^\s*COLA\s*$/i.test(matNorm) || /^\s*COLAS\s*$/i.test(matNorm);
      if (isColaGeneric) {
        issues.push({
          type: 'split', catIdx, itemIdx, original: rawMat, item,
          splits: [
            { material: 'COLA BRANCA', unidade: item.unidade },
            { material: 'COLA BASTÃO', unidade: item.unidade },
            { material: 'COLA QUENTE', unidade: item.unidade }
          ],
          reason: 'Cola genérica — especifique tipo (branca, bastão, quente)'
        });
        return;
      }
      
      // ── PAPEL ── (A4, toalha, higiênico, cartão)
      const isPapelGeneric = /^\s*PAPEL\s*$/i.test(matNorm) || /^\s*PAPEIS\s*$/i.test(matNorm);
      if (isPapelGeneric) {
        issues.push({
          type: 'split', catIdx, itemIdx, original: rawMat, item,
          splits: [
            { material: 'RESMA DE PAPEL A4', unidade: item.unidade },
            { material: 'PAPEL TOALHA', unidade: item.unidade },
            { material: 'PAPEL HIGIÊNICO', unidade: item.unidade }
          ],
          reason: 'Papel genérico — especifique tipo'
        });
        return;
      }
      
      // ── LUVA / MÁSCARA ── Apenas padroniza o nome, NÃO força split
      if (/^\s*LUVAS?\s*$/i.test(matNorm)) {
        if (rawMat !== 'LUVA') {
          issues.push({ type: 'rename', catIdx, itemIdx, original: rawMat, item, suggested: 'LUVA', reason: 'Padronizar nome' });
          return;
        }
      }
      if (/^\s*MASCARAS?\s*$/i.test(matNorm)) {
        if (rawMat !== 'MÁSCARA') {
          issues.push({ type: 'rename', catIdx, itemIdx, original: rawMat, item, suggested: 'MÁSCARA', reason: 'Padronizar nome' });
          return;
        }
      }
      
      // ── COLHER ── sempre descartável (obriga especificar)
      const isColherGeneric = /^\s*COLHER(ES)?\s*$/i.test(matNorm) || /^\s*COLHER(ES)?\s+DESCARTAVEL/i.test(matNorm);
      if (isColherGeneric) {
        const target = 'COLHER DESCARTÁVEL';
        if (rawMat !== target) {
          issues.push({ type: 'rename', catIdx, itemIdx, original: rawMat, item, suggested: target, reason: 'Padronizar: colher é sempre descartável' });
          return;
        }
      }
      
      // ── PRATO ── sempre descartável (obriga especificar)
      const isPratoGeneric = /^\s*PRATOS?\s*$/i.test(matNorm) || /^\s*PRATOS?\s+DESCARTAVEL/i.test(matNorm) || /^\s*PRATINHOS?\s+DESCARTAVEL/i.test(matNorm);
      if (isPratoGeneric) {
        const target = 'PRATO DESCARTÁVEL';
        if (rawMat !== target) {
          issues.push({ type: 'rename', catIdx, itemIdx, original: rawMat, item, suggested: target, reason: 'Padronizar: prato é sempre descartável' });
          return;
        }
      }
      
      // ── GARFO ── também descartável
      if (/^\s*GARFOS?\s*$/i.test(matNorm) || /^\s*GARFINHOS?\s*(DESCARTAVEIS?)?\s*$/i.test(matNorm)) {
        const target = 'GARFO DESCARTÁVEL';
        if (rawMat !== target) {
          issues.push({ type: 'rename', catIdx, itemIdx, original: rawMat, item, suggested: target, reason: 'Padronizar: garfo é sempre descartável' });
          return;
        }
      }
      
      // ── CESTO DE LIXO / LIXEIRA ── sempre "CESTO DE LIXO"
      if (/^\s*(LIXEIRA|LIXEIRAS)\b/i.test(matNorm) && !/\bCESTO\b/i.test(matNorm)) {
        // Detecta qualificadores comuns
        let suffix = '';
        if (/\bCOM\s+TAMPA\b/i.test(matNorm) || /\bC\/\s*TAMPA\b/i.test(matNorm)) suffix += ' COM TAMPA';
        if (/\bPEDAL\b/i.test(matNorm)) suffix += ' COM PEDAL';
        if (/\bGRANDE\b/i.test(matNorm)) suffix += ' GRANDE';
        else if (/\bPEQUEN[OA]\b/i.test(matNorm)) suffix += ' PEQUENO';
        else if (/\bMEDIO|MÉDIA?\b/i.test(matNorm)) suffix += ' MÉDIO';
        const target = 'CESTO DE LIXO' + suffix;
        issues.push({ type: 'rename', catIdx, itemIdx, original: rawMat, item, suggested: target, reason: 'Padronizar: usar "Cesto de Lixo"' });
        return;
      }
      
      // ── CLIPS ── OBRIGATÓRIO especificar tamanho
      const isClipsGeneric = /^\s*CLIPE?S?\s*$/i.test(matNorm) || /^\s*CLIPE?S?\s+PARA\s+PAPEL\s*$/i.test(matNorm);
      if (isClipsGeneric) {
        issues.push({
          type: 'split', catIdx, itemIdx, original: rawMat, item,
          splits: [
            { material: 'CLIPS Nº 2/0', unidade: item.unidade },
            { material: 'CLIPS Nº 3/0', unidade: item.unidade },
            { material: 'CLIPS Nº 4/0', unidade: item.unidade },
            { material: 'CLIPS Nº 6/0', unidade: item.unidade },
            { material: 'CLIPS Nº 8/0', unidade: item.unidade }
          ],
          reason: 'Clips genérico — ESCOLHA o(s) tamanho(s) necessário(s)'
        });
        return;
      }
      
      // ── CLIPS com tamanho informal (pequeno, médio, grande) → converte para número ──
      if (/^\s*CLIPE?S?\s+(PEQUENO|MEDIO|GRANDE)\s*$/i.test(matNorm)) {
        const sizeMap = { PEQUENO: '2/0', MEDIO: '4/0', GRANDE: '8/0' };
        const sizeMatch = matNorm.match(/\b(PEQUENO|MEDIO|GRANDE)\b/i);
        const num = sizeMap[sizeMatch[1].toUpperCase()];
        const target = 'CLIPS Nº ' + num;
        issues.push({ type: 'rename', catIdx, itemIdx, original: rawMat, item, suggested: target, reason: 'Padronizar clips por número' });
        return;
      }
      
      // ── CLIPS já com número mas formato diferente (CLIPS 04, CLIPS 4) → CLIPS Nº 4/0 ──
      const clipsNumMatch = matNorm.match(/^\s*CLIPE?S?\s+(?:N[°º.]?\s*)?(\d+)(?:\/(\d+))?\s*$/i);
      if (clipsNumMatch) {
        const num = parseInt(clipsNumMatch[1]);
        const denom = clipsNumMatch[2];
        // Remove zeros à esquerda e padroniza
        const target = 'CLIPS Nº ' + num + '/' + (denom || '0');
        const targetNorm = target.toUpperCase();
        if (matNorm.replace(/\s+/g,' ') !== targetNorm) {
          issues.push({ type: 'rename', catIdx, itemIdx, original: rawMat, item, suggested: target, reason: 'Padronizar formato do clips' });
          return;
        }
      }
      
      // ── MINGAU ── geralmente é de milho (padroniza)
      if (/^\s*MINGAU\s*$/i.test(matNorm) || /^\s*MINGAUS?\s+DE\s+MIGUAL\s*$/i.test(matNorm)) {
        issues.push({ type: 'rename', catIdx, itemIdx, original: rawMat, item, suggested: 'MINGAU DE MILHO', reason: 'Padronizar: mingau é de milho por padrão' });
        return;
      }
      
      // ── MILHO PARA MINGAU / MILHO P/MINGAU ── → MILHO DE MINGAU
      if (/\bMILHO\s*(PARA|P\/|DE)\s*MI[NG]G?U?AL?\b/i.test(matNorm) || /\bMILHO\s+P\/MING/i.test(matNorm)) {
        const target = 'MILHO DE MINGAU';
        if (matNorm !== 'MILHO DE MINGAU') {
          issues.push({ type: 'rename', catIdx, itemIdx, original: rawMat, item, suggested: target, reason: 'Padronizar nome' });
          return;
        }
      }
      
      // ── MASSA PARA MINGAU ── (tapioca) → MASSA DE TAPIOCA PARA MINGAU
      if (/\bMASSA\s*(PARA|P\/|DE)?\s*MI[NG]G?U?AL?\b/i.test(matNorm)) {
        issues.push({ type: 'rename', catIdx, itemIdx, original: rawMat, item, suggested: 'MASSA DE TAPIOCA PARA MINGAU', reason: 'Padronizar nome' });
        return;
      }
      
      // ── MASSA PARA BOLO / MISTURA ── → MASSA PRONTA PARA BOLO
      if (/\b(MASSA|MISTURA)\s+(PARA|P\/|DE)?\s*BOLO/i.test(matNorm)) {
        issues.push({ type: 'rename', catIdx, itemIdx, original: rawMat, item, suggested: 'MASSA PRONTA PARA BOLO', reason: 'Padronizar nome' });
        return;
      }
      
      // ── PASTA ── só diz PASTA (sem AZ, sanfonada, etc)
      const isPastaGeneric = /^\s*PASTAS?\s*$/i.test(matNorm);
      if (isPastaGeneric) {
        issues.push({
          type: 'split', catIdx, itemIdx, original: rawMat, item,
          splits: [
            { material: 'PASTA AZ', unidade: item.unidade },
            { material: 'PASTA SANFONADA', unidade: item.unidade },
            { material: 'PASTA SUSPENSA', unidade: item.unidade },
            { material: 'PASTA POLIONDA', unidade: item.unidade }
          ],
          reason: 'Pasta genérica — especifique tipo'
        });
        return;
      }


      // ═══ FASE 0: PARÊNTESES COM VARIANTES — "Biscoito (doce e salgado)" ═══
      const parenEMatch = mat.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
      if (parenEMatch) {
        const base = parenEMatch[1].trim();
        const inner = parenEMatch[2].trim();
        
        // Detecta "VAR1 e VAR2" ou "VAR1, VAR2" ou "VAR1/VAR2" dentro dos parens
        let variants = null;
        if (/\bE\b/i.test(inner) && !/urgente|falta|estoque|cores|tamanhos|pacote|unid/i.test(inner)) {
          variants = inner.split(/\s+E\s+/i).map(v => v.trim()).filter(v => v.length >= 1);
        } else if (inner.includes(',') && !/urgente|falta|cores|tamanhos/i.test(inner)) {
          variants = inner.split(',').map(v => v.trim()).filter(v => v.length >= 1);
        } else if (inner.includes('/') && !/urgente|falta/i.test(inner)) {
          variants = inner.split('/').map(v => v.trim()).filter(v => v.length >= 1);
        }
        
        if (variants && variants.length >= 2) {
          issues.push({
            type: 'split', catIdx, itemIdx, original: rawMat, item,
            splits: variants.map(v => {
              const name = base + ' ' + v.charAt(0).toUpperCase() + v.slice(1).toLowerCase();
              return { material: autoDisplayName(normMat(name), name), unidade: item.unidade };
            }),
            reason: variants.length + ' variantes entre parênteses'
          });
          return;
        }
      }

      // ═══ FASE 1: DETECTAR "/" — itens múltiplos na mesma linha ═══
      if (mat.includes('/')) {
        
        // ─── 1A: Parênteses com / → "SACO DE LIXO (15L/50L/100L)" ───
        const mParens = mat.match(/^(.+?)\s*\(([^)]*\/[^)]*)\)\s*$/);
        if (mParens) {
          const base = mParens[1].trim();
          const variants = mParens[2].split('/').map(v => v.trim()).filter(Boolean);
          if (variants.length >= 2) {
            issues.push({
              type: 'split', catIdx, itemIdx, original: rawMat, item,
              splits: variants.map(v => {
                const name = base + ' ' + v.toUpperCase();
                return { material: autoDisplayName(normMat(name), name), unidade: item.unidade };
              }),
              reason: variants.length + ' tipos entre parênteses'
            });
            return;
          }
        }
        
        // ─── 1B: Itens completos separados por / → "LEITE EM PÓ/LEITE LIQUIDO" ───
        // Ignora "/" que é preposição (P/, C/, S/, E/)
        const matNoPrep = mat.replace(/\b[PCSE]\/\s*/gi, match => match.replace('/', '∕'));
        const slashParts = matNoPrep.includes('/') 
          ? matNoPrep.split('/').map(p => p.replace('∕','/').trim()).filter(p => p.length >= 2)
          : [];
        if (slashParts.length >= 2) {
          // Verifica se cada parte parece um item completo (≥2 palavras ou existe no catálogo)
          const looksLikeFullItems = slashParts.every(p => {
            const words = p.split(/\s+/).filter(w => w.length > 1);
            return words.length >= 2 || MATERIAL_CATALOG[normMat(p)];
          });
          
          if (looksLikeFullItems) {
            // Cada parte é um item completo diferente
            issues.push({
              type: 'split', catIdx, itemIdx, original: rawMat, item,
              splits: slashParts.map(p => ({
                material: autoDisplayName(normMat(p), p), unidade: item.unidade
              })),
              reason: slashParts.length + ' itens diferentes na mesma linha'
            });
            return;
          }
          
          // Se não são itens completos, tenta BASE + variantes
          // Ex: "BISCOITO DOCE/SALGADO", "CLIPS 3/0" (não split - é formato de tamanho)
          if (slashParts.length === 2) {
            const p1 = slashParts[0], p2 = slashParts[1];
            const p1Words = p1.split(/\s+/);
            const p2Words = p2.split(/\s+/);
            
            // Se a parte 2 é curta (1 palavra) e parte 1 tem base, é variante
            if (p2Words.length === 1 && p1Words.length >= 2) {
              const base = p1Words.slice(0, -1).join(' ');
              const v1 = p1Words[p1Words.length - 1];
              const v2 = p2;
              // Não splitear se parecem ser formato numérico tipo "3/0"
              if (!/^\d+$/.test(v1) || !/^\d+$/.test(v2) || v1.length > 2) {
                const name1 = base + ' ' + v1.toUpperCase();
                const name2 = base + ' ' + v2.toUpperCase();
                issues.push({
                  type: 'split', catIdx, itemIdx, original: rawMat, item,
                  splits: [
                    { material: autoDisplayName(normMat(name1), name1), unidade: item.unidade },
                    { material: autoDisplayName(normMat(name2), name2), unidade: item.unidade }
                  ],
                  reason: '2 tipos separados por /'
                });
                return;
              }
            }
          }
          
          // 3+ variantes curtas: "SACO DE LIXO 15L/50L/100L"
          if (slashParts.length >= 3 || slashParts.some(p => /^\d/.test(p))) {
            // Tenta detectar base comum
            const firstWords = slashParts[0].split(/\s+/);
            if (firstWords.length >= 2) {
              const lastWord = firstWords[firstWords.length - 1];
              const base = firstWords.slice(0, -1).join(' ');
              const allVariants = [lastWord, ...slashParts.slice(1)];
              issues.push({
                type: 'split', catIdx, itemIdx, original: rawMat, item,
                splits: allVariants.map(v => {
                  const name = base + ' ' + v.trim().toUpperCase();
                  return { material: autoDisplayName(normMat(name), name), unidade: item.unidade };
                }),
                reason: allVariants.length + ' tamanhos/tipos separados por /'
              });
              return;
            }
          }
        }
      }

      // ═══ FASE 2: DETECTAR " E " — itens ou variantes separados por "E" ═══
      if (/\sE\s/i.test(mat)) {
        const eParts = mat.split(/\s+E\s+/i).map(p => p.trim()).filter(p => p.length >= 1);
        
        if (eParts.length === 2) {
          let p1 = eParts[0], p2 = eParts[1];
          
          // Remove "DE" no início da parte 2: "50L E DE 100L" → "50L" e "100L"
          p2 = p2.replace(/^DE\s+/i, '').trim();
          
          const p1Words = p1.split(/\s+/);
          const p2Words = p2.split(/\s+/);
          
          // Caso A: Dois itens completos → "LEITE EM PÓ E LEITE LIQUIDO"
          if (p1Words.length >= 2 && p2Words.length >= 2) {
            issues.push({
              type: 'split', catIdx, itemIdx, original: rawMat, item,
              splits: [p1, p2].map(p => ({
                material: autoDisplayName(normMat(p), p), unidade: item.unidade
              })),
              reason: '2 itens diferentes separados por "E"'
            });
            return;
          }
          
          // Caso B: Base + qualificadores → "CANETA AZUL E PRETA", "CLIPE N°6 E 5"
          if (p1Words.length >= 2 && p2Words.length <= 2) {
            const base = p1Words.slice(0, -1).join(' ');
            const v1 = p1Words[p1Words.length - 1];
            const v2 = p2;
            
            // Detecta padrão numérico: "N°6 E 5" → "N°6", "N°5"
            const numPrefix = v1.match(/^(N[°º.]?\s*)(\d+)$/i);
            if (numPrefix && /^\d+$/.test(v2)) {
              const name1 = base + ' ' + v1.toUpperCase();
              const name2 = base + ' ' + numPrefix[1].toUpperCase() + v2;
              issues.push({
                type: 'split', catIdx, itemIdx, original: rawMat, item,
                splits: [
                  { material: autoDisplayName(normMat(name1), name1), unidade: item.unidade },
                  { material: autoDisplayName(normMat(name2), name2), unidade: item.unidade }
                ],
                reason: '2 numerações no mesmo item'
              });
              return;
            }
            
            // Detecta padrão de tamanho: "50L E 100L" ou "50L E DE 100L"
            if (/\d+\s*[A-Za-z]*$/.test(v1) && /^\d+/.test(v2)) {
              const unitSuffix = v1.match(/[A-Za-z]+$/)?.[0] || '';
              const v2Full = /[A-Za-z]/.test(v2) ? v2 : v2 + unitSuffix;
              const name1 = base + ' ' + v1.toUpperCase();
              const name2 = base + ' ' + v2Full.toUpperCase();
              issues.push({
                type: 'split', catIdx, itemIdx, original: rawMat, item,
                splits: [
                  { material: autoDisplayName(normMat(name1), name1), unidade: item.unidade },
                  { material: autoDisplayName(normMat(name2), name2), unidade: item.unidade }
                ],
                reason: '2 tamanhos no mesmo item'
              });
              return;
            }
            
            const name1 = base + ' ' + v1.toUpperCase();
            const name2 = base + ' ' + v2.toUpperCase();
            issues.push({
              type: 'split', catIdx, itemIdx, original: rawMat, item,
              splits: [
                { material: autoDisplayName(normMat(name1), name1), unidade: item.unidade },
                { material: autoDisplayName(normMat(name2), name2), unidade: item.unidade }
              ],
              reason: '2 tipos/variações separados por "E"'
            });
            return;
          }
        }
      }

      // ═══ FASE 3: NORMALIZAÇÃO COMPLETA ═══
      // Limpa junk + corrige ortografia + singulariza + busca catálogo
      const step1 = cleanMaterialJunk(mat);        // Remove (URGENTE), aspas, traços
      const step2 = fixSpelling(step1);             // Corrige ortografia
      const step3 = singularizeMaterial(step2);     // Plural → singular
      const nk = normMat(step3);                    // Normaliza para chave
      const catalogName = MATERIAL_CATALOG[nk];     // Busca no catálogo
      const finalName = catalogName || step3;       // Catálogo ou nome corrigido
      
      // Se houve QUALQUER mudança, sugere correção
      if (finalName !== mat && rmAcc(finalName).toUpperCase() !== rmAcc(mat).toUpperCase().trim()) {
        const reasons = [];
        if (step1 !== mat) reasons.push('limpeza');
        if (step2 !== step1) reasons.push('ortografia');
        if (step3 !== step2) reasons.push('singular');
        if (catalogName) reasons.push('catálogo');
        
        issues.push({
          type: 'rename', catIdx, itemIdx, original: rawMat, item,
          suggested: finalName,
          reason: reasons.length ? '📝 ' + reasons.join(' + ') : 'Padronização do nome'
        });
      } else if (step1 !== mat) {
        // Apenas junk removal (caso acento/case seja igual mas tinha lixo)
        issues.push({
          type: 'rename', catIdx, itemIdx, original: rawMat, item,
          suggested: autoDisplayName(nk, step1),
          reason: 'Anotação desnecessária removida'
        });
      }
    });
  });
  return issues;
}

function applyItemFixes(parsed, fixes) {
  if (!fixes || !fixes.length) return parsed;
  
  // Aplica de trás para frente para não invalidar índices
  const sortedFixes = [...fixes].sort((a, b) => {
    if (a.catIdx !== b.catIdx) return b.catIdx - a.catIdx;
    return b.itemIdx - a.itemIdx;
  });
  
  let nextSplitId = Math.max(...parsed.categories.flatMap(c => c.items.map(i => i.id || 0))) + 100;
  
  sortedFixes.forEach(fix => {
    if (!fix.accepted) return;
    const cat = parsed.categories[fix.catIdx];
    if (!cat) return;
    const item = cat.items[fix.itemIdx];
    if (!item) return;
    
    if (fix.type === 'split') {
      // Remove o item original e insere os splits
      // IMPORTANTE: Não copiamos qtdSolicitada/qtdAtendida para os itens gerados.
      // A quantidade original pertence a UM item; ao dividir, o separador deve
      // preencher cada sub-item manualmente. Copiar triplicaria (ou mais) os valores.
      const baseUnid = item.unidade || '';
      const baseStatus = item.status || 'nao_atendido';
      
      cat.items.splice(fix.itemIdx, 1);
      fix.splits.forEach((sp, si) => {
        cat.items.splice(fix.itemIdx + si, 0, {
          id: nextSplitId++,
          material: sp.material,
          unidade: sp.unidade || baseUnid,
          qtdSolicitada: '',  // vazio: separador preenche cada sub-item
          qtdAtendida: '',
          status: 'nao_atendido',
          tipo: item.tipo,
          obs: si === 0 ? (item.obs || '') : ''
        });
      });
    } else if (fix.type === 'rename') {
      item.material = fix.suggested;
    }
  });
  
  return parsed;
}

function showPreRegDialog(issues, onConfirm) {
  // Splits: NÃO aceitos por padrão (usuário deve marcar explicitamente)
  // Renomeações: aceitas por padrão (são seguras e não multiplicam itens)
  issues.forEach(f => { f.accepted = f.type !== 'split'; });
  
  let h = '<div style="max-width:650px;margin:0 auto">';
  h += '<div style="text-align:center;margin-bottom:16px">'
    + '<div style="font-size:32px;margin-bottom:6px">🔍</div>'
    + '<h2 style="font-size:16px;font-weight:800;margin:0">Revisão antes de Registrar</h2>'
    + '<p style="font-size:12px;color:#64748b;margin-top:4px">O sistema detectou ' + issues.length + ' item(ns) que podem ser melhorados</p>'
    + '</div>';
  
  issues.forEach((fix, idx) => {
    const checkId = 'preRegFix_' + idx;
    
    if (fix.type === 'split') {
      h += '<div style="background:#f8fafc;border:1.5px solid #94a3b8;border-radius:10px;padding:12px;margin-bottom:10px">'
        + '<div style="display:flex;align-items:flex-start;gap:8px">'
        + '<input type="checkbox" id="' + checkId + '" onchange="this.closest(\'[data-fix]\').dataset.accepted=this.checked" style="margin-top:3px;flex-shrink:0">'
        + '<div style="flex:1" data-fix data-accepted="false">'
        + '<div style="font-size:10px;color:#475569;font-weight:700;margin-bottom:4px">✂️ SEPARAR ITEM <span style="font-weight:400;color:#94a3b8">(desmarcado por padrão — marque somente se necessário)</span></div>'
        + '<div style="font-size:11px;color:#64748b;margin-bottom:6px">' + esc(fix.reason) + '</div>'
        
        // Aviso de quantidade
        + '<div style="background:#fef3c7;border:1px solid #fcd34d;border-radius:6px;padding:5px 10px;margin-bottom:6px;font-size:11px;color:#92400e">'
        + '⚠️ <b>Atenção:</b> ao separar, as quantidades do item original <b>não são copiadas</b>. O separador deverá preencher cada sub-item manualmente.'
        + '</div>'
        
        // Antes
        + '<div style="background:#fee2e2;border:1px solid #fecaca;border-radius:6px;padding:6px 10px;margin-bottom:6px">'
        + '<span style="font-size:9px;color:#991b1b;font-weight:700">ANTES:</span> '
        + '<span style="font-size:12px;font-weight:700;color:#991b1b;text-decoration:line-through">' + esc(fix.original) + '</span>'
        + ' <span style="font-size:10px;color:#991b1b">(' + esc(fix.item.qtdSolicitada || '?') + ' ' + esc(fix.item.unidade || '') + ')</span>'
        + '</div>'
        
        // Depois
        + '<div style="background:#d1fae5;border:1px solid #a7f3d0;border-radius:6px;padding:6px 10px">'
        + '<span style="font-size:9px;color:#065f46;font-weight:700">DEPOIS:</span>';
      
      fix.splits.forEach((sp, si) => {
        h += '<div style="font-size:12px;font-weight:700;color:#065f46;margin-top:' + (si ? '3' : '2') + 'px">→ ' + esc(sp.material) + '</div>';
      });
      
      h += '</div></div></div></div>';
      
    } else if (fix.type === 'rename') {
      h += '<div style="background:#fefce8;border:1px solid #fde047;border-radius:10px;padding:12px;margin-bottom:10px">'
        + '<div style="display:flex;align-items:flex-start;gap:8px">'
        + '<input type="checkbox" id="' + checkId + '" checked onchange="this.closest(\'[data-fix]\').dataset.accepted=this.checked" style="margin-top:3px;flex-shrink:0">'
        + '<div style="flex:1" data-fix data-accepted="true">'
        + '<div style="font-size:10px;color:#92400e;font-weight:700;margin-bottom:4px">📝 PADRONIZAR NOME</div>'
        + '<div style="font-size:11px;color:#64748b;margin-bottom:4px">' + esc(fix.reason) + '</div>'
        + '<span style="font-size:12px;color:#991b1b;text-decoration:line-through">' + esc(fix.original) + '</span>'
        + ' → <span style="font-size:12px;font-weight:700;color:#065f46">' + esc(fix.suggested) + '</span>'
        + '</div></div></div>';
    }
  });
  
  h += '<div style="display:flex;gap:8px;justify-content:center;margin-top:16px">'
    + '<button class="btn btn-s" onclick="closePreRegDialog()">Cancelar</button>'
    + '<button class="btn btn-s" onclick="skipPreRegDialog()">Ignorar e Registrar</button>'
    + '<button class="btn btn-p" onclick="confirmPreRegDialog()">✅ Aplicar e Registrar</button>'
    + '</div></div>';
  
  // Usa o modal existente
  const modal = document.getElementById('fichaModal');
  const inner = modal.querySelector('.modal-inner');
  const toolbar = modal.querySelector('.modal-toolbar');
  const legend = document.getElementById('fichaModalLegend');
  const actions = document.getElementById('fichaModalActions');
  const body = document.getElementById('fichaBody');
  const stats = document.getElementById('fichaStats');
  
  if (toolbar) toolbar.querySelector('.title').textContent = '🔍 Revisão de Itens';
  if (stats) stats.innerHTML = '';
  if (actions) actions.style.display = 'none';
  if (legend) legend.style.display = 'none';
  body.innerHTML = '<div style="padding:20px">' + h + '</div>';
  modal.classList.add('open');
  
  // Store callback
  window._preRegIssues = issues;
  window._preRegCallback = onConfirm;
}

function closePreRegDialog() {
  document.getElementById('fichaModal').classList.remove('open');
  window._preRegIssues = null;
  window._preRegCallback = null;
}

function skipPreRegDialog() {
  document.getElementById('fichaModal').classList.remove('open');
  const cb = window._preRegCallback;
  window._preRegIssues = null;
  window._preRegCallback = null;
  if (cb) cb(false); // false = don't apply fixes
}

function confirmPreRegDialog() {
  const issues = window._preRegIssues || [];
  // Read checkbox states
  issues.forEach((fix, idx) => {
    const cb = document.getElementById('preRegFix_' + idx);
    fix.accepted = cb ? cb.checked : false;
  });
  document.getElementById('fichaModal').classList.remove('open');
  const cb = window._preRegCallback;
  window._preRegIssues = null;
  window._preRegCallback = null;
  if (cb) cb(true, issues); // true = apply fixes
}

// ═══════════════════════════════════════════════════════════════════
// CONFIRMAÇÃO DE UNIDADE — popup antes de registrar
// ═══════════════════════════════════════════════════════════════════
function showUnitConfirmDialog(unitName) {
  return new Promise((resolve) => {
    // Monta HTML do popup no modal existente
    const modal = document.getElementById('fichaModal');
    const toolbar = modal.querySelector('.modal-toolbar');
    const legend = document.getElementById('fichaModalLegend');
    const actions = document.getElementById('fichaModalActions');
    const body = document.getElementById('fichaBody');
    const stats = document.getElementById('fichaStats');
    if (!modal || !body) { resolve(true); return; }

    if (toolbar) toolbar.querySelector('.title').textContent = '✅ Confirmar Unidade';
    if (stats) stats.innerHTML = '';
    if (actions) actions.style.display = 'none';
    if (legend) legend.style.display = 'none';

    body.innerHTML = `
      <div style="padding:28px 20px;text-align:center;max-width:480px;margin:0 auto">
        <div style="font-size:44px;margin-bottom:12px">🏢</div>
        <h2 style="font-size:17px;font-weight:800;margin:0 0 8px">Confirmar Unidade</h2>
        <p style="font-size:13px;color:#64748b;margin:0 0 18px">A requisição será registrada para a seguinte unidade:</p>
        <div style="background:#eff6ff;border:2px solid #2563eb;border-radius:12px;padding:14px 18px;margin-bottom:24px">
          <div style="font-size:18px;font-weight:800;color:#1e40af">${esc(unitName)}</div>
        </div>
        <p style="font-size:13px;color:#64748b;margin:0 0 22px">Esta unidade está <b>correta</b>?</p>
        <div style="display:flex;gap:10px;justify-content:center">
          <button class="btn btn-s" style="min-width:120px;border-color:#ef4444;color:#ef4444"
            onclick="window.__unitConfirmResolve(false)">
            ✗ Não / Corrigir
          </button>
          <button class="btn btn-p" style="min-width:140px"
            onclick="window.__unitConfirmResolve(true)">
            ✓ Sim, registrar
          </button>
        </div>
      </div>`;

    window.__unitConfirmResolve = (result) => {
      modal.classList.remove('open');
      window.__unitConfirmResolve = null;
      resolve(result);
    };

    modal.classList.add('open');
  });
}

async function registrar(){
  if (!tmpParsed) { toast('Anexe uma planilha primeiro.', 'red'); return; }

  // ─── VALIDAÇÃO: UNIDADE OBRIGATÓRIA ───
  const uSel = document.getElementById('rU');
  const detectedUnit = normalizeUnit(tmpParsed.unitName) || tmpParsed.unitName;
  const finalUnit = uSel.value || (detectedUnit !== 'Desconhecida' ? detectedUnit : '');
  if (!finalUnit || finalUnit === 'Desconhecida' || finalUnit === 'Unidade') {
    toast('⚠️ Unidade não identificada. Selecione manualmente no campo "Unidade" antes de registrar.', 'red');
    uSel.focus();
    uSel.style.borderColor = '#ef4444';
    uSel.style.boxShadow = '0 0 0 3px rgba(239,68,68,.2)';
    setTimeout(() => { uSel.style.borderColor = ''; uSel.style.boxShadow = ''; }, 3000);
    return;
  }

  // ─── POPUP DE CONFIRMAÇÃO DE UNIDADE ───
  const continueWithUnit = await showUnitConfirmDialog(finalUnit);
  if (!continueWithUnit) return; // usuário clicou "Não / Corrigir"

  // ─── VALIDAÇÃO PRÉ-REGISTRO (itens) ───
  const issues = detectItemIssues(tmpParsed);
  if (issues.length > 0) {
    showPreRegDialog(issues, (apply, fixes) => {
      if (apply && fixes) {
        applyItemFixes(tmpParsed, fixes);
        toast(fixes.filter(f => f.accepted).length + ' correção(ões) aplicada(s).', 'green');
      }
      doRegistrar(finalUnit);
    });
    return;
  }

  doRegistrar(finalUnit);
}

async function doRegistrar(finalUnit){
  const uSel=document.getElementById('rU');
  const unidade = finalUnit || uSel.value || normalizeUnit(tmpParsed.unitName) || tmpParsed.unitName;
  const itemsMap={};tmpParsed.categories.forEach(c=>c.items.forEach(it=>{itemsMap[it.id]={...it}}));
  const parsedSafe = stripVolatileParsed(tmpParsed);
  const fy = new Date().getFullYear();
  const per = (tmpParsed && tmpParsed._rows) ? bestPeriod(tmpParsed._rows, tmpParsed.fileName) : parsePeriodFromFileName(tmpParsed.fileName);
  const fin = finalizePeriod(per, fy);
  const dtReq = fin?.ws ? new Date(fin.ws + 'T12:00:00') : new Date();
  const req={id:nextId++,unidade,tipos:tmpParsed.tipos,formato:tmpParsed.formato,
    resp:document.getElementById('rR').value||'Admin',
    obs:document.getElementById('rO').value,dt:dtReq,
    fileName:tmpParsed.fileName,parsed:parsedSafe,items:itemsMap,
    periodLabel: fin?.label || '',
    periodStart: fin?.ws || '',
    periodEnd: fin?.we || '',
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
  if (role === "admin") return ["req", "ps", "es", "pe", "hi", "rel", "db"].includes(tab);
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
  if(t==='ps') renderPS();
  else if(t==='es') renderES();
  else if(t==='pe') renderPE();
  else if(t==='hi') renderHI();
  else if(t==='rel') renderCorrecaoItens();
  else if(t==='db') renderRelatorio();
  else if(t==='bur') renderBuracos();
  else if(t==='unif') renderUnificar();
}

let _panSub = 'visao';

function switchMatView(view) {
  const vEntrega = document.getElementById('matViewEntrega');
  const vPainel = document.getElementById('matViewPainel');
  const bEntrega = document.getElementById('matTabEntrega');
  const bPainel = document.getElementById('matTabPainel');
  if (!vEntrega || !vPainel) return;
  if (view === 'painel') {
    vEntrega.style.display = 'none';
    vPainel.style.display = 'block';
    if (bEntrega) { bEntrega.style.background = 'transparent'; bEntrega.style.color = '#94a3b8'; }
    if (bPainel) { bPainel.style.background = '#1e40af'; bPainel.style.color = '#fff'; }
    buildPainel();
  } else {
    vEntrega.style.display = 'block';
    vPainel.style.display = 'none';
    if (bEntrega) { bEntrega.style.background = '#1e40af'; bEntrega.style.color = '#fff'; }
    if (bPainel) { bPainel.style.background = 'transparent'; bPainel.style.color = '#94a3b8'; }
  }
}

function switchPanSub(sub) {
  _panSub = sub;
  document.querySelectorAll('.pan-sub-tab').forEach(btn => {
    const active = btn.getAttribute('data-pansub') === sub;
    btn.style.background = active ? '#2563eb' : 'transparent';
    btn.style.color = active ? '#fff' : '#64748b';
  });
  buildPainel();
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
  let h='<div class="tbl-wrap"><table class="qt"><thead><tr><th>#</th><th>Unidade</th><th>Tipos</th><th>Requisitado por</th><th>Data</th><th>Itens</th><th>Ação</th></tr></thead><tbody>';
  pg.items.forEach((r,i)=>{const ni=Object.keys(r.items).length;const pos=offset+i;h+=`<tr class="${pos===0?'first-row':''}"><td style="text-align:center;font-weight:800;color:${pos===0?'var(--accent)':'#94a3b8'}">${pos+1}º</td><td style="font-weight:700">${esc(displayUnit(r.unidade))}</td><td>${tiposPills(r.tipos)}</td><td style="font-size:11px;color:#475569">${esc(r.resp||'')}</td><td style="font-size:11px">${fdt(r.dt)}</td><td><span class="pill pr">${ni} itens</span></td><td style="display:flex;gap:6px"><button class="btn btn-p btn-sm" onclick="pegarParaSeparar(${jsArg(r.id)})">📦 Pegar</button>${canCancel?`<button class="btn btn-s btn-sm" style="color:var(--red);border-color:#fca5a5" onclick="cancelarReq(${jsArg(r.id)})" title="Cancelar">🗑️</button>`:''}</td></tr>`});
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
  pg.items.forEach(r=>{const v=Object.values(r.items);h+=`<tr><td style="font-weight:700">${esc(displayUnit(r.unidade))}</td><td>${tiposPills(r.tipos)}</td><td>${esc(r.separador)}</td><td>${sumHTML(v)}</td><td style="display:flex;gap:6px"><button class="btn btn-p btn-sm" onclick="abrirFicha(${jsArg(r.id)})">📝 Editar</button><button class="btn btn-s btn-sm" onclick="printReq(${jsArg(r.id)})" title="Imprimir">🖨️</button><button type="button" class="btn btn-g btn-sm" onclick="marcarProntoLista(${jsArg(r.id)}, event)" title="Marcar Pronto">✅</button>${canCancel?`<button class="btn btn-s btn-sm" style="color:var(--red);border-color:#fca5a5" onclick="cancelarReq(${jsArg(r.id)})" title="Cancelar">🗑️</button>`:''}</td></tr>`});
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
  pg.items.forEach(r=>{const v=Object.values(r.items);h+=`<tr><td style="font-weight:700">${esc(displayUnit(r.unidade))}</td><td>${tiposPills(r.tipos)}</td><td>${esc(r.separador)}</td><td>${sumHTML(v)}</td><td style="display:flex;gap:6px"><button class="btn btn-s btn-sm" onclick="printReq(${jsArg(r.id)})" title="Imprimir">🖨️</button><button class="btn btn-r btn-sm" onclick="entregarReq(${jsArg(r.id)})">📦 Entregar</button><button class="btn btn-s btn-sm" onclick="voltarSeparacao(${jsArg(r.id)})" title="Voltar p/ Separação">↩️</button>${canCancel?`<button class="btn btn-s btn-sm" style="color:var(--red);border-color:#fca5a5" onclick="cancelarReq(${jsArg(r.id)})" title="Cancelar">🗑️</button>`:''}</td></tr>`});
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
  pg.items.forEach(r=>{const v=Object.values(r.items);h+=`<tr><td style="font-weight:700">${esc(displayUnit(r.unidade))}</td><td>${tiposPills(r.tipos)}</td><td>${esc(r.separador)}</td><td>${esc(r.retiradoPor)}</td><td style="font-size:11px">${fdt(r.dtEntrega||r.dt)}</td><td>${sumHTML(v)}</td><td style="display:flex;gap:6px;justify-content:flex-end"><button class="btn btn-s btn-sm" onclick="printReq(${jsArg(r.id)})" title="Reimprimir">🖨️</button>${isAdmin?`<button class="btn btn-s btn-sm" style="color:var(--red);border-color:#fca5a5" onclick="excluirHistoricoReq(${jsArg(r.id)})" title="Excluir do Histórico">🗑️</button>`:''}</td></tr>`});
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

function pegarParaSeparar(reqId){const f=reqId?REQS.find(r=>String(r.id)===String(reqId)&&r.status==='requisitado'):REQS.find(r=>r.status==='requisitado');if(!f)return;showModal('Nome do Separador','Quem vai separar?','',async nm=>{f.separador=nm;f.status='separando';markDirty(f);await persistReq(f);printReq(f.id);toast(displayUnit(f.unidade)+' → Em Separação','green');goTab('es')})}

function abrirFicha(id, readOnly = false){
  curId=id;const r=findReq(id);if(!r)return;
  document.getElementById('fichaTitle').textContent=(readOnly ? '👁️ ' : '📋 ') + displayUnit(r.unidade) + (r.separador ? ' — ' + r.separador : '');
  
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
      row.querySelector('.ficha-input-mat')?.addEventListener('change',function(){editMaterial(iid,this.value)});
    });
    // Botões de adicionar/remover item
    document.getElementById('fichaBody').querySelectorAll('[data-addcat]').forEach(btn=>{
      btn.addEventListener('click',function(){addFichaItem(this.getAttribute('data-addcat'))});
    });
    document.getElementById('fichaBody').querySelectorAll('[data-delitem]').forEach(btn=>{
      btn.addEventListener('click',function(){removeFichaItem(+this.getAttribute('data-delitem'))});
    });
  }
}
function fecharFicha(){
  // Se o popup de confirmação de unidade estiver ativo, resolve como "não" antes de fechar
  if (typeof window.__unitConfirmResolve === 'function') {
    const fn = window.__unitConfirmResolve;
    window.__unitConfirmResolve = null;
    fn(false);
    return;
  }
  document.getElementById('fichaModal').classList.remove('open');
  curId=null;
  renderAll();
}
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
  h+=`<div class="ficha-header"><div><h1>FICHA DE SEPARAÇÃO DE MATERIAIS</h1><div class="ficha-unit">${esc(displayUnit(r.unidade||d.unitName))}</div></div><div style="text-align:right;font-size:11px;color:#64748b">Pedido: <b>${pedido}</b><br>Entrega: <b>${entrega}</b>${perLbl?`<br><span style="font-size:10px;color:#64748b">📅 ${perLbl}</span>`:''}${reqId?`<br><span style="font-size:10px;color:#64748b">ID: <b>${reqId}</b></span>`:''}<br><span style="font-size:9px;color:#94a3b8">${esc(d.fileName||'')}</span></div></div>`;
  const sep = esc(r.separador||'');
  const ent = esc(r.entreguePor||'');
  const ret = esc(r.retiradoPor||'');
  const reqPor = esc(r.resp||'');
  h+=`<div class="ficha-info-bar">${reqPor?`<span><b>Requisitado por:</b> ${reqPor}</span><span style="color:#64748b">|</span>`:''}<span><b>Separador:</b> ${sep}</span>${ent?`<span style="color:#64748b">|</span><span><b>Entregue por:</b> ${ent}</span>`:''}${ret?`<span style="color:#64748b">|</span><span><b>Retirado por:</b> ${ret}</span>`:''}<span style="color:#64748b">|</span><span><b>Tipos:</b> ${tiposPills(r.tipos)}</span></div>`;
  d.categories.forEach((cat,catIdx)=>{
    let catItems = cat.items.map(x => items[x.id]).filter(m => !!m);
    if(isPrint && r.status === 'separando') {
      catItems = catItems.filter(m => m.status !== 'sem_estoque' && m.status !== 'nao_atendido');
    }
    if(catItems.length === 0) return; // skip empty categories
    
    h+=`<div class="ficha-cat">${esc(cat.name)}</div><table class="ficha-table"><thead><tr><th class="col-num">#</th><th class="col-mat">Material</th><th class="col-unid">Unid.</th><th class="col-sol">Solicit.</th><th class="col-ate">Qtd. Atendida</th><th class="col-status">Status</th><th class="col-obs">${isPrint?'Obs':'Obs / Ações'}</th></tr></thead><tbody>`;
    catItems.forEach((m,i)=>{
      const originalId = Object.keys(items).find(key => items[key] === m);
      if(isPrint){
        h+=`<tr class="${rc2(m.status)}" data-id="${originalId}"><td class="col-num" style="color:#94a3b8;font-weight:600;font-size:10px">${i+1}</td><td class="col-mat" style="font-weight:600">${esc(m.material)}</td><td class="col-unid" style="color:#64748b;font-size:10px">${esc(m.unidade)}</td><td class="col-sol" style="font-weight:700;color:#1e40af">${esc(m.qtdSolicitada)}</td>`;
        const qaDisplay=m.qtdAtendida?esc(m.qtdAtendida):'<span style="display:inline-block;width:90%;border-bottom:1px dotted #94a3b8;min-height:14px">&nbsp;</span>';
        h+=`<td class="col-ate" style="font-weight:700">${qaDisplay}</td><td class="col-status" style="overflow:visible"><span class="${bc2(m.status)}" style="cursor:default;display:inline-block;max-width:100%;white-space:normal;line-height:1.05">${sl(m.status)}</span></td><td class="col-obs" style="font-size:10px;color:#475569">${esc(m.obs||'')}</td>`;
      } else {
        h+=`<tr class="${rc2(m.status)}" data-id="${originalId}"><td class="col-num" style="color:#94a3b8;font-weight:600;font-size:10px">${i+1}</td><td class="col-mat" style="padding:2px 4px"><input class="ficha-input-mat" value="${esc(m.material)}" style="width:100%;border:1px solid #e2e8f0;border-radius:3px;padding:3px 5px;font-family:inherit;font-size:11px;font-weight:600"></td><td class="col-unid" style="color:#64748b;font-size:10px">${esc(m.unidade)}</td><td class="col-sol" style="font-weight:700;color:#1e40af">${esc(m.qtdSolicitada)}</td>`;
        h+=`<td class="col-ate" style="padding:2px 4px"><input class="ficha-input-qty${m.status==='sem_estoque'?' no-stock':''}" value="${esc(m.qtdAtendida)}" placeholder="—"></td><td class="col-status" style="padding:2px;overflow:visible"><span class="${bc2(m.status)}" style="display:inline-block;max-width:100%;white-space:normal;line-height:1.05">${sl(m.status)}</span></td><td class="col-obs" style="padding:2px 4px"><div style="display:flex;gap:3px;align-items:center"><input class="ficha-input-obs" value="${esc(m.obs)}" placeholder="Obs..." style="flex:1"><button data-delitem="${originalId}" title="Remover item" style="background:none;border:none;color:#ef4444;cursor:pointer;font-size:14px;padding:0 2px;flex-shrink:0">✕</button></div></td>`;
      }
      h+=`</tr>`;
    });
    h+=`</tbody></table>`;
    // Botão adicionar item (só no modo edição)
    if(!isPrint){
      h+=`<div style="text-align:right;margin-top:4px;margin-bottom:8px"><button data-addcat="${catIdx}" style="font-size:10px;color:var(--accent);background:none;border:1px dashed var(--border);border-radius:4px;padding:3px 10px;cursor:pointer;font-family:inherit">+ Adicionar item nesta categoria</button></div>`;
    }
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
function editMaterial(id,v){const r=findReq(curId);if(r&&r.items[id]){r.items[id].material=v;markDirty(r);debouncedPersistCurrent();}}
function addFichaItem(catIdxStr){
  const r=findReq(curId);if(!r)return;
  const catIdx=parseInt(catIdxStr);
  const d=r.parsed;if(!d||!d.categories||!d.categories[catIdx])return;
  const maxId=Math.max(0,...Object.keys(r.items).map(Number).filter(Number.isFinite));
  const newId=maxId+1;
  const catName=d.categories[catIdx].name||'Outros';
  d.categories[catIdx].items.push({id:newId, material:'Novo Item'});
  r.items[newId]={id:newId,material:'Novo Item',unidade:'',qtdSolicitada:'1',qtdAtendida:'',status:'nao_atendido',tipo:detectTipo(catName),obs:''};
  markDirty(r);
  abrirFicha(curId, false);
  toast('Item adicionado. Edite o nome e a quantidade.','green');
}
function removeFichaItem(id){
  const r=findReq(curId);if(!r)return;
  if(!r.items[id])return;
  if(!confirm('Remover "'+r.items[id].material+'" da lista?'))return;
  delete r.items[id];
  if(r.parsed&&r.parsed.categories){
    r.parsed.categories.forEach(c=>{
      c.items=(c.items||[]).filter(it=>it.id!==id);
    });
  }
  markDirty(r);
  abrirFicha(curId, false);
  toast('Item removido.','red');
}
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
  r.dtPronto=new Date();
  markDirty(r);
  persistReq(r);
  curId=null;
  document.getElementById('fichaModal').classList.remove('open');
  toast(displayUnit(r.unidade)+' → Pronto!','green');
  goTab('pe');
}
function marcarProntoLista(id, e){
  if(e && e.preventDefault) e.preventDefault();
  if(e && e.stopPropagation) e.stopPropagation();
  const r=findReq(id);if(!r)return;
  if(!confirm('Tem certeza que deseja marcar como Pronto?')) return;
  r.status='pronto';r.dtPronto=new Date();markDirty(r);persistReq(r);toast(displayUnit(r.unidade)+' → Pronto!','green');renderAll();
}
function voltarSeparacao(id){const r=findReq(id);if(!r)return;r.status='separando';markDirty(r);persistReq(r);toast(displayUnit(r.unidade)+' ↩️ Voltou para Separação','green');goTab('es')}

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
      toast(displayUnit(r2.unidade)+' entregue para '+nm+' · '+nItens+' itens → banco | '+nZero+' sem atendimento','green');
      
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
let MAT_ALIASES={};
let CAT_ALIASES={};
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
    // Carregar aliases de materiais
    try { await loadMatAliases(); } catch(e) { console.warn('Erro ao carregar matAliases:', e); }
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

// ═══════════════════════════════════════════════════════════════════
// CATÁLOGO DE MATERIAIS PADRÃO DO ALMOXARIFADO
// Chave = normMat key (sem acento, MAIÚSCULO), Valor = nome canônico com acentos
// ═══════════════════════════════════════════════════════════════════
const MATERIAL_CATALOG = {
  // ─── EXPEDIENTE ────────────────────────────
  'RESMA DE PAPEL A4':'RESMA DE PAPEL A4','RESMA PAPEL CHAMEX A4':'RESMA DE PAPEL A4','RESMA PAPEL CHAMEX':'RESMA DE PAPEL A4',
  'RESMA DE CHAMEX':'RESMA DE PAPEL A4','CHAMEX':'RESMA DE PAPEL A4','PAPEL A4':'RESMA DE PAPEL A4',
  'CANETA AZUL':'CANETA AZUL','CANETAS AZUIS':'CANETA AZUL','CANETA PRETA':'CANETA PRETA','CANETAS PRETAS':'CANETA PRETA',
  'CANETA VERMELHA':'CANETA VERMELHA','CANETAS':'CANETA','LAPIS':'LÁPIS','LAPIS GRAFITE':'LÁPIS GRAFITE',
  'LAPIS DE COR':'LÁPIS DE COR','BORRACHA':'BORRACHA','APONTADOR':'APONTADOR',
  'COLA BRANCA':'COLA BRANCA','COLA DE ISOPOR':'COLA DE ISOPOR','COLA BASTAO':'COLA BASTÃO','COLA EM BASTAO':'COLA BASTÃO',
  'FITA DUREX':'FITA DUREX','FITA GOMADA':'FITA GOMADA','FITA ADESIVA':'FITA ADESIVA','FITA CREPE':'FITA CREPE',
  'CLIPS':'CLIPS','CLIPS PEQUENO':'CLIPS PEQUENO','CLIPS MEDIO':'CLIPS MÉDIO','CLIPS GRANDE':'CLIPS GRANDE',
  'GRAMPEADOR':'GRAMPEADOR','GRAMPOS':'GRAMPOS','GRAMPO TRILHO':'GRAMPO TRILHO',
  'PERFURADOR':'PERFURADOR','TESOURA':'TESOURA','ESTILETE':'ESTILETE','REGUA':'RÉGUA',
  'CADERNO PEQUENO':'CADERNO PEQUENO','CADERNO GRANDE':'CADERNO GRANDE','CADERNO UNIVERSITARIO':'CADERNO UNIVERSITÁRIO',
  'PASTA AZ':'PASTA AZ','PASTA A - Z':'PASTA AZ','PASTA PARA ARQUIVO':'PASTA AZ','PASTA ARQUIVO':'PASTA AZ',
  'PASTA COM ELASTICO':'PASTA COM ELÁSTICO','PASTA C/ELASTICO':'PASTA COM ELÁSTICO','PASTA POLIONDA C/ELASTICO':'PASTA POLIONDA COM ELÁSTICO',
  'PASTA SANFONADA':'PASTA SANFONADA','PASTA SANFONADA A4':'PASTA SANFONADA A4','PASTA PLASTICA SAFONADA':'PASTA SANFONADA',
  'PASTA SUSPENSA':'PASTA SUSPENSA','PASTA POLIONDA':'PASTA POLIONDA','PASTA FINA':'PASTA FINA','PASTA GROSSA':'PASTA GROSSA',
  'PASTA ESCARCELA':'PASTA ESCARCELA','PASTA DE DOCUMENTOS':'PASTA DE DOCUMENTOS',
  'ENVELOPE A4':'ENVELOPE A4','ENVELOPES A4':'ENVELOPE A4','ENVELOPES DOS GRANDES':'ENVELOPE GRANDE',
  'ESCARCELAS':'ESCARCELA','ESCARCELAS (GROSSA E FINA)':'ESCARCELA',
  'EXTRATOR DE GRAMPOS':'EXTRATOR DE GRAMPOS','MARCA TEXTO':'MARCA-TEXTO','PINCEL ATOMICO':'PINCEL ATÔMICO',
  'BLOCO DE NOTAS':'BLOCO DE NOTAS','BLOCO ADESIVO':'BLOCO ADESIVO','POST IT':'POST-IT','POST-IT':'POST-IT',
  'PRANCHETA':'PRANCHETA','LIVRO ATA':'LIVRO ATA','LIVRO PROTOCOLO':'LIVRO PROTOCOLO',
  'CARTUCHO':'CARTUCHO','TONER':'TONER','CARTOLINA':'CARTOLINA','PAPEL CARTAO':'PAPEL CARTÃO',
  'TNT':'TNT','EVA':'EVA','PAPEL CREPOM':'PAPEL CREPOM','PAPEL SEDA':'PAPEL SEDA',
  'BARBANTE':'BARBANTE','PINCEL':'PINCEL','TINTA GUACHE':'TINTA GUACHE',
  
  // ─── LIMPEZA ───────────────────────────────
  'AGUA SANITARIA':'ÁGUA SANITÁRIA','DESINFETANTE':'DESINFETANTE','DETERGENTE':'DETERGENTE',
  'SABAO EM PO':'SABÃO EM PÓ','SABAO EM BARRA':'SABÃO EM BARRA','SABAO LIQUIDO':'SABÃO LÍQUIDO',
  'ALCOOL EM GEL':'ÁLCOOL EM GEL','ALCOOL GEL':'ÁLCOOL EM GEL','ALCOOL LIQUIDO':'ÁLCOOL LÍQUIDO',
  'ALCOOL':'ÁLCOOL','ALCOOL (GEL OU LIQUIDO)':'ÁLCOOL (GEL OU LÍQUIDO)',
  'ESPONJA':'ESPONJA','ESPONJA DE LOUÇA':'ESPONJA DE LOUÇA','ESPONJA DE LAVAR':'ESPONJA DE LAVAR',
  'VASSOURA':'VASSOURA','RODO':'RODO','ESCOVAO':'ESCOVÃO','BALDE':'BALDE','BALDES':'BALDE',
  'BALDES P/LIMPEZA':'BALDE','PANO DE CHAO':'PANO DE CHÃO','PANO DE PRATO':'PANO DE PRATO',
  'PANO MULTIUSO':'PANO MULTIUSO','FLANELA':'FLANELA',
  'PALHA DE ACO':'PALHA DE AÇO','LUVA':'LUVA','LUVA DE BORRACHA':'LUVA DE BORRACHA',
  'SACO DE LIXO':'SACO DE LIXO','SACO DE LIXO GRANDE':'SACO DE LIXO GRANDE','SACO DE LIXO PEQUENO':'SACO DE LIXO PEQUENO',
  'SACO PARA LIXO':'SACO DE LIXO','SACO PARA LIXO 50L':'SACO DE LIXO 50L','SACO PARA LIXO 100L':'SACO DE LIXO 100L',
  'SACO PARA LIXO 50 L':'SACO DE LIXO 50L',
  'CESTO DE LIXO':'CESTO DE LIXO','CESTO PARA LIXO':'CESTO DE LIXO','CESTO DE LIXO GRANDE':'CESTO DE LIXO GRANDE',
  'CESTO PARA LIXO PEQUENO':'CESTO DE LIXO PEQUENO','CESTO DE LIXO COM TAMPA':'CESTO DE LIXO COM TAMPA',
  'MULTIUSO':'MULTIUSO','LIMPADOR MULTIUSO':'LIMPADOR MULTIUSO',
  'BOM AR':'BOM AR','SPLAY BOM AR':'BOM AR','BAYGON':'BAYGON','INSETICIDA':'INSETICIDA',
  
  // ─── HIGIENE PESSOAL ───────────────────────
  'PAPEL HIGIENICO':'PAPEL HIGIÊNICO','PAPEL TOALHA':'PAPEL TOALHA','PORTA PAPEL TOALHA':'PORTA PAPEL TOALHA',
  'SABONETE':'SABONETE','SABONETE LIQUIDO':'SABONETE LÍQUIDO',
  'MASCARA DESCARTAVEL':'MÁSCARA DESCARTÁVEL','TOALHA DE ROSTO':'TOALHA DE ROSTO','TOALHA DE BANHO':'TOALHA DE BANHO',
  'ABSORVENTE':'ABSORVENTE','FRALDA':'FRALDA','ESCOVA DENTAL':'ESCOVA DENTAL','CREME DENTAL':'CREME DENTAL',
  'SHAMPOO':'SHAMPOO','CONDICIONADOR':'CONDICIONADOR','DESODORANTE':'DESODORANTE',
  
  // ─── DESCARTÁVEL ───────────────────────────
  'COPO DESCARTAVEL PARA AGUA':'COPO DESCARTÁVEL PARA ÁGUA',
  'COPO DESCARTAVEL P/ AGUA':'COPO DESCARTÁVEL PARA ÁGUA',
  'COPO DESCARTAVEL P/AGUA':'COPO DESCARTÁVEL PARA ÁGUA',
  'COPO DESCARTAVEL DE AGUA':'COPO DESCARTÁVEL PARA ÁGUA',
  'COPO DESCARTAVEL -AGUA':'COPO DESCARTÁVEL PARA ÁGUA',
  'COPO DESCARTAVEL - AGUA':'COPO DESCARTÁVEL PARA ÁGUA',
  'COPO DESCARTAVEL ( PARA AGUA)':'COPO DESCARTÁVEL PARA ÁGUA',
  'COPO DESCARTAVEL DE AGUA ( URGENTE)':'COPO DESCARTÁVEL PARA ÁGUA',
  'COPOS DE AGUA':'COPO DESCARTÁVEL PARA ÁGUA','COPOS PARA AGUA':'COPO DESCARTÁVEL PARA ÁGUA',
  'COPO DESCARTAVEL PARA CAFE':'COPO DESCARTÁVEL PARA CAFÉ',
  'COPO DESCARTAVEL P/ CAFE':'COPO DESCARTÁVEL PARA CAFÉ',
  'COPO DESCARTAVEL P/CAFE':'COPO DESCARTÁVEL PARA CAFÉ',
  'COPO DESCARTAVEL - CAFE':'COPO DESCARTÁVEL PARA CAFÉ',
  'COPO DESCARTAVEL- CAFE':'COPO DESCARTÁVEL PARA CAFÉ',
  'COPOS PARA CAFE':'COPO DESCARTÁVEL PARA CAFÉ','COPO DE CAFE':'COPO DESCARTÁVEL PARA CAFÉ',
  'COPO DESCARTAVEL':'COPO DESCARTÁVEL',
  'GUARDANAPO':'GUARDANAPO','PRATO DESCARTAVEL':'PRATO DESCARTÁVEL',
  'COLHER DESCARTAVEL':'COLHER DESCARTÁVEL','GARFO DESCARTAVEL':'GARFO DESCARTÁVEL',
  'SACOLA PLASTICA':'SACOLA PLÁSTICA',
  
  // ─── ALIMENTÍCIO ───────────────────────────
  'CAFE':'CAFÉ','ACUCAR':'AÇÚCAR','LEITE EM PO':'LEITE EM PÓ','LEITE EM PO INTEGRAL':'LEITE EM PÓ INTEGRAL',
  'LEITE':'LEITE','LEITE LIQUIDO':'LEITE LÍQUIDO','LEITE LIQUIDO INTEGRAL':'LEITE LÍQUIDO INTEGRAL',
  'LEITE CONDENSADO':'LEITE CONDENSADO','CREME DE LEITE':'CREME DE LEITE',
  'MARGARINA':'MARGARINA','MANTEIGA':'MANTEIGA','OLEO':'ÓLEO','OLEO DE SOJA':'ÓLEO DE SOJA',
  'ARROZ':'ARROZ','FEIJAO':'FEIJÃO','MACARRAO':'MACARRÃO','FARINHA':'FARINHA','FARINHA DE TRIGO':'FARINHA DE TRIGO',
  'SAL':'SAL','VINAGRE':'VINAGRE','EXTRATO DE TOMATE':'EXTRATO DE TOMATE','TEMPERO':'TEMPERO',
  'BISCOITO':'BISCOITO','BISCOITO DOCE':'BISCOITO DOCE','BISCOITO SALGADO':'BISCOITO SALGADO',
  'BISCOITO AGUA E SAL':'BISCOITO ÁGUA E SAL','BISCOITO DOCE/SALGADO':'BISCOITO DOCE E SALGADO',
  'FLOCAO':'FLOCÃO','MILHO DE PIPOCA':'MILHO DE PIPOCA','AVEIA':'AVEIA','TAPIOCA':'TAPIOCA',
  'FECULA DE MANDIOCA':'FÉCULA DE MANDIOCA','CREMOGEMA':'CREMOGEMA','MUCILON':'MUCILON',
  'COLORAU':'COLORAU','CORANTE':'CORANTE',
  
  // ─── EQUIPAMENTOS ──────────────────────────
  'GARRAFA TERMICA':'GARRAFA TÉRMICA','GARRAFA TERMICA CAFE':'GARRAFA TÉRMICA DE CAFÉ',
  'GARRAFA TERMICA DE CAFE':'GARRAFA TÉRMICA DE CAFÉ',
  'JARRA':'JARRA','JARRA DE AGUA':'JARRA DE ÁGUA','BULE':'BULE','BULE DE CAFE':'BULE DE CAFÉ',
  'VENTILADOR':'VENTILADOR','PILHA':'PILHA','PILHA AA':'PILHA AA','PILHA AAA':'PILHA AAA',
  'BATERIA':'BATERIA','LAMPADA':'LÂMPADA','LAMPADA LED':'LÂMPADA LED','EXTENSAO':'EXTENSÃO',
  'REGUA DE TOMADA':'RÉGUA DE TOMADA','ADAPTADOR':'ADAPTADOR',
  
  // ─── EXPEDIENTE — EXPANSÃO ─────────────────
  'CANETA GEL':'CANETA GEL','CANETA HIDROGRAFICA':'CANETA HIDROGRÁFICA','HIDROCOR':'HIDROCOR',
  'GIZ DE CERA':'GIZ DE CERA','GIZ':'GIZ','CADERNO':'CADERNO',
  'BLOCO DE RECADO':'BLOCO DE RECADO','CARIMBO':'CARIMBO','ALMOFADA DE CARIMBO':'ALMOFADA DE CARIMBO',
  'TINTA CARIMBO':'TINTA PARA CARIMBO','CALCULADORA':'CALCULADORA',
  'AGENDA':'AGENDA','CALENDARIO':'CALENDÁRIO','PORTA LAPIS':'PORTA-LÁPIS','PORTA CANETA':'PORTA-CANETAS',
  'ESCANINHO':'ESCANINHO','CAIXA ORGANIZADORA':'CAIXA ORGANIZADORA','CAIXA ARQUIVO':'CAIXA ARQUIVO',
  'CAIXA ARQUIVO MORTO':'CAIXA ARQUIVO MORTO',
  'ELASTICO':'ELÁSTICO','ELASTICO DE DINHEIRO':'ELÁSTICO','COLA QUENTE':'COLA QUENTE',
  'COLA INSTANTANEA':'COLA INSTANTÂNEA','SUPER BONDER':'SUPER BONDER',
  'FITA DUPLA FACE':'FITA DUPLA FACE','FITA ISOLANTE':'FITA ISOLANTE','FITA LARGA':'FITA LARGA',
  'FITA TRANSPARENTE':'FITA TRANSPARENTE','DUREX':'FITA DUREX',
  'PASTA L':'PASTA L','PASTA CATALOGO':'PASTA CATÁLOGO','PASTA REGISTRADORA':'PASTA REGISTRADORA',
  'PLASTICO BOLHA':'PLÁSTICO BOLHA','SACO PLASTICO':'SACO PLÁSTICO','SACOLA':'SACOLA',
  'PAPEL ALMACO':'PAPEL ALMAÇO','PAPEL MILIMETRADO':'PAPEL MILIMETRADO',
  'PAPEL CAMURCA':'PAPEL CAMURÇA','PAPEL LAMINADO':'PAPEL LAMINADO','PAPEL ADESIVO':'PAPEL ADESIVO',
  'PAPEL CONTACT':'PAPEL CONTACT','PAPEL KRAFT':'PAPEL KRAFT','PAPEL PARAFINADO':'PAPEL PARAFINADO',
  'PAPEL MADEIRA':'PAPEL MADEIRA','PAPEL 40KG':'PAPEL 40KG','PAPEL 80G':'PAPEL 80G',
  'CORRETIVO':'CORRETIVO','CORRETIVO LIQUIDO':'CORRETIVO LÍQUIDO','CORRETIVO FITA':'CORRETIVO EM FITA',
  'LIVRO CAIXA':'LIVRO CAIXA','LIVRO PONTO':'LIVRO PONTO',
  'CRACHA':'CRACHÁ','PORTA CRACHA':'PORTA-CRACHÁ','CORDAO':'CORDÃO','CORDAO CRACHA':'CORDÃO DE CRACHÁ',
  'ETIQUETA':'ETIQUETA','ETIQUETA ADESIVA':'ETIQUETA ADESIVA','ETIQUETA A4':'ETIQUETA A4',
  'IMPRESSOR':'IMPRESSORA','IMPRESSORA':'IMPRESSORA','TINTA PARA IMPRESSORA':'TINTA PARA IMPRESSORA',
  'CARTUCHO TINTA':'CARTUCHO DE TINTA','CARTUCHO PRETO':'CARTUCHO PRETO','CARTUCHO COLORIDO':'CARTUCHO COLORIDO',
  'TONER PRETO':'TONER PRETO','TONER COLORIDO':'TONER COLORIDO',
  'PAPEL FOTOGRAFICO':'PAPEL FOTOGRÁFICO','PAPEL TERMICO':'PAPEL TÉRMICO','BOBINA':'BOBINA',
  'BOBINA TERMICA':'BOBINA TÉRMICA','BOBINA DE CAIXA':'BOBINA DE CAIXA',
  
  // ─── LIMPEZA — EXPANSÃO ────────────────────
  'CLORO':'CLORO','AMONIACA':'AMONÍACA','SODA CAUSTICA':'SODA CÁUSTICA','AMACIANTE':'AMACIANTE',
  'LUSTRA MOVEIS':'LUSTRA-MÓVEIS','PINHO':'PINHO','PINHO SOL':'PINHO SOL','VEJA':'VEJA',
  'LIMPA VIDRO':'LIMPA-VIDRO','LIMPADOR VIDRO':'LIMPA-VIDRO','LIMPADOR COZINHA':'LIMPADOR DE COZINHA',
  'LIMPADOR BANHEIRO':'LIMPADOR DE BANHEIRO','LIMPA ALUMINIO':'LIMPA-ALUMÍNIO','LIMPA INOX':'LIMPA-INOX',
  'REMOVEDOR':'REMOVEDOR','TIRA MANCHA':'TIRA-MANCHAS','SAPOLIO':'SAPÓLIO',
  'ESCOVA':'ESCOVA','ESCOVA DE LAVAR':'ESCOVA DE LAVAR','ESCOVA SANITARIA':'ESCOVA SANITÁRIA',
  'ESCOVA VASO':'ESCOVA SANITÁRIA','ESCOVA ROUPA':'ESCOVA DE ROUPA',
  'ESFREGAO':'ESFREGÃO','MOP':'MOP','MOP PO':'MOP PÓ','MOP UMIDO':'MOP ÚMIDO',
  'VASSOURA PLASTICA':'VASSOURA PLÁSTICA','VASSOURA PIACAVA':'VASSOURA DE PIAÇAVA','VASSOURAO':'VASSOURÃO',
  'VASSOURA BANHEIRO':'VASSOURA DE BANHEIRO','RODO PEQUENO':'RODO PEQUENO','RODO GRANDE':'RODO GRANDE',
  'RODINHO':'RODINHO','PA DE LIXO':'PÁ DE LIXO','PA':'PÁ','PAR DE LUVA':'PAR DE LUVAS',
  'LUVA LATEX':'LUVA DE LÁTEX','LUVA NITRILICA':'LUVA NITRÍLICA','LUVA PVC':'LUVA DE PVC',
  'LUVA DESCARTAVEL':'LUVA DESCARTÁVEL','MASCARA CIRURGICA':'MÁSCARA CIRÚRGICA',
  'TOUCA':'TOUCA','AVENTAL':'AVENTAL','BOTA':'BOTA','BOTA DE BORRACHA':'BOTA DE BORRACHA',
  'PREGADOR DE ROUPA':'PREGADOR DE ROUPA','VARAL':'VARAL','CABIDE':'CABIDE',
  
  // ─── DESCARTÁVEL — EXPANSÃO ────────────────
  // Copos por ML removidos — padronização única: água ou café
  'MARMITEX':'MARMITEX','MARMITA':'MARMITA','EMBALAGEM':'EMBALAGEM',
  'BANDEJA DESCARTAVEL':'BANDEJA DESCARTÁVEL','PRATO RASO':'PRATO RASO','PRATO FUNDO':'PRATO FUNDO',
  'POTE':'POTE','POTE PLASTICO':'POTE PLÁSTICO','POTE COM TAMPA':'POTE COM TAMPA',
  'ROLO PAPEL ALUMINIO':'PAPEL ALUMÍNIO','PAPEL ALUMINIO':'PAPEL ALUMÍNIO','FILME PVC':'FILME PVC',
  'PAPEL MANTEIGA':'PAPEL MANTEIGA','FORMA DESCARTAVEL':'FORMA DESCARTÁVEL',
  'PALITO':'PALITO','PALITO DE DENTE':'PALITO DE DENTE','PALITO CHURRASCO':'PALITO DE CHURRASCO',
  'CANUDO':'CANUDO','CANUDO DESCARTAVEL':'CANUDO DESCARTÁVEL','MEXEDOR':'MEXEDOR',
  'TALHER DESCARTAVEL':'TALHER DESCARTÁVEL','KIT TALHER':'KIT TALHER',
  
  // ─── HIGIENE — EXPANSÃO ────────────────────
  'ALGODAO':'ALGODÃO','COTONETE':'COTONETE','LENCO UMEDECIDO':'LENÇO UMEDECIDO',
  'LENCO DE PAPEL':'LENÇO DE PAPEL','FRALDA GERIATRICA':'FRALDA GERIÁTRICA','FRALDA INFANTIL':'FRALDA INFANTIL',
  'FRALDA DESCARTAVEL':'FRALDA DESCARTÁVEL','ABSORVENTE NOTURNO':'ABSORVENTE NOTURNO',
  'ABSORVENTE COM ABAS':'ABSORVENTE COM ABAS','PROTETOR DIARIO':'PROTETOR DIÁRIO',
  'SABONETE BARRA':'SABONETE EM BARRA','SABONETE LIQUIDO':'SABONETE LÍQUIDO',
  'SABONETE ANTIBACTERIANO':'SABONETE ANTIBACTERIANO','SABONETE NEUTRO':'SABONETE NEUTRO',
  'SHAMPOO INFANTIL':'SHAMPOO INFANTIL','SABONETE INFANTIL':'SABONETE INFANTIL',
  'CONDICIONADOR INFANTIL':'CONDICIONADOR INFANTIL','COLONIA':'COLÔNIA','COLONIA INFANTIL':'COLÔNIA INFANTIL',
  'HIDRATANTE':'HIDRATANTE','CREME HIDRATANTE':'CREME HIDRATANTE','TALCO':'TALCO',
  'ENXAGUANTE BUCAL':'ENXAGUANTE BUCAL','FIO DENTAL':'FIO DENTAL','PASTA DE DENTE':'PASTA DE DENTE',
  'ESPONJA DE BANHO':'ESPONJA DE BANHO','BUCHA DE BANHO':'BUCHA DE BANHO',
  'SACO DE FRALDAS':'SACO DE FRALDAS','PROTETOR SOLAR':'PROTETOR SOLAR','REPELENTE':'REPELENTE',
  'POMADA':'POMADA','CURATIVO':'CURATIVO','BAND AID':'BAND-AID','GAZE':'GAZE',
  'ESPARADRAPO':'ESPARADRAPO','ATADURA':'ATADURA',
  
  // ─── ALIMENTÍCIO — EXPANSÃO ────────────────
  'ARROZ BRANCO':'ARROZ BRANCO','ARROZ INTEGRAL':'ARROZ INTEGRAL','ARROZ PARBOILIZADO':'ARROZ PARBOILIZADO',
  'FEIJAO CARIOCA':'FEIJÃO CARIOCA','FEIJAO PRETO':'FEIJÃO PRETO','FEIJAO BRANCO':'FEIJÃO BRANCO',
  'FEIJAO VERDE':'FEIJÃO VERDE','FEIJAO FRADINHO':'FEIJÃO FRADINHO',
  'MACARRAO ESPAGUETE':'MACARRÃO ESPAGUETE','MACARRAO PARAFUSO':'MACARRÃO PARAFUSO',
  'MACARRAO PENNE':'MACARRÃO PENNE','MACARRAO INSTANTANEO':'MACARRÃO INSTANTÂNEO',
  'MIOJO':'MACARRÃO INSTANTÂNEO','MACARRAO DE ARROZ':'MACARRÃO DE ARROZ',
  'LASANHA':'MASSA DE LASANHA','MASSA DE LASANHA':'MASSA DE LASANHA',
  'FARINHA DE MILHO':'FARINHA DE MILHO','FARINHA DE MANDIOCA':'FARINHA DE MANDIOCA',
  'FARINHA DE ROSCA':'FARINHA DE ROSCA','FUBA':'FUBÁ',
  'GOMA DE TAPIOCA':'GOMA DE TAPIOCA','POLVILHO':'POLVILHO','POLVILHO DOCE':'POLVILHO DOCE',
  'POLVILHO AZEDO':'POLVILHO AZEDO','AMIDO DE MILHO':'AMIDO DE MILHO','MAIZENA':'AMIDO DE MILHO',
  'OLEO VEGETAL':'ÓLEO VEGETAL','AZEITE':'AZEITE','AZEITE DE OLIVA':'AZEITE DE OLIVA',
  'VINAGRE BRANCO':'VINAGRE BRANCO','VINAGRE TINTO':'VINAGRE TINTO',
  'SAL REFINADO':'SAL REFINADO','SAL GROSSO':'SAL GROSSO',
  'ACUCAR REFINADO':'AÇÚCAR REFINADO','ACUCAR CRISTAL':'AÇÚCAR CRISTAL','ACUCAR DEMERARA':'AÇÚCAR DEMERARA',
  'CAFE PO':'CAFÉ EM PÓ','CAFE EM PO':'CAFÉ EM PÓ','CAFE SOLUVEL':'CAFÉ SOLÚVEL','CAPUCCINO':'CAPPUCCINO',
  'CHA':'CHÁ','CHA MATE':'CHÁ MATE','CHA PRETO':'CHÁ PRETO','CHA VERDE':'CHÁ VERDE',
  'CHOCOLATE EM PO':'CHOCOLATE EM PÓ','ACHOCOLATADO':'ACHOCOLATADO','NESCAU':'ACHOCOLATADO',
  'SUCO EM PO':'SUCO EM PÓ','SUCO CONCENTRADO':'SUCO CONCENTRADO','REFRESCO':'REFRESCO',
  'GELATINA':'GELATINA','GELATINA EM PO':'GELATINA EM PÓ',
  'EXTRATO TOMATE':'EXTRATO DE TOMATE','MOLHO DE TOMATE':'MOLHO DE TOMATE','MOLHO TOMATE':'MOLHO DE TOMATE',
  'MOLHO SHOYU':'MOLHO SHOYU','MAIONESE':'MAIONESE','MOSTARDA':'MOSTARDA','KETCHUP':'KETCHUP',
  'CATCHUP':'KETCHUP','TEMPERO COMPLETO':'TEMPERO COMPLETO','TEMPERO VERDE':'TEMPERO VERDE',
  'CALDO DE GALINHA':'CALDO DE GALINHA','CALDO DE CARNE':'CALDO DE CARNE','CALDO DE LEGUMES':'CALDO DE LEGUMES',
  'PIMENTA':'PIMENTA','PIMENTA DO REINO':'PIMENTA-DO-REINO','ORÉGANO':'ORÉGANO','COMINHO':'COMINHO',
  'ACAFRAO':'AÇAFRÃO','CANELA':'CANELA','CRAVO':'CRAVO','LOURO':'FOLHA DE LOURO',
  'GELEIA':'GELEIA','MEL':'MEL','MEL DE ABELHA':'MEL','DOCE DE LEITE':'DOCE DE LEITE',
  'GOIABADA':'GOIABADA','REQUEIJAO':'REQUEIJÃO','QUEIJO':'QUEIJO','QUEIJO RALADO':'QUEIJO RALADO',
  'IOGURTE':'IOGURTE','MARGARINA':'MARGARINA','MANTEIGA COM SAL':'MANTEIGA COM SAL',
  'MANTEIGA SEM SAL':'MANTEIGA SEM SAL',
  'SARDINHA':'SARDINHA EM LATA','SARDINHA EM LATA':'SARDINHA EM LATA','ATUM':'ATUM EM LATA','ATUM EM LATA':'ATUM EM LATA',
  'MILHO EM CONSERVA':'MILHO EM CONSERVA','ERVILHA EM CONSERVA':'ERVILHA EM CONSERVA',
  'SELETA DE LEGUMES':'SELETA DE LEGUMES','PALMITO':'PALMITO EM CONSERVA',
  'FRANGO':'FRANGO','PEITO DE FRANGO':'PEITO DE FRANGO','COXA DE FRANGO':'COXA DE FRANGO',
  'CARNE BOVINA':'CARNE BOVINA','CARNE MOIDA':'CARNE MOÍDA','CARNE SECA':'CARNE SECA',
  'LINGUICA':'LINGUIÇA','SALSICHA':'SALSICHA','MORTADELA':'MORTADELA','PRESUNTO':'PRESUNTO',
  'PAO':'PÃO','PAO DE FORMA':'PÃO DE FORMA','PAO FRANCES':'PÃO FRANCÊS',
  'OVO':'OVO','OVO DE GALINHA':'OVO DE GALINHA','OVOS':'OVO','DUZIA DE OVO':'OVO',
  
  // ─── ATIVIDADES / PEDAGÓGICO ──────────────
  'MASSINHA':'MASSA DE MODELAR','MASSA DE MODELAR':'MASSA DE MODELAR','ARGILA':'ARGILA',
  'BOLA':'BOLA','BOLA DE FUTEBOL':'BOLA DE FUTEBOL','BOLA DE VOLEI':'BOLA DE VÔLEI',
  'BOLA DE BASQUETE':'BOLA DE BASQUETE','CORDA':'CORDA','CORDA DE PULAR':'CORDA DE PULAR',
  'PETECA':'PETECA','BAMBOLE':'BAMBOLÊ','RAQUETE':'RAQUETE','DARDO':'DARDO',
  'TINTA ACRILICA':'TINTA ACRÍLICA','TINTA PVA':'TINTA PVA','TINTA SPRAY':'TINTA SPRAY',
  'PINCEL PEQUENO':'PINCEL PEQUENO','PINCEL GRANDE':'PINCEL GRANDE','PINCEL CHATO':'PINCEL CHATO',
  'TESOURA SEM PONTA':'TESOURA SEM PONTA','TESOURA INFANTIL':'TESOURA INFANTIL',
  'LAPIS PRETO':'LÁPIS PRETO','LAPIS 2B':'LÁPIS 2B','LAPIS 6B':'LÁPIS 6B',
  'CANETINHA':'CANETINHA','CANETINHA HIDROCOR':'CANETINHA HIDROCOR',
  'PEGA':'PEGA','CARRINHO':'CARRINHO','BONECO':'BONECO','BONECA':'BONECA',
  'JOGO':'JOGO','JOGO EDUCATIVO':'JOGO EDUCATIVO','QUEBRA CABECA':'QUEBRA-CABEÇA',
  'LIVRO INFANTIL':'LIVRO INFANTIL','LIVRO DE HISTORIA':'LIVRO DE HISTÓRIA',
  'BALAO':'BALÃO','BALAO DE FESTA':'BALÃO DE FESTA','BEXIGA':'BALÃO','CHAPEU DE ANIVERSARIO':'CHAPÉU DE ANIVERSÁRIO',
  'VELA':'VELA','VELA DE ANIVERSARIO':'VELA DE ANIVERSÁRIO','PRENDEDOR DE BALAO':'PRENDEDOR DE BALÃO',
  
  // ─── ELÉTRICO / HIDRÁULICO ─────────────────
  'TORNEIRA':'TORNEIRA','REGISTRO':'REGISTRO','DUCHA':'DUCHA','CHUVEIRO':'CHUVEIRO',
  'TUBO':'TUBO','JOELHO':'JOELHO','CONEXAO':'CONEXÃO','VEDA ROSCA':'VEDA ROSCA',
  'SILICONE':'SILICONE','COLA EPOXI':'COLA EPÓXI','MASSA CORRIDA':'MASSA CORRIDA',
  'TINTA LATEX':'TINTA LÁTEX','TINTA PAREDE':'TINTA PAREDE',
  'INTERRUPTOR':'INTERRUPTOR','TOMADA':'TOMADA','CABO ELETRICO':'CABO ELÉTRICO','FIO ELETRICO':'FIO ELÉTRICO',
  'DISJUNTOR':'DISJUNTOR','FITA ISOLANTE':'FITA ISOLANTE',
};

// ═══════════════════════════════════════════════════════════════════
// PADRÕES DE EXTRAÇÃO DE QUALIFICADORES
// Quando o material tem tamanho/cor embutido, extrair e normalizar
// ═══════════════════════════════════════════════════════════════════
const VOLUME_PATTERNS = [
  { re: /\b(\d+)\s*ML\b/i, fmt: m => m[1]+'ML' },
  { re: /\b(\d+)\s*L\b/i, fmt: m => m[1]+'L' },
  { re: /\b(\d+[.,]?\d*)\s*LITRO?S?\b/i, fmt: m => m[1].replace(',','.')+'L' },
  { re: /\b(\d+)\s*KG\b/i, fmt: m => m[1]+'KG' },
  { re: /\b(\d+)\s*G\b/i, fmt: m => m[1]+'G' },
  { re: /\b(\d+)\s*CM\b/i, fmt: m => m[1]+'CM' },
  { re: /\b(\d+)\s*MM\b/i, fmt: m => m[1]+'MM' },
];

const COLOR_WORDS = ['AZUL','PRETA','PRETO','VERMELHA','VERMELHO','VERDE','AMARELA','AMARELO',
  'BRANCA','BRANCO','ROSA','LARANJA','ROXA','ROXO','MARROM','CINZA','BEGE','DOURADO','PRATA'];

// Auto-display: dado o normMat key, retorna o nome canônico com acentos
function autoDisplayName(normKey, rawName) {
  // 1. MAT_ALIASES tem prioridade absoluta
  if (MAT_ALIASES && MAT_ALIASES[normKey]) return MAT_ALIASES[normKey];
  // 2. Catálogo padrão (chave exata)
  if (MATERIAL_CATALOG[normKey]) return MATERIAL_CATALOG[normKey];
  // 3. Tenta limpar junk + ortografia + singular e buscar de novo
  const normalized = normalizeMaterialName(rawName || normKey);
  const normKey2 = _origNormMat(normalized);
  if (normKey2 !== normKey) {
    if (MAT_ALIASES && MAT_ALIASES[normKey2]) return MAT_ALIASES[normKey2];
    if (MATERIAL_CATALOG[normKey2]) return MATERIAL_CATALOG[normKey2];
  }
  
  // 4. Busca inteligente: tenta encontrar uma entrada do catálogo que é PREFIXO do nome
  // Ex: "SABONETE LIQUIDO ANTIBACTERIANO" → encontra "SABONETE LIQUIDO" + sufixo
  const searchKey = normKey2 || normKey;
  let bestMatch = null;
  let bestLen = 0;
  for (const [catKey, canonical] of Object.entries(MATERIAL_CATALOG)) {
    if (catKey.length > bestLen && searchKey.startsWith(catKey + ' ')) {
      bestMatch = canonical;
      bestLen = catKey.length;
    }
  }
  if (bestMatch && bestLen >= 5) {
    // Pega o sufixo não mapeado e acrescenta ao canônico
    const suffix = searchKey.substring(bestLen).trim();
    if (suffix) {
      // Normaliza o sufixo (singulariza, corrige ortografia)
      const suffixNorm = normalizeMaterialName(suffix);
      return bestMatch + ' ' + suffixNorm;
    }
    return bestMatch;
  }
  
  // 5. Retorna nome normalizado (limpo + singular + spelling fix) com case apropriado
  return toTitleCasePT(normalized || rawName || normKey);
}

// Converte para title case preservando palavras especiais
function toTitleCasePT(s) {
  if (!s) return s;
  const LOWER = new Set(['DE','DO','DA','DOS','DAS','EM','NO','NA','PARA','POR','COM','E','OU','A','O','AO','À','AS','OS']);
  const UPPER = new Set(['A4','A3','A5','UV','PVC','LED','XL','GG','PET','SKU','USB','HD','DNA','EPI','EUA']);
  
  // Se está tudo maiúsculo ou tudo minúsculo, aplica title case
  const isAllUpper = s === s.toUpperCase();
  const isAllLower = s === s.toLowerCase();
  if (!isAllUpper && !isAllLower) return s; // mantém case original
  
  return s.split(/\s+/).map((w, i) => {
    const up = w.toUpperCase();
    if (UPPER.has(up)) return up;
    if (i > 0 && LOWER.has(up)) return w.toLowerCase();
    // Preserva números/pontuação; capitaliza primeira letra
    return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  }).join(' ');
}

// Busca no catálogo por nome parcial (para sugestões)
function searchCatalog(query) {
  if (!query || query.length < 2) return [];
  const q = rmAcc(query).toUpperCase();
  const results = [];
  const seen = new Set();
  for (const [key, canonical] of Object.entries(MATERIAL_CATALOG)) {
    if (key.includes(q) && !seen.has(canonical)) {
      seen.add(canonical);
      results.push(canonical);
    }
  }
  return results.slice(0, 10);
}

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
  // Limpa anotações inúteis antes de normalizar
  let cleaned = (typeof cleanMaterialJunk === 'function') ? cleanMaterialJunk(String(s||'')) : String(s||'');
  let r = _origNormMat(cleaned);
  for (const [re, repl] of MAT_SYNONYMS) {
    if (re.test(r)) { r = r.replace(re, repl); break; }
  }
  // Se tem alias para este item, usa a chave normalizada do nome canônico
  if (MAT_ALIASES && MAT_ALIASES[r]) {
    const canonical = _origNormMat(MAT_ALIASES[r]);
    for (const [re, repl] of MAT_SYNONYMS) {
      if (re.test(canonical)) return canonical.replace(re, repl);
    }
    return canonical;
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

  // ── Correspondência contra unidades reais do banco de dados ──
  const unidades = getUnidades() || [];
  if (unidades.length > 0) {
    const norm = (x) => rmAcc(String(x||'')).toUpperCase().replace(/\s+/g,' ').trim();
    const normRaw = norm(s);
    if (normRaw.length < 3) return s;

    // 1. Correspondência exata (sem acentos, case-insensitive)
    const exact = unidades.find(u => norm(u.nome||u.unidadeNome||'') === normRaw);
    if (exact) return (exact.nome||exact.unidadeNome||'').trim();

    // 2. Nome do banco está contido no texto detectado
    //    Ex: detectado "CRAS SÃO FRANCISCO 22" → banco "Cras São Francisco"
    // Ordena por tamanho decrescente para preferir o match mais específico
    const byLen = [...unidades].sort((a,b)=>{
      const la=norm(a.nome||a.unidadeNome||'').length;
      const lb=norm(b.nome||b.unidadeNome||'').length;
      return lb-la;
    });
    const startsWith = byLen.find(u => {
      const nu = norm(u.nome||u.unidadeNome||'');
      return nu.length >= 4 && (normRaw.startsWith(nu) || nu.startsWith(normRaw));
    });
    if (startsWith) return (startsWith.nome||startsWith.unidadeNome||'').trim();

    // 3. O texto detectado contém o nome do banco (ou vice-versa) — palavras-chave
    const contains = byLen.find(u => {
      const nu = norm(u.nome||u.unidadeNome||'');
      return nu.length >= 5 && (normRaw.includes(nu) || nu.includes(normRaw));
    });
    if (contains) return (contains.nome||contains.unidadeNome||'').trim();
  }

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
        } else if (isOdtFile(file.name)) {
          // ── ODT: extrai tabelas do content.xml via JSZip ──
          rows = await odtToRows(ev.target.result);
          wb = { SheetNames: ['Sheet1'], Sheets: { Sheet1: {} } };
        } else {
          // ── Excel/ODS: pipeline original ──
          wb = XLSX.read(new Uint8Array(ev.target.result),{type:'array', cellDates: true});
          const ws = wb.Sheets[wb.SheetNames[0]];
          rows = getSafeRows(ws);
        }

        const fmt = detectFormat(rows);
        
        let entry = null;
        if(!isDocxFile(file.name) && isMultiSheet(wb)) {
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
        const catDisplay = getCanonicalCat(c.catName) || c.catName;
        if(selCats.size&&!selCats.has(catDisplay)&&!selCats.has(c.catName))return;
        (c.items||[]).forEach(it=>{
          const matKey=normMat(it.material);
          const k=u.unitName+'\x00'+catDisplay+'\x00'+matKey;
          // Usa nome canônico do MAT_ALIASES se disponível
          const rawKey=_origNormMat(it.material);
          for(const [re,repl] of MAT_SYNONYMS){if(re.test(rawKey)){break;}}
          const displayMat = autoDisplayName(matKey, it.material);
          if(!agg[k])agg[k]={unit:u.unitName,cat:catDisplay,material:displayMat,
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
// ═══════════════════════════════════════════════════════════════════
// CORREÇÃO DE ITENS — Normalização e Unificação de Materiais
// ═══════════════════════════════════════════════════════════════════
let _fixSearchTerm = '';
let _fixView = 'sugestoes'; // sugestoes | todos | regras | categorias
let _fixPage = 1;
const FIX_PAGE_SIZE = 50;
// Expose for oninput handlers
try { Object.defineProperty(window, '_fixSearchTerm', { get(){return _fixSearchTerm}, set(v){_fixSearchTerm=v}, configurable:true }); } catch(_){}

async function saveMatAliases() {
  if (!isReady || !isReady()) {
    console.warn('[Aliases] saveMatAliases: sistema não pronto ainda');
    toast('Sistema carregando... aguarde', 'red');
    return false;
  }
  const role = typeof getUserRole === 'function' ? getUserRole() : null;
  if (role !== 'admin') {
    console.warn('[Aliases] saveMatAliases: usuário não é admin (role=' + role + ')');
    toast('Apenas administradores podem salvar regras.', 'red');
    return false;
  }
  try {
    const payload = {
      matAliases: MAT_ALIASES || {},
      catAliases: CAT_ALIASES || {},
      updatedAt: serverTimestamp(),
      updatedBy: (auth && auth.currentUser?.email) || 'Sistema',
      _count: Object.keys(MAT_ALIASES || {}).length,
      _catCount: Object.keys(CAT_ALIASES || {}).length
    };
    console.info('[Aliases] Salvando:', payload._count, 'itens,', payload._catCount, 'categorias');
    await setDoc(doc(COLLECTIONS.semcasAliases, 'matConfig'), payload, { merge: true });
    
    // VERIFICAÇÃO: lê de volta para confirmar persistência
    try {
      const snap = await getDocs(query(COLLECTIONS.semcasAliases));
      let saved = false, savedCount = 0;
      snap.forEach(d => {
        if (d.id === 'matConfig') {
          saved = true;
          savedCount = Object.keys(d.data()?.matAliases || {}).length;
        }
      });
      if (saved) {
        console.info('[Aliases] ✅ CONFIRMADO no Firebase:', savedCount, 'regras persistidas');
      } else {
        console.error('[Aliases] ⚠️ Doc matConfig não encontrado após salvar!');
      }
    } catch (verifyErr) {
      console.warn('[Aliases] Não foi possível verificar persistência:', verifyErr);
    }
    
    invalidateAggCache();
    return true;
  } catch (e) {
    console.error('[Aliases] ❌ Erro ao salvar:', e);
    const code = e?.code || '';
    const msg = e?.message || String(e);
    if (code === 'permission-denied') {
      toast('❌ Permissão negada no Firebase — verifique as regras do Firestore', 'red');
    } else {
      toast('Erro ao salvar: ' + (code ? code + ' - ' : '') + msg, 'red');
    }
    return false;
  }
}

// Diagnóstico do sistema de aliases
async function diagnoseAliases() {
  console.group('🔧 DIAGNÓSTICO ALIASES');
  console.log('Sistema pronto (isReady):', typeof isReady === 'function' ? isReady() : 'N/A');
  console.log('Usuário:', auth?.currentUser?.email || 'não logado');
  console.log('Role:', typeof getUserRole === 'function' ? getUserRole() : 'N/A');
  console.log('MAT_ALIASES em memória:', Object.keys(MAT_ALIASES || {}).length, 'regras');
  console.log('CAT_ALIASES em memória:', Object.keys(CAT_ALIASES || {}).length, 'categorias');
  console.log('MATERIAL_CATALOG:', Object.keys(MATERIAL_CATALOG || {}).length, 'entradas');
  try {
    const snap = await getDocs(query(COLLECTIONS.semcasAliases));
    console.log('Documentos em semcasAliases:', snap.size);
    snap.forEach(d => {
      console.log('  - Doc:', d.id, '→', Object.keys(d.data()?.matAliases || {}).length, 'regras,', Object.keys(d.data()?.catAliases || {}).length, 'categorias');
    });
  } catch (e) {
    console.error('  ❌ Erro ao ler coleção:', e?.code, e?.message);
  }
  console.groupEnd();
  toast('Diagnóstico completo — abra o Console (F12)', 'blue');
}

async function loadMatAliases() {
  try {
    console.info('[Aliases] Carregando do Firebase...');
    const snap = await getDocs(query(COLLECTIONS.semcasAliases));
    let loaded = false;
    snap.forEach(d => {
      if (d.id === 'matConfig') {
        const data = d.data();
        if (data?.matAliases) MAT_ALIASES = data.matAliases;
        if (data?.catAliases) CAT_ALIASES = data.catAliases;
        loaded = true;
        console.info('[Aliases] ✅ Carregadas:', Object.keys(MAT_ALIASES).length, 'itens,', Object.keys(CAT_ALIASES).length, 'categorias');
      }
    });
    if (!loaded) console.info('[Aliases] Nenhuma regra salva ainda — começando com catálogo padrão');
  } catch (e) {
    console.error('[Aliases] ❌ Erro ao carregar:', e);
  }
}

function normCatKey(s) {
  return rmAcc(s).trim().replace(/\s+/g,' ').toUpperCase();
}

function getCanonicalCat(cat) {
  if (!cat) return cat;
  const key = normCatKey(cat);
  if (CAT_ALIASES[key]) return CAT_ALIASES[key];
  return cat;
}

async function applyCatFix(fromKey, toName) {
  CAT_ALIASES[fromKey] = toName;
  const ok = await saveMatAliases();
  if (ok) { invalidateAggCache(); toast('Categoria corrigida → ' + toName, 'green'); renderCorrecaoItens(); }
}

async function removeCatFix(key) {
  delete CAT_ALIASES[key];
  const ok = await saveMatAliases();
  if (ok) { toast('Regra de categoria removida.', 'green'); renderCorrecaoItens(); }
}

async function clearAllCatFixes() {
  if (!confirm('Remover TODAS as regras de categoria?')) return;
  CAT_ALIASES = {};
  await saveMatAliases();
  toast('Todas as regras de categoria removidas.', 'green');
  renderCorrecaoItens();
}

function scanAllCategories() {
  const cats = new Map();
  const addCat = (raw) => {
    if (!raw || raw.length < 3) return;
    const key = normCatKey(raw);
    if (!cats.has(key)) cats.set(key, { names: new Map(), count: 0 });
    const entry = cats.get(key);
    entry.names.set(raw, (entry.names.get(raw) || 0) + 1);
    entry.count++;
  };
  REQS.forEach(r => {
    if (r.parsed?.categories) r.parsed.categories.forEach(c => addCat(c.name));
  });
  HIST_DB.forEach(e => {
    if (e.categories) e.categories.forEach(c => addCat(c.name));
  });
  return cats;
}

// ─── Dias úteis (exclui sáb/dom/feriados) ────────────────
function countWorkingDays(startISO, endISO, feriadosSet) {
  if (!startISO || !endISO) return 0;
  const start = new Date(startISO + 'T00:00:00');
  const end = new Date(endISO + 'T00:00:00');
  if (isNaN(start) || isNaN(end) || start > end) return 0;
  let count = 0;
  const d = new Date(start);
  while (d <= end) {
    const dow = d.getDay();
    const iso = d.toISOString().slice(0, 10);
    if (dow !== 0 && dow !== 6 && (!feriadosSet || !feriadosSet.has(iso))) count++;
    d.setDate(d.getDate() + 1);
  }
  return count;
}

function getWorkingDaysInMonth(year, month, feriadosSet) {
  const start = `${year}-${String(month).padStart(2,'0')}-01`;
  const d = new Date(year, month, 0);
  const end = `${year}-${String(month).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  return countWorkingDays(start, end, feriadosSet);
}

function getCanonicalMat(material) {
  if (!material) return material;
  const key = normMat(material);
  if (MAT_ALIASES[key]) return MAT_ALIASES[key];
  return material;
}

function scanAllItems() {
  const items = new Map(); // normMat key → { names: Map<original, count>, totalQty, units, files, cats }
  const addItem = (mat, qty, unitName, fileName, catName) => {
    const key = normMat(mat);
    if (!key || key.length < 2) return;
    if (!items.has(key)) items.set(key, { names: new Map(), totalQty: 0, units: new Set(), files: new Set(), cats: new Set() });
    const entry = items.get(key);
    const trimmed = mat.trim();
    entry.names.set(trimmed, (entry.names.get(trimmed) || 0) + 1);
    entry.totalQty += qty || 0;
    if (unitName) entry.units.add(unitName);
    if (fileName) entry.files.add(fileName);
    if (catName) entry.cats.add(catName);
  };

  // Scan HIST_DB
  (HIST_DB || []).forEach(e => {
    (e.units || []).forEach(u => {
      (u.categories || []).forEach(c => {
        (c.items || []).forEach(it => {
          addItem(it.material, it.qty, u.unitName, e.fileName, c.catName);
        });
      });
    });
  });

  // Scan REQS
  (REQS || []).forEach(r => {
    Object.values(r.items || {}).forEach(it => {
      addItem(it.material, extractNum(it.qtdSolicitada), r.unidade, r.fileName, it.tipo);
    });
  });

  return items;
}

function findSimilarGroups(items) {
  const keys = [...items.keys()];
  const groups = [];
  const used = new Set();

  // Palavras que diferenciam itens (se um tem e outro não, são itens diferentes)
  const QUALIFIERS = /\b(GRANDE|PEQUENO|MEDIO|50L|100L|200L|250ML|50ML|A4|A3|AZ|SANFONADA|SUSPENSA|POLIONDA|FINA|GROSSA|ELASTICO|AZUL|AZUIS|PRETA|PRETAS|VERMELHA|GRAFITE|LIQUIDO|LIQUIDA|GEL|BARRA|PO|CAFE|AGUA|DENTAL|BANHO|ROSTO|INTEGRAL|CONDENSADO|DOCE|SALGADO|TAMPA|URGENTE|BANHEIRO|CREPOM|SEDA|CARTAO)\b/;

  // Split each key into words and base word (without qualifiers)
  const wordSets = new Map();
  const baseKeys = new Map();
  keys.forEach(k => {
    const words = k.split(/\s+/).filter(w => w.length > 2);
    wordSets.set(k, new Set(words));
    // Base = key sem qualificadores
    const base = k.replace(QUALIFIERS, '').replace(/\s+/g, ' ').trim();
    baseKeys.set(k, base);
  });

  for (let i = 0; i < keys.length; i++) {
    if (used.has(keys[i])) continue;
    const group = [keys[i]];
    const wordsA = wordSets.get(keys[i]);
    if (!wordsA || wordsA.size < 1) continue;
    
    // Se já tem mapeamento no catálogo, usa como referência
    const catA = MATERIAL_CATALOG[keys[i]] || null;

    for (let j = i + 1; j < keys.length; j++) {
      if (used.has(keys[j])) continue;
      const wordsB = wordSets.get(keys[j]);
      if (!wordsB || wordsB.size < 1) continue;
      
      // Se ambos mapeiam para entradas DIFERENTES no catálogo, NÃO agrupar
      const catB = MATERIAL_CATALOG[keys[j]] || null;
      if (catA && catB && catA !== catB) continue;

      // Check overlap
      let overlap = 0;
      for (const w of wordsA) { if (wordsB.has(w)) overlap++; }
      const minW = Math.min(wordsA.size, wordsB.size);
      const maxW = Math.max(wordsA.size, wordsB.size);

      // Exige >70% overlap (mais restritivo que antes)
      if (minW > 0 && overlap / minW >= 0.7 && (maxW - overlap) <= 2) {
        // Um deve conter o outro OU começar igual
        if (keys[i].includes(keys[j]) || keys[j].includes(keys[i]) || 
            keys[i].substring(0, 7) === keys[j].substring(0, 7)) {
          
          // Verifica se os qualificadores são diferentes
          const qualsA = keys[i].match(QUALIFIERS) || [];
          const qualsB = keys[j].match(QUALIFIERS) || [];
          const setA = new Set(qualsA.map(q => q.trim()));
          const setB = new Set(qualsB.map(q => q.trim()));
          
          // Se ambos têm qualificadores DIFERENTES, são itens diferentes
          let hasConflict = false;
          for (const q of setA) { if (setB.size > 0 && !setB.has(q)) hasConflict = true; }
          for (const q of setB) { if (setA.size > 0 && !setA.has(q)) hasConflict = true; }
          
          // Exceção: se um NÃO tem qualificador e o outro tem, agrupar (ex: CLIPS e CLIPS GRANDE)
          if (setA.size === 0 || setB.size === 0) hasConflict = false;
          
          if (!hasConflict) {
            group.push(keys[j]);
            used.add(keys[j]);
          }
        }
      }
    }

    if (group.length > 1) {
      used.add(keys[i]);
      groups.push(group);
    }
  }

  return groups;
}

async function applyMatFix(fromKey, canonicalName) {
  if (getUserRole() !== 'admin') { toast('Permissão negada: apenas Admin.', 'red'); return; }
  if (!canonicalName || !canonicalName.trim()) { toast('Nome canônico não pode ser vazio.', 'red'); return; }
  MAT_ALIASES[fromKey] = canonicalName.trim();
  const ok = await saveMatAliases();
  if (ok) {
    toast('Correção salva: → ' + canonicalName.trim(), 'green');
    renderCorrecaoItens();
  }
}

async function applyMatFixBulk(keys, canonicalName) {
  if (getUserRole() !== 'admin') { toast('Permissão negada: apenas Admin.', 'red'); return; }
  if (!canonicalName || !canonicalName.trim()) { toast('Nome canônico não pode ser vazio.', 'red'); return; }
  const cn = canonicalName.trim();
  keys.forEach(k => { MAT_ALIASES[k] = cn; });
  const ok = await saveMatAliases();
  if (ok) {
    toast(keys.length + ' variação(ões) unificadas como "' + cn + '"', 'green');
    renderCorrecaoItens();
  }
}

async function removeMatFix(key) {
  if (getUserRole() !== 'admin') { toast('Permissão negada: apenas Admin.', 'red'); return; }
  delete MAT_ALIASES[key];
  const ok = await saveMatAliases();
  if (ok) {
    toast('Regra removida.', 'green');
    renderCorrecaoItens();
  }
}

async function clearAllMatFixes() {
  if (getUserRole() !== 'admin') { toast('Permissão negada: apenas Admin.', 'red'); return; }
  if (!confirm('Remover TODAS as ' + Object.keys(MAT_ALIASES).length + ' regras de correção de itens?')) return;
  MAT_ALIASES = {};
  const ok = await saveMatAliases();
  if (ok) { toast('Todas as regras removidas.', 'green'); renderCorrecaoItens(); }
}

function setFixView(v) { _fixView = v; _fixPage = 1; renderCorrecaoItens(); }
function fixGoPage(pg) { _fixPage = pg; renderCorrecaoItens(); }

function renderCorrecaoItens() {
  // Re-sync data
  if (window.__semcasHistDB && window.__semcasHistDB.length > 0) HIST_DB = window.__semcasHistDB;
  if (getSemcasHistDB() && getSemcasHistDB().length > 0) HIST_DB = getSemcasHistDB();
  applyAliasesToHistDB();

  const tabEl = document.getElementById('tab-rel');
  if (!tabEl) return;

  const items = scanAllItems();
  const nRules = Object.keys(MAT_ALIASES).length;
  const nTotal = items.size;

  // Find auto-detected variations (same normMat key, different display names)
  const withVariations = [];
  items.forEach((val, key) => {
    if (val.names.size > 1 && !MAT_ALIASES[key]) {
      withVariations.push({ key, ...val, namesArr: [...val.names.entries()].sort((a, b) => b[1] - a[1]) });
    }
  });

  // Find similar groups (fuzzy match across different normMat keys)
  const similarGroups = findSimilarGroups(items);
  // Filter out groups where all items already have aliases
  const pendingSimilar = similarGroups.filter(group => group.some(k => !MAT_ALIASES[k]));
  const nSugestoes = withVariations.length + pendingSimilar.length;

  // ─── BUILD HTML ───
  let h = '<div style="max-width:1100px;margin:0 auto">';

  // Header
  h += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:8px">'
    + '<div><h1 style="font-size:18px;font-weight:800;margin:0">🔧 Padronização do Sistema</h1>'
    + '<div style="font-size:11px;color:var(--muted)">Unifique nomes de materiais e categorias para manter o sistema organizado</div></div>'
    + '<div style="display:flex;gap:6px"><button class="btn btn-s btn-sm" onclick="diagnoseAliases()" title="Verifica se as regras estão sendo salvas no Firebase">🔧 Diagnóstico</button>'
    + '<button class="btn btn-s btn-sm" onclick="renderCorrecaoItens()">🔄 Atualizar</button></div></div>';

  // Scan categories
  const allCats = scanAllCategories();
  const nCatRules = Object.keys(CAT_ALIASES).length;
  const nCats = allCats.size;

  // Stats
  h += '<div class="pan-grid" style="grid-template-columns:repeat(auto-fill,minmax(120px,1fr))">'
    + '<div class="kpi"><div class="kpi-val" style="color:#2563eb">' + nTotal + '</div><div class="kpi-lbl">Itens</div></div>'
    + '<div class="kpi"><div class="kpi-val" style="color:#f59e0b">' + withVariations.length + '</div><div class="kpi-lbl">Variações</div></div>'
    + '<div class="kpi"><div class="kpi-val" style="color:#10b981">' + nRules + '</div><div class="kpi-lbl">Regras Itens</div></div>'
    + '<div class="kpi"><div class="kpi-val" style="color:#8b5cf6">' + nCats + '</div><div class="kpi-lbl">Categorias</div></div>'
    + '<div class="kpi"><div class="kpi-val" style="color:#059669">' + nCatRules + '</div><div class="kpi-lbl">Regras Categ.</div></div>'
    + '</div>';

  if (!items.size && !allCats.size) {
    h += '<div class="pan-empty"><div class="ic">📦</div>Nenhum dado encontrado. Registre requisições ou carregue planilhas no Banco de Dados.</div>';
    tabEl.innerHTML = h + '</div>';
    return;
  }

  // Sub-nav with category tab
  // Build datalist from catalog unique values
  const catalogValues = [...new Set(Object.values(MATERIAL_CATALOG))].sort();
  h += '<datalist id="catList">';
  catalogValues.forEach(v => { h += '<option value="' + esc(v) + '">'; });
  h += '</datalist>';

  h += '<div style="display:flex;gap:0;margin-bottom:16px;border:1.5px solid var(--border);border-radius:8px;overflow:hidden">'
    + '<button class="fix-tab' + (_fixView === 'sugestoes' ? ' act' : '') + '" onclick="setFixView(\'sugestoes\')">🤖 Sugestões' + (nSugestoes ? ' (' + nSugestoes + ')' : '') + '</button>'
    + '<button class="fix-tab' + (_fixView === 'todos' ? ' act' : '') + '" onclick="setFixView(\'todos\')">📋 Itens (' + nTotal + ')</button>'
    + '<button class="fix-tab' + (_fixView === 'regras' ? ' act' : '') + '" onclick="setFixView(\'regras\')">📜 Regras (' + nRules + ')</button>'
    + '<button class="fix-tab' + (_fixView === 'categorias' ? ' act' : '') + '" onclick="setFixView(\'categorias\')">🗂️ Categorias (' + nCats + ')</button>'
    + '</div>';

  // Search
  h += '<div style="margin-bottom:12px"><input class="input" id="fixSearch" placeholder="🔍 Buscar item por nome..." value="' + esc(_fixSearchTerm) + '" '
    + 'oninput="_fixSearchTerm=this.value;renderCorrecaoItens()" style="max-width:400px;font-size:13px"></div>';

  const searchLo = rmAcc(_fixSearchTerm || '').toLowerCase();

  if (_fixView === 'sugestoes') {
    h += renderFixSugestoes(withVariations, pendingSimilar, items, searchLo);
  } else if (_fixView === 'todos') {
    h += renderFixTodos(items, searchLo);
  } else if (_fixView === 'categorias') {
    h += renderFixCategorias(allCats, searchLo);
  } else {
    h += renderFixRegras(searchLo);
  }

  h += '</div>';
  tabEl.innerHTML = h;

  // Re-focus search
  const searchEl = document.getElementById('fixSearch');
  if (searchEl && _fixSearchTerm) {
    searchEl.focus();
    searchEl.setSelectionRange(searchEl.value.length, searchEl.value.length);
  }
}

function renderFixSugestoes(withVariations, pendingSimilar, items, searchLo) {
  let h = '';

  // ─── AUTO-DETECTED VARIATIONS ───
  let filteredVars = withVariations;
  if (searchLo) filteredVars = filteredVars.filter(v => rmAcc(v.key).toLowerCase().includes(searchLo) || v.namesArr.some(([n]) => rmAcc(n).toLowerCase().includes(searchLo)));

  if (filteredVars.length) {
    h += '<div class="pan-section"><h2>🔍 Variações Detectadas (' + filteredVars.length + ')</h2>'
      + '<p class="sub">Itens que são o mesmo material mas aparecem com nomes levemente diferentes nas planilhas</p>';

    filteredVars.sort((a, b) => b.namesArr.length - a.namesArr.length).slice(0, 30).forEach((v, idx) => {
      const bestName = autoDisplayName(v.key, v.namesArr[0][0]); // Catalog or most frequent
      const totalOccur = v.namesArr.reduce((s, [, c]) => s + c, 0);
      const id = 'var_' + idx;
      h += '<div style="background:#f8fafc;border:1px solid var(--border);border-radius:10px;padding:12px;margin-bottom:8px">'
        + '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap">'
        + '<div><span style="font-weight:800;font-size:13px">' + esc(bestName) + '</span>'
        + ' <span style="font-size:10px;color:var(--muted)">' + v.namesArr.length + ' variações · ' + totalOccur + ' ocorrências · ' + v.units.size + ' unid.</span></div>'
        + '<button class="btn btn-g btn-sm" onclick="applyMatFixBulk([\'' + esc(v.key).replace(/'/g, "\\'") + '\'],document.getElementById(\'' + id + '\').value)">✅ Unificar</button>'
        + '</div>';

      h += '<div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:4px">';
      v.namesArr.forEach(([name, count]) => {
        h += '<span style="background:#dbeafe;color:#1e40af;padding:2px 8px;border-radius:6px;font-size:10px;font-weight:600">' + esc(name) + ' <span style="opacity:.6">(' + count + 'x)</span></span>';
      });
      h += '</div>';

      const hasCatalog = !!MATERIAL_CATALOG[v.key];
      h += '<div style="margin-top:8px;display:flex;gap:6px;align-items:center">'
        + '<label style="font-size:10px;font-weight:700;color:#475569;white-space:nowrap">Nome correto:</label>'
        + '<input class="input" id="' + id + '" value="' + esc(bestName) + '" list="catList" style="flex:1;font-size:12px;padding:6px 10px' + (hasCatalog ? ';border-color:#10b981;background:#f0fdf4' : '') + '">'
        + (hasCatalog ? '<span style="font-size:9px;color:#10b981;font-weight:700;white-space:nowrap">📗 Catálogo</span>' : '')
        + '</div></div>';
    });

    if (filteredVars.length > 30) h += '<div style="text-align:center;padding:10px;color:var(--muted);font-size:11px">Mostrando 30 de ' + filteredVars.length + ' variações</div>';
    h += '</div>';
  }

  // ─── FUZZY SIMILAR GROUPS ───
  let filteredSimilar = pendingSimilar;
  if (searchLo) filteredSimilar = filteredSimilar.filter(group => group.some(k => rmAcc(k).toLowerCase().includes(searchLo)));

  if (filteredSimilar.length) {
    h += '<div class="pan-section"><h2>🧩 Itens Possivelmente Iguais (' + filteredSimilar.length + ')</h2>'
      + '<p class="sub">Itens com nomes muito parecidos que podem ser o mesmo material — verifique e unifique se necessário</p>';

    filteredSimilar.slice(0, 20).forEach((group, gIdx) => {
      const id = 'sim_' + gIdx;
      const groupItems = group.map(k => ({ key: k, data: items.get(k) })).filter(x => x.data);
      // Pick best candidate: most occurrences
      const best = groupItems.sort((a, b) => {
        const aTotal = [...a.data.names.values()].reduce((s, v) => s + v, 0);
        const bTotal = [...b.data.names.values()].reduce((s, v) => s + v, 0);
        return bTotal - aTotal;
      })[0];
      const bestDisplayName = best ? [...best.data.names.keys()][0] : '';

      h += '<div style="background:#fefce8;border:1px solid #fde047;border-radius:10px;padding:12px;margin-bottom:8px">'
        + '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap">'
        + '<span style="font-weight:800;font-size:12px;color:#92400e">⚡ Grupo de ' + group.length + ' itens similares</span>'
        + '<button class="btn btn-g btn-sm" onclick="applyMatFixBulk([' + group.map(k => "'" + esc(k).replace(/'/g, "\\'") + "'").join(',') + '],document.getElementById(\'' + id + '\').value)">✅ Unificar Todos</button>'
        + '</div>';

      h += '<div style="margin-top:6px;display:flex;flex-direction:column;gap:3px">';
      groupItems.forEach(gi => {
        const displayNames = [...gi.data.names.keys()];
        const totalOccur = [...gi.data.names.values()].reduce((s, v) => s + v, 0);
        h += '<div style="display:flex;align-items:center;gap:6px;font-size:11px;padding:3px 0">'
          + '<span style="font-weight:700">' + esc(displayNames[0]) + '</span>'
          + (displayNames.length > 1 ? ' <span style="color:var(--muted);font-size:9px">(+' + (displayNames.length - 1) + ' variação)</span>' : '')
          + ' <span style="color:var(--muted);font-size:10px">' + totalOccur + ' ocorrências · ' + gi.data.units.size + ' unid.</span>'
          + '</div>';
      });
      h += '</div>';

      h += '<div style="margin-top:8px;display:flex;gap:6px;align-items:center">'
        + '<label style="font-size:10px;font-weight:700;color:#475569;white-space:nowrap">Nome correto:</label>'
        + '<input class="input" id="' + id + '" value="' + esc(bestDisplayName) + '" style="flex:1;font-size:12px;padding:6px 10px">'
        + '</div></div>';
    });

    if (filteredSimilar.length > 20) h += '<div style="text-align:center;padding:10px;color:var(--muted);font-size:11px">Mostrando 20 de ' + filteredSimilar.length + ' grupos</div>';
    h += '</div>';
  }

  if (!filteredVars.length && !filteredSimilar.length) {
    h += '<div class="empty"><div class="ic">✅</div>' + (searchLo ? 'Nenhuma sugestão encontrada para "' + esc(_fixSearchTerm) + '".' : 'Nenhuma variação ou item similar detectado! Todos os itens estão bem padronizados.') + '</div>';
  }

  return h;
}

function renderFixTodos(items, searchLo) {
  let list = [...items.entries()].map(([key, val]) => {
    const canonical = MAT_ALIASES[key] || null;
    const displayName = canonical || [...val.names.keys()][0] || key;
    const totalOccur = [...val.names.values()].reduce((s, v) => s + v, 0);
    return { key, displayName, canonical, totalOccur, nVariations: val.names.size, nUnits: val.units.size, totalQty: val.totalQty, cats: [...val.cats] };
  });

  if (searchLo) list = list.filter(r => rmAcc(r.displayName).toLowerCase().includes(searchLo) || rmAcc(r.key).toLowerCase().includes(searchLo));
  list.sort((a, b) => b.totalOccur - a.totalOccur);

  const total = list.length;
  const totalPages = Math.ceil(total / FIX_PAGE_SIZE);
  _fixPage = Math.max(1, Math.min(_fixPage, totalPages || 1));
  const paged = list.slice((_fixPage - 1) * FIX_PAGE_SIZE, _fixPage * FIX_PAGE_SIZE);

  let h = '<div class="pan-section"><h2>📋 Todos os Itens (' + total + ')</h2>'
    + '<p class="sub">Lista completa de materiais — clique no lápis para renomear</p>';
  
  // ─── TOOLBAR: Copiar itens ───
  h += '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;padding:10px;background:#f8fafc;border:1px solid var(--border);border-radius:8px">'
    + '<span style="font-size:11px;color:#475569;font-weight:700;align-self:center;margin-right:4px">📋 COPIAR:</span>'
    + '<button class="btn btn-s btn-sm" style="font-size:10px" onclick="copyItemsList(\'names\')">📝 Apenas nomes</button>'
    + '<button class="btn btn-s btn-sm" style="font-size:10px" onclick="copyItemsList(\'detailed\')">📊 Detalhado (TSV)</button>'
    + '<button class="btn btn-s btn-sm" style="font-size:10px" onclick="copyItemsList(\'variations\')">🔀 Com variações</button>'
    + '<button class="btn btn-s btn-sm" style="font-size:10px" onclick="copyItemsList(\'csv\')">📥 CSV (excel)</button>'
    + '<button class="btn btn-s btn-sm" style="font-size:10px" onclick="copyItemsList(\'json\')">⚙️ JSON</button>'
    + '</div>';

  h += '<div class="tbl-wrap"><table class="rel-table"><thead><tr>'
    + '<th>Item</th>'
    + '<th style="text-align:center">Ocorr.</th>'
    + '<th style="text-align:center">Variações</th>'
    + '<th style="text-align:center">Unidades</th>'
    + '<th>Categorias</th>'
    + '<th style="text-align:center">Correção</th>'
    + '</tr></thead><tbody>';

  paged.forEach(r => {
    const hasFix = !!r.canonical;
    h += '<tr>'
      + '<td style="font-weight:700">' + esc(r.displayName) + (hasFix ? ' <span style="font-size:9px;color:#10b981;font-weight:800">✅ CORRIGIDO</span>' : '') + '</td>'
      + '<td style="text-align:center;color:var(--muted)">' + r.totalOccur + '</td>'
      + '<td style="text-align:center">' + (r.nVariations > 1 ? '<span style="color:#f59e0b;font-weight:700">' + r.nVariations + '</span>' : '<span style="color:#10b981">1</span>') + '</td>'
      + '<td style="text-align:center;color:var(--muted)">' + r.nUnits + '</td>'
      + '<td style="font-size:10px">' + r.cats.slice(0, 2).map(c => '<span class="rel-badge rel-badge-cat" style="font-size:9px">' + esc(c) + '</span>').join(' ') + '</td>'
      + '<td style="text-align:center"><button class="btn btn-s btn-sm" style="font-size:10px" onclick="showModal(\'Renomear Item\',\'Nome atual: ' + esc(r.displayName).replace(/'/g, "\\'") + '\',\'' + esc(r.displayName).replace(/'/g, "\\'") + '\',function(v){applyMatFix(\'' + esc(r.key).replace(/'/g, "\\'") + '\',v)})">✏️</button>'
      + (hasFix ? ' <button class="btn btn-s btn-sm" style="font-size:10px;color:var(--red)" onclick="removeMatFix(\'' + esc(r.key).replace(/'/g, "\\'") + '\')">↩️</button>' : '')
      + '</td></tr>';
  });

  h += '</tbody></table></div>';

  // Pagination
  if (totalPages > 1) {
    h += '<div class="pag">';
    h += '<button class="pag-btn" onclick="fixGoPage(1)" ' + (_fixPage <= 1 ? 'disabled' : '') + '>«</button>';
    h += '<button class="pag-btn" onclick="fixGoPage(' + (_fixPage - 1) + ')" ' + (_fixPage <= 1 ? 'disabled' : '') + '>‹</button>';
    let start = Math.max(1, _fixPage - 2), end = Math.min(totalPages, _fixPage + 2);
    for (let i = start; i <= end; i++) {
      h += '<button class="pag-btn' + (i === _fixPage ? ' act' : '') + '" onclick="fixGoPage(' + i + ')">' + i + '</button>';
    }
    h += '<button class="pag-btn" onclick="fixGoPage(' + (_fixPage + 1) + ')" ' + (_fixPage >= totalPages ? 'disabled' : '') + '>›</button>';
    h += '<button class="pag-btn" onclick="fixGoPage(' + totalPages + ')" ' + (_fixPage >= totalPages ? 'disabled' : '') + '>»</button>';
    h += '<span class="pag-info">' + total + ' itens · pág ' + _fixPage + '/' + totalPages + '</span></div>';
  }

  h += '</div>';
  return h;
}

// ═══════════════════════════════════════════════════════════════════
// COPIAR ITENS CADASTRADOS — diversos formatos
// ═══════════════════════════════════════════════════════════════════
function copyItemsList(format) {
  const items = scanAllItems();
  if (!items.size) { toast('Nenhum item para copiar.', 'red'); return; }
  
  const list = [...items.entries()].map(([key, val]) => {
    const canonical = MAT_ALIASES[key] || null;
    const displayName = canonical || [...val.names.keys()][0] || key;
    const totalOccur = [...val.names.values()].reduce((s, v) => s + v, 0);
    const variations = [...val.names.entries()].sort((a, b) => b[1] - a[1]);
    return {
      key, displayName, canonical, totalOccur,
      nVariations: val.names.size, nUnits: val.units.size,
      totalQty: val.totalQty || 0, cats: [...val.cats], variations
    };
  });
  list.sort((a, b) => rmAcc(a.displayName).localeCompare(rmAcc(b.displayName)));
  
  let text = '';
  
  if (format === 'names') {
    // Apenas os nomes únicos, um por linha
    text = list.map(r => r.displayName).join('\n');
  }
  
  else if (format === 'detailed') {
    // TSV para colar no Google Sheets / Excel
    text = 'Nome Padrão\tOcorrências\tVariações\tUnidades que usam\tCategorias\tJá corrigido?\n';
    list.forEach(r => {
      text += [
        r.displayName,
        r.totalOccur,
        r.nVariations,
        r.nUnits,
        r.cats.join(' | '),
        r.canonical ? 'SIM' : 'NÃO'
      ].join('\t') + '\n';
    });
  }
  
  else if (format === 'variations') {
    // Com todas as variações encontradas
    text = 'Nome Padrão\tVariações Encontradas\tOcorrências\n';
    list.forEach(r => {
      const varsStr = r.variations.map(([n, c]) => n + ' (' + c + 'x)').join(' | ');
      text += r.displayName + '\t' + varsStr + '\t' + r.totalOccur + '\n';
    });
  }
  
  else if (format === 'csv') {
    // CSV (vírgulas, com aspas)
    const esc = s => '"' + String(s).replace(/"/g, '""') + '"';
    text = 'Nome,Ocorrencias,Variacoes,Unidades,Categorias,Corrigido\n';
    list.forEach(r => {
      text += [esc(r.displayName), r.totalOccur, r.nVariations, r.nUnits, esc(r.cats.join('; ')), r.canonical ? 'SIM' : 'NAO'].join(',') + '\n';
    });
  }
  
  else if (format === 'json') {
    // JSON estruturado
    const data = list.map(r => ({
      nome: r.displayName,
      ocorrencias: r.totalOccur,
      variacoes: r.variations.map(([n, c]) => ({ nome: n, vezes: c })),
      unidades: r.nUnits,
      categorias: r.cats,
      corrigido: !!r.canonical
    }));
    text = JSON.stringify(data, null, 2);
  }
  
  // Copia para clipboard
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(
      () => toast('✅ ' + list.length + ' itens copiados para área de transferência!', 'green'),
      () => fallbackCopy(text, list.length)
    );
  } else {
    fallbackCopy(text, list.length);
  }
}

function fallbackCopy(text, count) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  try {
    document.execCommand('copy');
    toast('✅ ' + count + ' itens copiados!', 'green');
  } catch (_) {
    // Último fallback: modal com texto
    const w = window.open('', '_blank');
    if (w) {
      w.document.write('<pre style="font-family:monospace;padding:20px;white-space:pre-wrap">' + text.replace(/</g,'&lt;') + '</pre>');
      w.document.title = 'Itens - SEMCAS';
    }
    toast('Texto aberto em nova janela — selecione e copie (Ctrl+A, Ctrl+C)', 'blue');
  }
  document.body.removeChild(ta);
}

function renderFixRegras(searchLo) {
  const rules = Object.entries(MAT_ALIASES);
  let filtered = rules;
  if (searchLo) filtered = filtered.filter(([k, v]) => rmAcc(k).toLowerCase().includes(searchLo) || rmAcc(v).toLowerCase().includes(searchLo));

  let h = '<div class="pan-section"><h2>📜 Regras de Correção Ativas (' + filtered.length + '/' + rules.length + ')</h2>'
    + '<p class="sub">Cada regra define que um nome original de material deve ser substituído pelo nome correto nos relatórios e no Painel</p>';

  if (!filtered.length) {
    h += '<div class="empty"><div class="ic">📜</div>' + (searchLo ? 'Nenhuma regra encontrada para "' + esc(_fixSearchTerm) + '".' : 'Nenhuma regra de correção ativa. Use as Sugestões para criar regras.') + '</div>';
    h += '</div>';
    return h;
  }

  // Group rules by canonical name
  const byCanonical = {};
  filtered.forEach(([k, v]) => {
    if (!byCanonical[v]) byCanonical[v] = [];
    byCanonical[v].push(k);
  });

  const sortedGroups = Object.entries(byCanonical).sort((a, b) => b[1].length - a[1].length);

  sortedGroups.forEach(([canonical, fromKeys]) => {
    h += '<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:10px 14px;margin-bottom:8px">'
      + '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap">'
      + '<div style="font-weight:800;font-size:13px;color:#065f46">→ ' + esc(canonical) + '</div>'
      + '<span style="font-size:10px;color:#10b981;font-weight:700">' + fromKeys.length + ' correção(ões)</span>'
      + '</div>';

    h += '<div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:4px">';
    fromKeys.forEach(k => {
      h += '<span style="display:inline-flex;align-items:center;gap:4px;background:#fee2e2;color:#991b1b;padding:2px 8px;border-radius:6px;font-size:10px;font-weight:600">'
        + esc(k)
        + ' <span style="cursor:pointer;opacity:.6" onclick="event.stopPropagation();removeMatFix(\'' + esc(k).replace(/'/g, "\\'") + '\')">✕</span>'
        + '</span>';
    });
    h += '</div></div>';
  });

  if (rules.length > 0) {
    h += '<div style="margin-top:12px"><button class="btn btn-s btn-sm" style="color:#dc2626;border-color:#fca5a5;font-size:10px" onclick="clearAllMatFixes()">🗑️ Remover todas as regras</button></div>';
  }

  h += '</div>';
  return h;
}

function renderFixCategorias(allCats, searchLo) {
  let h = '';
  
  const catEntries = [...allCats.entries()];
  let filtered = catEntries;
  if (searchLo) filtered = filtered.filter(([k, v]) => rmAcc(k).toLowerCase().includes(searchLo) || [...v.names.keys()].some(n => rmAcc(n).toLowerCase().includes(searchLo)));
  
  filtered.sort((a, b) => b[1].count - a[1].count);
  
  const catRules = Object.entries(CAT_ALIASES);
  
  // ═══ CATEGORIAS PADRÃO — com itens agrupados ═══
  h += '<div class="pan-section"><h2>📊 Categorias Padrão do Sistema</h2>'
    + '<p class="sub">Todas as categorias detectadas são classificadas automaticamente em 5 categorias padrão. Expanda para ver os itens.</p>';
  
  // Agrupa categorias detectadas por categoria padrão
  const grouped = {};
  STD_CATEGORIES.forEach(std => { grouped[std.id] = { std, variations: [], totalCount: 0 }; });
  grouped['__outros__'] = { std: { id: 'outros', name: 'OUTROS / NÃO CLASSIFICADO' }, variations: [], totalCount: 0 };
  
  filtered.forEach(([key, data]) => {
    const namesArr = [...data.names.entries()].sort((a, b) => b[1] - a[1]);
    const mainName = namesArr[0][0];
    const matched = classifyCategory(mainName);
    const bucket = matched ? grouped[matched.id] : grouped['__outros__'];
    bucket.variations.push({ key, data, mainName, namesArr, hasAlias: !!CAT_ALIASES[key] });
    bucket.totalCount += data.count;
  });
  
  // Renderiza cada grupo
  const STD_ICONS = { expediente: '📝', limpeza: '🧽', higiene: '🧼', descartavel: '♻️', processados: '🍽️', outros: '❓' };
  
  Object.values(grouped).forEach(g => {
    if (g.variations.length === 0) return;
    const groupId = 'grpCat_' + g.std.id;
    const icon = STD_ICONS[g.std.id] || '📦';
    
    // Coleta todos os itens dessa categoria padrão
    const itemsInCat = new Map(); // material → count
    g.variations.forEach(v => {
      // Percorre HIST_DB para buscar itens dessa categoria
      HIST_DB.forEach(entry => {
        (entry.units || []).forEach(u => {
          (u.categories || []).forEach(c => {
            if (rmAcc(c.name).toUpperCase() === rmAcc(v.mainName).toUpperCase()) {
              (c.items || []).forEach(it => {
                const mat = autoDisplayName(normMat(it.material), it.material);
                itemsInCat.set(mat, (itemsInCat.get(mat) || 0) + 1);
              });
            }
          });
        });
      });
      // Também nas requisições ativas
      REQS.forEach(r => {
        (r.parsed?.categories || []).forEach(c => {
          if (rmAcc(c.name).toUpperCase() === rmAcc(v.mainName).toUpperCase()) {
            (c.items || []).forEach(it => {
              const mat = autoDisplayName(normMat(it.material), it.material);
              itemsInCat.set(mat, (itemsInCat.get(mat) || 0) + 1);
            });
          }
        });
      });
    });
    const itemsSorted = [...itemsInCat.entries()].sort((a, b) => b[1] - a[1]);
    
    h += '<div style="background:#fff;border:1.5px solid #e2e8f0;border-radius:10px;margin-bottom:10px;overflow:hidden">'
      + '<div style="padding:12px 14px;background:linear-gradient(90deg,#f8fafc,#fff);border-bottom:1px solid #e2e8f0;cursor:pointer;display:flex;align-items:center;justify-content:space-between" '
      + 'onclick="var x=document.getElementById(\'' + groupId + '\');x.style.display=(x.style.display===\'none\'?\'block\':\'none\');var ic=document.getElementById(\'' + groupId + '_ic\');if(ic)ic.textContent=(x.style.display===\'none\'?\'▸\':\'▾\')">'
      + '<div style="display:flex;align-items:center;gap:8px">'
      + '<span style="font-size:18px">' + icon + '</span>'
      + '<b style="font-size:14px;color:#0f172a">' + esc(g.std.name) + '</b>'
      + '<span style="background:#dbeafe;color:#1e40af;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700">' + g.variations.length + ' variação(ões)</span>'
      + '<span style="background:#dcfce7;color:#166534;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700">' + itemsSorted.length + ' item(ns)</span>'
      + '</div>'
      + '<span id="' + groupId + '_ic" style="color:#64748b;font-size:14px">▸</span>'
      + '</div>'
      + '<div id="' + groupId + '" style="display:none;padding:14px">';
    
    // Botão de "Unificar todas" se houver variações
    if (g.variations.length > 1 && g.std.id !== 'outros') {
      const keysToFix = g.variations.filter(v => !v.hasAlias || CAT_ALIASES[v.key] !== g.std.name).map(v => v.key);
      if (keysToFix.length > 0) {
        h += '<button class="btn btn-p btn-sm" style="margin-bottom:10px" onclick="'
          + 'if(confirm(\'Unificar ' + keysToFix.length + ' variação(ões) como &quot;' + g.std.name.replace(/'/g, "\\'") + '&quot;?\')){' 
          + keysToFix.map(k => 'applyCatFix(\'' + k.replace(/'/g,"\\'") + '\',\'' + g.std.name.replace(/'/g,"\\'") + '\')').join(';')
          + '}">✨ Unificar todas as ' + keysToFix.length + ' variações como &quot;' + esc(g.std.name) + '&quot;</button>';
      }
    }
    
    // Lista de variações detectadas
    h += '<div style="font-size:11px;font-weight:700;color:#64748b;margin-bottom:6px;margin-top:4px">📋 VARIAÇÕES DETECTADAS:</div>';
    h += '<div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:12px">';
    g.variations.forEach(v => {
      const target = v.hasAlias ? CAT_ALIASES[v.key] : null;
      const isCorrect = target === g.std.name;
      h += '<span style="display:inline-flex;align-items:center;gap:4px;background:' 
        + (isCorrect ? '#d1fae5;border:1px solid #86efac' : (v.hasAlias ? '#fef3c7;border:1px solid #fde68a' : '#f1f5f9;border:1px solid #cbd5e1'))
        + ';padding:3px 8px;border-radius:6px;font-size:11px">'
        + (isCorrect ? '✅ ' : (v.hasAlias ? '⚠️ ' : ''))
        + esc(v.mainName) + ' <span style="opacity:.7">(' + v.data.count + 'x)</span>';
      if (!isCorrect && g.std.id !== 'outros') {
        h += '<button class="btn btn-s btn-sm" style="font-size:9px;padding:1px 6px;margin-left:4px" onclick="applyCatFix(\'' + v.key.replace(/'/g,"\\'") + '\',\'' + g.std.name.replace(/'/g,"\\'") + '\')">Padronizar</button>';
      }
      h += '</span>';
    });
    h += '</div>';
    
    // Lista de itens (para poder revisar)
    if (itemsSorted.length > 0) {
      h += '<div style="font-size:11px;font-weight:700;color:#64748b;margin-bottom:6px">📦 ITENS CADASTRADOS NESSA CATEGORIA (' + itemsSorted.length + '):</div>';
      h += '<div style="max-height:250px;overflow-y:auto;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:8px">';
      h += '<table style="width:100%;font-size:11px"><tbody>';
      itemsSorted.forEach(([mat, cnt]) => {
        h += '<tr><td style="padding:2px 0;color:#0f172a;font-weight:500">' + esc(mat) + '</td>'
          + '<td style="padding:2px 0;text-align:right;color:#64748b;font-size:10px">' + cnt + 'x</td></tr>';
      });
      h += '</tbody></table></div>';
    }
    
    h += '</div></div>';
  });
  
  h += '</div>';
  
  // ═══ REGRAS DE CATEGORIA ATIVAS ═══
  if (catRules.length > 0) {
    h += '<div class="pan-section"><h2>✅ Regras Ativas (' + catRules.length + ')</h2>'
      + '<p class="sub">Categorias que já foram padronizadas</p>';
    catRules.sort((a, b) => a[1].localeCompare(b[1])).forEach(([fromKey, toName]) => {
      h += '<div style="display:flex;align-items:center;gap:8px;padding:6px 10px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;margin-bottom:4px;font-size:12px">'
        + '<span style="color:#991b1b;text-decoration:line-through;font-weight:500">' + esc(fromKey) + '</span>'
        + '<span style="color:#64748b">→</span>'
        + '<span style="color:#065f46;font-weight:700">' + esc(toName) + '</span>'
        + '<button class="btn btn-s btn-sm" style="margin-left:auto;font-size:9px;padding:2px 6px;color:#dc2626;border-color:#fca5a5" onclick="removeCatFix(\'' + esc(fromKey).replace(/'/g, "\\'") + '\')">✕</button>'
        + '</div>';
    });
    h += '<div style="margin-top:8px"><button class="btn btn-s btn-sm" style="color:#dc2626;border-color:#fca5a5;font-size:10px" onclick="clearAllCatFixes()">🗑️ Remover todas</button></div>';
    h += '</div>';
  }
  
  return h;
}

// PAINEL DE GESTÃO
// ═══════════════════════════════════════════════════════════════════



// ═══════════════════════════════════════════════════════════════════
// CLASSIFICAÇÃO DE UNIDADES POR TIPO
// ═══════════════════════════════════════════════════════════════════
const UNIT_TYPES = [
  { id:'sede',     label:'Sede/Admin',       icon:'🏛️', color:'#6366f1', re:/sede|semcas|admin|astec|arquivo|contrato|alta\s*complex|coordena[cç][aã]o|diretoria|superintend[eê]ncia|secret[aá]ria|gabinete|assessoria|abordagem|comunica[cç][aã]o|auditoria|recep[cç][aã]o|sub\s*solo|planejamento|recursos\s*humanos|inform[aá]tica|manuten[cç][aã]o|transporte|almoxarifado|patrim[oô]nio|protocolo|cadastro|fundo|regula[cç][aã]o|vigil[aâ]ncia|medida|socio\s*educativ|cmdca|cmas|cogetep|pcdif|igas|articula[cç][aã]o|or[cç]ament|contabilidade|presta[cç][aã]o|paif|scfv|paefi|furo\s*de\s*estoque|casa\s*do\s*bairro|circo\s*escola|n[uú]cleo/i },
  { id:'cras',     label:'CRAS',             icon:'🏠', color:'#3b82f6', re:/^cras\b/i },
  { id:'creas',    label:'CREAS',            icon:'🏢', color:'#8b5cf6', re:/^creas\b/i },
  { id:'ct',       label:'CT',               icon:'🏫', color:'#06b6d4', re:/^ct\b|conselho\s*tutelar/i },
  { id:'centropop',label:'Centro Pop',       icon:'🤝', color:'#14b8a6', re:/centro\s*pop/i },
  { id:'conselho', label:'Conselho/PROCAD',  icon:'📋', color:'#f59e0b', re:/procad|aepeti/i },
  { id:'abrigo',   label:'Abrigo/Acolhimento',icon:'🛏️', color:'#ef4444', re:/abrigo|acolh|resid[eê]ncia|rep[uú]blica|luz\s*e\s*vida|recanto|ilpi|casa\s*de|mulher|elizangela|pop\s*rua/i },
  { id:'externo',  label:'Unidade Externa',  icon:'🔗', color:'#64748b', re:/^externo$/i },
];

function classifyUnit(name) {
  if (!name) return { id:'outros', label:'Outros', icon:'❓', color:'#94a3b8' };
  
  // ── PRIORIDADE 1: Buscar no cadastro de Gestão de Unidades ──
  try {
    const norm = s => rmAcc(String(s||'')).toLowerCase().trim().replace(/\s+/g,' ');
    const target = norm(name);
    const units = getUnidades() || [];
    const u = units.find(x => norm(x?.nome || x?.unidadeNome || '') === target);
    if (u?.tipo) {
      let t = String(u.tipo).toLowerCase().trim();
      if (t === 'semcas') t = 'sede';
      const byId = UNIT_TYPES.find(x => x.id === t);
      if (byId) return byId;
      if (t.includes('cras')) return UNIT_TYPES.find(x => x.id === 'cras');
      if (t.includes('creas')) return UNIT_TYPES.find(x => x.id === 'creas');
      if (t.includes('ct') || t.includes('conselho tutelar')) return UNIT_TYPES.find(x => x.id === 'ct');
      if (t.includes('abrigo') || t.includes('acolhimento')) return UNIT_TYPES.find(x => x.id === 'abrigo');
      if (t.includes('pop')) return UNIT_TYPES.find(x => x.id === 'centropop');
      return UNIT_TYPES.find(x => x.id === 'sede');
    }
  } catch (_) {}
  
  // ── PRIORIDADE 2: Fallback por regex ──
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
      el.innerHTML='<div style="text-align:center;padding:60px 20px;color:#64748b"><div style="font-size:48px;margin-bottom:12px">📊</div>'
        +'<b style="font-size:16px;color:#0f172a">Painel do Almoxarifado</b>'
        +'<br><span style="font-size:13px">Carregue planilhas no <b>Banco de Dados</b> para gerar o painel.</span></div>';
    } else {
      el.innerHTML=reqStats;
    }
    return;
  }

  const allAggFull=getCachedAgg(HIST_DB,new Set(),new Set());
  if(!allAggFull.length){
    el.innerHTML='<div class="pan-empty"><div class="ic">⚠️</div>'
      +'<b>Sem itens com quantidade no banco.</b>'
      +'<br><span style="font-size:12px">'+HIST_DB.length+' arquivo(s) carregado(s), mas sem itens com qtd > 0.</span></div>';
    return;
  }

  const allUnitsRaw=[...new Set(allAggFull.map(r=>r.unit))].sort();
  const allYears=[...new Set(HIST_DB.map(e=>e.year).filter(Boolean))].sort();
  
  renderPanFilters(allUnitsRaw);
  
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
  const nAssumed=HIST_DB.filter(e=>e.yearAssumed).length;

  let h='';

  // ─── Alertas comuns ───
  if(HIST_DB_PARTIAL){
    h+='<div class="alert-card alert-blue"><div class="alert-icon">📉</div>'
      +'<div class="alert-body"><b>Modo econômico ativo</b> '
      +'<button class="btn btn-s btn-sm" style="margin-left:6px" onclick="loadAllHistDBAndRefresh()">Carregar tudo</button>'
      +'</div></div>';
  }
  if(nAssumed>0){
    h+='<div class="alert-card alert-yellow"><div class="alert-icon">⚠️</div>'
      +'<div class="alert-body"><b>'+nAssumed+' arquivo(s) com ano não detectado</b></div></div>';
  }

  // ═══════════════════════════════════════════════════
  // SUB-ABA: VISÃO GERAL
  // ═══════════════════════════════════════════════════
  if (_panSub === 'visao') {
    const reqStatsHtml = buildReqStats();
    if(reqStatsHtml) h += reqStatsHtml;

    h+='<div class="pan-grid">'
      +kpi(allYears.length,'Anos','de dados',allYears.join(', '),'#6d28d9')
      +kpi(HIST_DB.length,'Arquivos',totalWeeks+' envios','','#0284c7')
      +kpi(totalMonths,'Meses','de histórico','','#0891b2')
      +kpi(allUnits.length,'Unidades','ativas','','#059669')
      +kpi(allAgg.length,'Combinações','item × unidade','','#d97706')
      +kpi(totalDeliveries.toLocaleString('pt-BR'),'Total Itens','entregues (acumulado)','','#dc2626')
      +'</div>';

    h+=panSection('🚨 Alertas e Atenção','Situações que exigem atenção',buildAlertas(allAgg,totalWeeks,totalMonths));
    h+=panSection('🗂️ Distribuição por Categoria','Quanto cada categoria representa',buildCatDistrib(allAgg,totalDeliveries));
    h+=panSection('📅 Sazonalidade Mensal','Meses com maior e menor demanda',buildSazonalidade());
    
    if(allYears.length>=2){
      h+=panSection('📈 Evolução Anual','Comparação do total por unidade entre anos',buildEvolucaoAnual(allAgg,allYears,allUnits));
    }
  }

  // ═══════════════════════════════════════════════════
  // SUB-ABA: ENTREGAS REALIZADAS
  // ═══════════════════════════════════════════════════
  else if (_panSub === 'entregas') {
    h+='<h2 style="font-size:16px;font-weight:800;margin-bottom:4px">📦 Entregas Realizadas</h2>'
      +'<p style="font-size:12px;color:var(--muted);margin-bottom:14px">Quantidade real entregue a cada unidade — dados do banco de planilhas.</p>';
    
    // Se filtrou por unidade, mostra detalhamento completo
    if (_panUnit) {
      h += buildUnitProfile(allAgg, _panUnit, allYears);
    } else {
      // Lista cada unidade com seus itens entregues
      const sorted = [...allUnits].sort((a,b) => {
        const ta = allAgg.filter(r=>r.unit===a).reduce((s,r)=>s+r.total,0);
        const tb = allAgg.filter(r=>r.unit===b).reduce((s,r)=>s+r.total,0);
        return tb - ta;
      });
      sorted.forEach(u => {
        const rows = allAgg.filter(r => r.unit === u).sort((a,b) => b.total - a.total);
        const tot = rows.reduce((s,r) => s + r.total, 0);
        const tipo = classifyUnit(u);
        h += '<div class="pan-section" style="margin-bottom:12px">'
          +'<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;cursor:pointer" onclick="document.getElementById(\'panUnitSel\').value=\''+esc(u)+'\';buildPainel()">'
          +'<h3 style="font-size:14px;font-weight:700;margin:0">'+tipo.icon+' '+esc(u)+'</h3>'
          +'<span style="font-size:12px;color:#059669;font-weight:700">'+tot.toLocaleString('pt-BR')+' itens entregues</span>'
          +'</div>'
          +'<table class="pan-table"><thead><tr><th>Material</th><th>Categoria</th><th>Total Entregue</th><th>Envios</th></tr></thead><tbody>';
        rows.slice(0, 10).forEach(r => {
          h += '<tr><td style="font-weight:600">'+esc(normMat(r.item))+'</td><td style="font-size:11px;color:var(--muted)">'+esc(r.cat)+'</td>'
            +'<td style="font-weight:700;color:#059669">'+r.total.toLocaleString('pt-BR')+'</td>'
            +'<td style="font-size:11px;color:var(--muted)">'+r.count+'x</td></tr>';
        });
        if (rows.length > 10) h += '<tr><td colspan="4" style="font-size:11px;color:var(--muted);text-align:center">... e mais '+(rows.length-10)+' itens. Clique na unidade para ver tudo.</td></tr>';
        h += '</tbody></table></div>';
      });
    }
  }

  // ═══════════════════════════════════════════════════
  // SUB-ABA: MÉDIAS
  // ═══════════════════════════════════════════════════
  else if (_panSub === 'medias') {
    h+='<h2 style="font-size:16px;font-weight:800;margin-bottom:4px">📊 Médias de Consumo</h2>'
      +'<p style="font-size:12px;color:var(--muted);margin-bottom:14px">Médias semanal, mensal e anual — por categoria, tipo de unidade e unidade individual.</p>';
    
    const totalYears = allYears.length || 1;
    
    // ── Média por Unidade Individual (semanal/mensal/anual) ──
    h += '<div class="pan-section"><h3>🏢 Média por Unidade</h3>'
      +'<p class="sub">Consumo total e médias por período de cada unidade (baseado em dias úteis, seg-sex, excluindo feriados)</p>'
      +'<table class="pan-table"><thead><tr><th>Unidade</th><th>Tipo</th><th>Total Entregue</th><th>Média/Semana</th><th>Média/Mês</th><th>Média/Ano</th></tr></thead><tbody>';
    
    const unitTotals = {};
    allAgg.forEach(r => {
      if (!unitTotals[r.unit]) unitTotals[r.unit] = 0;
      unitTotals[r.unit] += r.total;
    });
    const unitSorted = Object.entries(unitTotals).sort((a,b) => b[1] - a[1]);
    
    unitSorted.forEach(([unit, total]) => {
      const tipo = classifyUnit(unit);
      const avgWeek = totalWeeks > 0 ? (total / totalWeeks).toFixed(1) : '—';
      const avgMonth = totalMonths > 0 ? (total / totalMonths).toFixed(1) : '—';
      const avgYear = totalYears > 0 ? (total / totalYears).toFixed(0) : '—';
      h += '<tr><td style="font-weight:700;font-size:12px;cursor:pointer" onclick="document.getElementById(\'panUnitSel\').value=\''+esc(unit)+'\';buildPainel()">'+tipo.icon+' '+esc(unit)+'</td>'
        +'<td style="font-size:11px;color:var(--muted)">'+tipo.label+'</td>'
        +'<td style="font-weight:700">'+total.toLocaleString('pt-BR')+'</td>'
        +'<td style="color:#0891b2;font-weight:700">'+avgWeek+'</td>'
        +'<td style="color:#2563eb;font-weight:700">'+avgMonth+'</td>'
        +'<td style="color:#7c3aed;font-weight:700">'+avgYear+'</td></tr>';
    });
    h += '</tbody></table></div>';
    
    // ── Média por Categoria ──
    const catMap = {};
    allAgg.forEach(r => {
      const cat = getCanonicalCat(r.cat) || r.cat;
      if (!catMap[cat]) catMap[cat] = { total: 0, items: new Set() };
      catMap[cat].total += r.total;
      catMap[cat].items.add(normMat(r.item || r.material));
    });
    const catSorted = Object.entries(catMap).sort((a,b) => b[1].total - a[1].total);
    h += '<div class="pan-section"><h3>📁 Média por Categoria</h3>'
      +'<table class="pan-table"><thead><tr><th>Categoria</th><th>Total</th><th>Média/Semana</th><th>Média/Mês</th><th>Média/Ano</th><th>Itens</th></tr></thead><tbody>';
    catSorted.forEach(([cat, data]) => {
      h += '<tr><td style="font-weight:600">'+esc(cat)+'</td>'
        +'<td>'+data.total.toLocaleString('pt-BR')+'</td>'
        +'<td style="color:#0891b2;font-weight:600">'+(totalWeeks>0?(data.total/totalWeeks).toFixed(1):'—')+'</td>'
        +'<td style="color:#2563eb;font-weight:700">'+(totalMonths>0?(data.total/totalMonths).toFixed(1):'—')+'</td>'
        +'<td style="color:#7c3aed;font-weight:600">'+(totalYears>0?(data.total/totalYears).toFixed(0):'—')+'</td>'
        +'<td>'+data.items.size+'</td></tr>';
    });
    h += '</tbody></table></div>';
    
    // ── Média por Tipo de Unidade ──
    const tipoMap = {};
    allAgg.forEach(r => {
      const tipo = classifyUnit(r.unit);
      const key = tipo.label;
      if (!tipoMap[key]) tipoMap[key] = { total: 0, units: new Set(), icon: tipo.icon };
      tipoMap[key].total += r.total;
      tipoMap[key].units.add(r.unit);
    });
    h += '<div class="pan-section"><h3>🏷️ Média por Tipo de Unidade</h3>'
      +'<table class="pan-table"><thead><tr><th>Tipo</th><th>Unidades</th><th>Total</th><th>Média/Mês</th><th>Média/Mês por Unid.</th><th>Média/Ano</th></tr></thead><tbody>';
    Object.entries(tipoMap).sort((a,b) => b[1].total - a[1].total).forEach(([tipo, data]) => {
      const avg = totalMonths > 0 ? (data.total / totalMonths).toFixed(1) : '—';
      const avgPerUnit = totalMonths > 0 && data.units.size > 0 ? (data.total / totalMonths / data.units.size).toFixed(1) : '—';
      const avgYear = totalYears > 0 ? (data.total / totalYears).toFixed(0) : '—';
      h += '<tr><td>'+data.icon+' '+esc(tipo)+'</td><td>'+data.units.size+'</td>'
        +'<td>'+data.total.toLocaleString('pt-BR')+'</td>'
        +'<td style="font-weight:700;color:#2563eb">'+avg+'</td>'
        +'<td style="color:#059669;font-weight:600">'+avgPerUnit+'</td>'
        +'<td style="color:#7c3aed;font-weight:600">'+avgYear+'</td></tr>';
    });
    h += '</tbody></table></div>';
    
    h += panSection('📊 Variabilidade', 'CV alto = consumo irregular — itens com maior oscilação de demanda', buildVariabilidade(allAgg));
  }

  // ═══════════════════════════════════════════════════
  // SUB-ABA: RANKINGS
  // ═══════════════════════════════════════════════════
  else if (_panSub === 'rankings') {
    h+='<h2 style="font-size:16px;font-weight:800;margin-bottom:4px">🏆 Rankings</h2>'
      +'<p style="font-size:12px;color:var(--muted);margin-bottom:14px">Quem mais recebe cada material, quais itens são mais pedidos, e ranking geral.</p>';
    
    h+='<div class="two-col">'
      +panSection('📦 Top 15 Itens mais Entregues','Total acumulado de todas as unidades',buildTopItems(allAgg))
      +panSection('🏢 Ranking de Unidades','Quem mais recebeu materiais',buildUnitRanking(allAgg,allUnits))
      +'</div>';
    
    // Ranking: para cada item popular, quais unidades mais recebem
    const itemMap = {};
    allAgg.forEach(r => {
      const mat = normMat(r.item);
      if (!itemMap[mat]) itemMap[mat] = { total: 0, units: {} };
      itemMap[mat].total += r.total;
      if (!itemMap[mat].units[r.unit]) itemMap[mat].units[r.unit] = 0;
      itemMap[mat].units[r.unit] += r.total;
    });
    const topItems = Object.entries(itemMap).sort((a,b) => b[1].total - a[1].total).slice(0, 12);
    
    h += '<div class="pan-section"><h3 style="font-size:14px;font-weight:700;margin-bottom:10px">🔍 Quem mais recebe cada item</h3>';
    topItems.forEach(([item, data]) => {
      const unitsSorted = Object.entries(data.units).sort((a,b) => b[1] - a[1]).slice(0, 5);
      const maxVal = unitsSorted[0]?.[1] || 1;
      h += '<div style="margin-bottom:14px;padding:10px;background:#f8fafc;border-radius:8px;border:1px solid #e2e8f0">'
        +'<div style="font-weight:700;font-size:13px;margin-bottom:6px">'+esc(item)+' <span style="color:var(--muted);font-weight:400;font-size:11px">('+data.total.toLocaleString('pt-BR')+' total)</span></div>';
      unitsSorted.forEach(([unit, qty], idx) => {
        const pct = Math.round(qty / maxVal * 100);
        const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : '  ';
        h += '<div style="display:flex;align-items:center;gap:6px;margin-bottom:3px;font-size:11px">'
          +'<span style="width:18px;text-align:center">'+medal+'</span>'
          +'<span style="width:140px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="'+esc(unit)+'">'+esc(unit)+'</span>'
          +'<div style="flex:1;background:#e2e8f0;border-radius:4px;height:14px;overflow:hidden">'
          +'<div style="width:'+pct+'%;background:#2563eb;height:100%;border-radius:4px;transition:.3s"></div></div>'
          +'<span style="width:50px;text-align:right;font-weight:700;color:#0f172a">'+qty.toLocaleString('pt-BR')+'</span></div>';
      });
      h += '</div>';
    });
    h += '</div>';
    
    // Comparativo por tipo
    if (filteredTipo && !_panUnit && allUnits.length >= 2) {
      h += panSection(filteredTipo.icon + ' Comparativo — ' + filteredTipo.label, 
        'Ranking entre as ' + allUnits.length + ' unidades do tipo',
        buildComparativo(allAgg, allUnits, filteredTipo.label, filteredTipo.color));
    }
  }

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
    const EXPORTS = { goTab, registrar, previewReq, showUnitConfirmDialog, pegarParaSeparar, entregarReq, abrirFicha, fecharFicha, marcarPronto, marcarProntoLista, voltarSeparacao, printReq, printFicha, cancelarReq, excluirHistoricoReq, renderBuracos, renderUnificar, buildPainel, gerarRelatorio, exportarCSV, handleFile, handleHistFiles, ck, okModal, closeModal, showModal, editEntryYear, editEntryPeriod, toggleDetail, removeHistEntry, openEditor, closeEditor, saveEditor, edRemoveItem, edAddItem, edAddCat, clearHistDB, clearMateriaisDB, removeDuplicatesAuto, recalcAllDates, exportBackup, importBackup, goToFile, goPage, onModeChange, clearFilters, clearPanFilters, clearYears, selAllYears, clearAllAliases, doUnifMerge, toggleUnifSel, unifRemoveSel, clearUnifSel, removeAlias, openPrintBuracos, doPrintBuracos, showOrigemUnidade, showOrigemCategoria, renderRelatorio, renderCorrecaoItens, setFixView, fixGoPage, applyMatFix, applyMatFixBulk, removeMatFix, clearAllMatFixes, applyCatFix, removeCatFix, clearAllCatFixes, closePreRegDialog, skipPreRegDialog, confirmPreRegDialog, copyItemsList, diagnoseAliases, setPanTipo, loadAllHistDBAndRefresh, addFichaItem, removeFichaItem, editMaterial, switchMatView, switchPanSub, PAGE_STATE, debouncedRenderPS, debouncedRenderES, debouncedRenderPE, debouncedRenderHI };
    Object.entries(EXPORTS).forEach(([k, v]) => { window[k] = v; });
  } catch (e) { console.error(e); }
  try { loadHistDB(); } catch (e) { console.error(e); }
  try { wrapPermissions(); } catch (_) {}

  // ── Limpa destaque de aviso quando o usuário seleciona manualmente ──
  try {
    const uSel = document.getElementById('rU');
    if (uSel) {
      uSel.addEventListener('change', () => {
        uSel.style.borderColor = '';
        uSel.style.boxShadow = '';
      });
    }
  } catch (_) {}
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
