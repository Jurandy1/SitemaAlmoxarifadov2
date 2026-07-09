// ═══════════════════════════════════════════════════════════════════
// MODAL DE REVISÃO DE ITENS — usa catálogo local (sem Firebase)
// ═══════════════════════════════════════════════════════════════════
import {
  analisarItem,
  resolveCategoria,
  BLOCKED_ITEMS,
} from "./catalogo-itens.js";

let _esc = (v) => String(v ?? "");
let _toast = () => {};

// ── Helpers internos ───────────────────────────────────────────────
function _rmac(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

// ═══════════════════════════════════════════════════════════════════
// detectItemIssues — analisa o parsed e retorna lista de problemas
// Usa catálogo local (zero Firebase)
// ═══════════════════════════════════════════════════════════════════
function detectItemIssues(parsed) {
  if (!parsed || !parsed.categories) return [];
  const issues = [];

  parsed.categories.forEach((cat, catIdx) => {
    (cat.items || []).forEach((item, itemIdx) => {
      const rawMat = String(item.material || "").trim();
      if (rawMat.length < 2) return;

      const resultado = analisarItem(rawMat, item.unidade);

      // ── BLOQUEADO ──────────────────────────────────────────────
      if (resultado.type === "blocked") {
        issues.push({
          type: "blocked",
          catIdx, itemIdx,
          original: rawMat,
          item,
          reason: resultado.reason,
        });
        return;
      }

      // ── SPLIT ──────────────────────────────────────────────────
      if (resultado.type === "split") {
        issues.push({
          type: "split",
          catIdx, itemIdx,
          original: rawMat,
          item,
          splits: resultado.splits.map((s) => ({
            material: s,
            unidade: item.unidade || "",
          })),
          reason: resultado.splits.length + " itens diferentes na mesma linha",
        });
        return;
      }

      // ── ESCOLHA OBRIGATÓRIA ────────────────────────────────────
      if (resultado.type === "choose") {
        // Tenta sugerir pela unidade da planilha
        const unidHint = _sugestaoByUnidade(item.unidade, resultado.options);
        issues.push({
          type: "choose",
          catIdx, itemIdx,
          original: rawMat,
          item,
          options: resultado.options,
          suggested: unidHint || resultado.options[0] || null,
          hint: item.unidade ? `Unidade na planilha: "${item.unidade}"` : "",
          reason: resultado.reason,
        });
        return;
      }

      // ── RENAME ─────────────────────────────────────────────────
      if (resultado.type === "rename") {
        issues.push({
          type: "rename",
          catIdx, itemIdx,
          original: rawMat,
          item,
          suggested: resultado.corrected,
          reason: "📝 Padronização do nome",
        });
        return;
      }
    });
  });

  return issues;
}

// ── Tenta sugerir opção com base na unidade da planilha ───────────
function _sugestaoByUnidade(unidade, options) {
  if (!unidade || !options?.length) return null;
  const u = _rmac(unidade);

  // Leite
  if (/\bKG\b|\bPCT\b|\bSACO\b/.test(u)) {
    const p = options.find((o) => /PO/i.test(_rmac(o)));
    if (p) return p;
  }
  if (/\bL\b|\bML\b|\bLITRO\b|\bFRASCO\b/.test(u)) {
    const p = options.find((o) => /LIQUIDO/i.test(_rmac(o)));
    if (p) return p;
  }
  if (/\bLATA\b/.test(u)) {
    const p = options.find((o) => /CONDENSADO/i.test(_rmac(o)));
    if (p) return p;
  }

  // Clips
  if (/2\/0|PEQUENO/.test(u)) return options.find((o) => /2\/0/.test(o));
  if (/4\/0|MEDIO/.test(u)) return options.find((o) => /4\/0/.test(o));
  if (/8\/0|GRANDE/.test(u)) return options.find((o) => /8\/0/.test(o));

  // Sacos de lixo
  const litros = u.match(/(\d+)\s*L\b/);
  if (litros) {
    const vol = litros[1];
    return options.find((o) => o.includes(vol + "L")) || null;
  }

  // Copo
  if (/CAFE|CAFEZINHO|50ML|80ML/.test(u))
    return options.find((o) => /CAFE/i.test(o));
  if (/AGUA|150ML|180ML|200ML|250ML/.test(u))
    return options.find((o) => /AGUA/i.test(o));

  return null;
}

// ═══════════════════════════════════════════════════════════════════
// applyItemFixes — aplica as correções aceitas ao parsed
// ═══════════════════════════════════════════════════════════════════
function applyItemFixes(parsed, fixes) {
  if (!fixes?.length) return parsed;

  const sortedFixes = [...fixes].sort((a, b) => {
    if (a.catIdx !== b.catIdx) return b.catIdx - a.catIdx;
    return b.itemIdx - a.itemIdx;
  });

  let nextSplitId =
    Math.max(...parsed.categories.flatMap((c) => c.items.map((i) => i.id || 0))) + 100;

  sortedFixes.forEach((fix) => {
    if (!fix.accepted) return;
    const cat = parsed.categories[fix.catIdx];
    if (!cat) return;
    const item = cat.items[fix.itemIdx];
    if (!item) return;

    if (fix.type === "blocked") {
      // Remove o item bloqueado completamente
      cat.items.splice(fix.itemIdx, 1);

    } else if (fix.type === "split") {
      const baseUnid = item.unidade || "";
      const baseQs   = item.qtdSolicitada || "";
      const baseQa   = item.qtdAtendida || "";
      const baseSt   = item.status || "nao_atendido";

      cat.items.splice(fix.itemIdx, 1);
      fix.splits.forEach((sp, si) => {
        cat.items.splice(fix.itemIdx + si, 0, {
          id: nextSplitId++,
          material: sp.material,
          unidade: sp.unidade || baseUnid,
          qtdSolicitada: baseQs,
          qtdAtendida:   baseQa,
          status:        baseSt,
          tipo:          item.tipo,
          obs:           si === 0 ? item.obs || "" : "",
        });
      });

    } else if (fix.type === "rename") {
      item.material = fix.suggested;

    } else if (fix.type === "choose") {
      if (fix.chosen && fix.chosen !== "__skip__") {
        item.material = fix.chosen;
      }
    }
  });

  return parsed;
}

// ═══════════════════════════════════════════════════════════════════
// showPreRegDialog — exibe o modal de revisão
// ═══════════════════════════════════════════════════════════════════
function showPreRegDialog(issues, onConfirm, deps) {
  if (deps?.esc)   _esc   = deps.esc;
  if (deps?.toast) _toast = deps.toast;

  // Itens bloqueados são sempre aceitos automaticamente (remoção)
  issues.forEach((f) => {
    if      (f.type === "blocked") f.accepted = true;
    else if (f.type === "rename")  f.accepted = true;
    else if (f.type === "split")   f.accepted = false;
    else if (f.type === "choose") {
      f.accepted = !!f.suggested;
      f.chosen   = f.suggested || null;
    }
  });

  // Separa bloqueados dos outros (serão removidos automaticamente, sem mostrar no modal)
  const blockedIssues = issues.filter((f) => f.type === "blocked");
  const visibleIssues = issues.filter((f) => f.type !== "blocked");

  const nChoose = visibleIssues.filter((f) => f.type === "choose").length;

  // Banner de "auto-corrigidos" — preenchido por detectItemIssues
  const silentlyFixed = issues?._silentlyFixed || 0;

  // Se nada visível e nada bloqueado, finaliza direto sem abrir modal
  const visibleCount = (visibleIssues || []).length;
  if (visibleCount === 0 && blockedIssues.length === 0) {
    if (silentlyFixed > 0) {
      _toast?.(`✨ ${silentlyFixed} correção(ões) automática(s) aplicada(s).`, 'green');
    }
    onConfirm?.(true, []);
    return;
  }

  // ── HTML do modal ─────────────────────────────────────────────
  let h = '<div style="max-width:650px;margin:0 auto">';

  // Header
  h += `
    <div style="text-align:center;margin-bottom:16px">
      <div style="font-size:32px;margin-bottom:6px">🔍</div>
      <h2 style="font-size:16px;font-weight:800;margin:0">Revisão antes de Registrar</h2>
      ${silentlyFixed > 0 ? `
      <div style="display:inline-flex;align-items:center;gap:6px;background:#ecfdf5;
                  border:1px solid #a7f3d0;color:#065f46;border-radius:999px;
                  padding:4px 12px;margin-top:8px;font-size:11px;font-weight:700">
        ✨ ${silentlyFixed} correção(ões) automática(s) aplicada(s)
        <span style="font-weight:400;color:#047857">
          (acentos, maiúsc/minúsc, plural)
        </span>
      </div>` : ''}
      <p style="font-size:12px;color:#64748b;margin-top:4px">
        O sistema detectou ${visibleIssues.length} item(ns) que precisam da sua atenção
      </p>
      ${nChoose > 0 ? `<p style="font-size:11px;color:#b91c1c;margin-top:6px;font-weight:700">
        ⚠️ ${nChoose} item(ns) exigem ESCOLHA obrigatória antes de registrar</p>` : ""}
    </div>`;

  // Bloqueados — aviso automático
  if (blockedIssues.length) {
    h += `
      <div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:10px;
                  padding:12px 14px;margin-bottom:12px">
        <div style="font-size:11px;font-weight:800;color:#991b1b;margin-bottom:6px">
          🚫 ${blockedIssues.length} item(ns) bloqueado(s) — removido(s) automaticamente
        </div>`;
    blockedIssues.forEach((f) => {
      h += `<div style="font-size:12px;color:#7f1d1d;padding:2px 0">
        → <b>${_esc(f.original)}</b><br>
        <span style="font-size:10px;color:#991b1b">${_esc(f.reason)}</span>
      </div>`;
    });
    h += "</div>";
  }

  // Demais issues
  visibleIssues.forEach((fix, idx) => {
    const checkId = "preRegFix_" + idx;

    if (fix.type === "choose") {
      const qtdTxt = `${fix.item.qtdSolicitada || "?"} ${fix.item.unidade || ""}`;
      h += `
        <div class="pre-reg-choose" data-choose-idx="${idx}"
             style="background:#fff7ed;border:2px solid #fb923c;border-radius:10px;
                    padding:14px;margin-bottom:10px">
          <div style="font-size:10px;color:#9a3412;font-weight:800;margin-bottom:6px">
            🎯 ESCOLHA OBRIGATÓRIA
          </div>
          <div style="font-size:11px;color:#64748b;margin-bottom:6px">${_esc(fix.reason)}</div>
          <div style="background:#fff;border:1px solid #fed7aa;border-radius:6px;
                      padding:6px 10px;margin-bottom:10px">
            <span style="font-size:10px;color:#9a3412;font-weight:700">ITEM NA REQUISIÇÃO:</span>
            <span style="font-size:13px;font-weight:800;color:#0f172a"> ${_esc(fix.original)}</span>
            <span style="font-size:11px;color:#64748b"> (qtd: ${_esc(qtdTxt)})</span>
          </div>`;

      if (fix.hint) {
        h += `
          <div style="font-size:11px;color:#0369a1;background:#f0f9ff;border:1px solid #bae6fd;
                      border-radius:6px;padding:5px 10px;margin-bottom:8px">
            💡 ${_esc(fix.hint)}
            ${fix.suggested ? ` → sugestão: <b>${_esc(fix.suggested)}</b>` : ""}
          </div>`;
      }

      h += `<div style="font-size:11px;font-weight:700;color:#9a3412;margin-bottom:6px">
              Selecione UMA opção:</div>
            <div style="display:flex;flex-direction:column;gap:4px">`;

      fix.options.forEach((opt) => {
        const isSug  = fix.suggested === opt;
        const border = isSug ? "#10b981" : "#e2e8f0";
        const fw     = isSug ? "700" : "500";
        h += `
          <label style="display:flex;align-items:center;gap:8px;padding:7px 10px;
                         background:#fff;border:1.5px solid ${border};border-radius:6px;
                         cursor:pointer;font-size:12px;font-weight:${fw}">
            <input type="radio" name="choose_${idx}" value="${_esc(opt)}"
                   ${isSug ? "checked" : ""}
                   onchange="window.__preRegOnChoose(${idx}, this.value)"
                   style="margin:0">
            <span>${_esc(opt)}</span>
            ${isSug ? `<span style="margin-left:auto;font-size:9px;background:#d1fae5;
                              color:#065f46;padding:2px 6px;border-radius:4px;
                              font-weight:700">SUGERIDO</span>` : ""}
          </label>`;
      });

      // Opção "manter como está"
      h += `
        <label style="display:flex;align-items:center;gap:8px;padding:7px 10px;
                       background:#f1f5f9;border:1.5px dashed #cbd5e1;border-radius:6px;
                       cursor:pointer;font-size:11px;color:#64748b;margin-top:2px">
          <input type="radio" name="choose_${idx}" value="__skip__"
                 onchange="window.__preRegOnChoose(${idx}, this.value)" style="margin:0">
          <span>↪️ Manter como está (não corrigir agora)</span>
        </label>
        </div></div>`;

    } else if (fix.type === "split") {
      h += `
        <div style="background:#f8fafc;border:1.5px solid #94a3b8;border-radius:10px;
                    padding:12px;margin-bottom:10px">
          <div style="display:flex;align-items:flex-start;gap:8px">
            <input type="checkbox" id="${checkId}"
                   onchange="this.closest('[data-fix]').dataset.accepted=this.checked"
                   style="margin-top:3px;flex-shrink:0">
            <div style="flex:1" data-fix data-accepted="false">
              <div style="font-size:10px;color:#475569;font-weight:700;margin-bottom:4px">
                ✂️ SEPARAR ITEM
                <span style="font-weight:400;color:#94a3b8">
                  (desmarcado por padrão — marque somente se necessário)
                </span>
              </div>
              <div style="font-size:11px;color:#64748b;margin-bottom:6px">
                ${_esc(fix.reason)}
              </div>
              <div style="background:#dcfce7;border:1px solid #86efac;border-radius:6px;
                          padding:5px 10px;margin-bottom:6px;font-size:11px;color:#166534">
                ✅ <b>Quantidades copiadas:</b> cada item dividido recebe a mesma quantidade do original.
              </div>
              <div style="background:#fee2e2;border:1px solid #fecaca;border-radius:6px;
                          padding:6px 10px;margin-bottom:6px">
                <span style="font-size:9px;color:#991b1b;font-weight:700">ANTES:</span>
                <span style="font-size:12px;font-weight:700;color:#991b1b;
                             text-decoration:line-through">${_esc(fix.original)}</span>
                <span style="font-size:10px;color:#991b1b">
                  (${_esc(fix.item.qtdSolicitada || "?")} ${_esc(fix.item.unidade || "")})
                </span>
              </div>
              <div style="background:#d1fae5;border:1px solid #a7f3d0;border-radius:6px;
                          padding:6px 10px">
                <span style="font-size:9px;color:#065f46;font-weight:700">DEPOIS:</span>
                ${fix.splits
                  .map(
                    (sp, si) =>
                      `<div style="font-size:12px;font-weight:700;color:#065f46;
                                   margin-top:${si ? 3 : 2}px">→ ${_esc(sp.material)}</div>`
                  )
                  .join("")}
              </div>
            </div>
          </div>
        </div>`;

    } else if (fix.type === "rename") {
      h += `
        <div style="background:#fefce8;border:1px solid #fde047;border-radius:10px;
                    padding:12px;margin-bottom:10px">
          <div style="display:flex;align-items:flex-start;gap:8px">
            <input type="checkbox" id="${checkId}" checked
                   onchange="this.closest('[data-fix]').dataset.accepted=this.checked"
                   style="margin-top:3px;flex-shrink:0">
            <div style="flex:1" data-fix data-accepted="true">
              <div style="font-size:10px;color:#92400e;font-weight:700;margin-bottom:4px">
                📝 PADRONIZAR NOME
              </div>
              <div style="font-size:11px;color:#64748b;margin-bottom:4px">${_esc(fix.reason)}</div>
              <span style="font-size:12px;color:#991b1b;text-decoration:line-through">
                ${_esc(fix.original)}
              </span>
              →
              <span style="font-size:12px;font-weight:700;color:#065f46">
                ${_esc(fix.suggested)}
              </span>
            </div>
          </div>
        </div>`;
    }
  });

  // Botões
  h += `
    <div style="display:flex;gap:8px;justify-content:center;margin-top:16px">
      <button class="btn btn-s" onclick="closePreRegDialog()" style="display:inline-flex;align-items:center;gap:4px"><i data-lucide="x"></i> Cancelar</button>
      <button class="btn btn-s" onclick="skipPreRegDialog()" style="display:inline-flex;align-items:center;gap:4px"><i data-lucide="skip-forward"></i> Ignorar e Registrar</button>
      <button class="btn btn-p" id="btnConfirmPreReg" onclick="confirmPreRegDialog()" style="display:inline-flex;align-items:center;gap:4px">
        <i data-lucide="check-circle"></i> Aplicar e Registrar
      </button>
    </div>
  </div>`;

  // ── Monta no modal existente ────────────────────────────────────
  const modal   = document.getElementById("fichaModal");
  const toolbar = modal?.querySelector(".modal-toolbar");
  const legend  = document.getElementById("fichaModalLegend");
  const actions = document.getElementById("fichaModalActions");
  const body    = document.getElementById("fichaBody");
  const stats   = document.getElementById("fichaStats");

  if (toolbar) toolbar.querySelector(".title").innerHTML = '<i data-lucide="search"></i> Revisão de Itens';
  if (stats)   stats.innerHTML   = "";
  if (actions) actions.style.display = "none";
  if (legend)  legend.style.display  = "none";
  body.innerHTML = `<div style="padding:20px">${h}</div>`;
  modal.classList.add("open");

  // Handlers globais
  window.__preRegOnChoose = (idx, value) => {
    const issue = window._preRegIssues?.[idx];
    if (!issue) return;
    issue.chosen   = value;
    issue.accepted = value !== "__skip__";
    const container = document.querySelector(`[data-choose-idx="${idx}"]`);
    container?.querySelectorAll("label").forEach((lb) => {
      const inp = lb.querySelector('input[type="radio"]');
      const checked = inp?.checked;
      lb.style.borderColor = checked
        ? inp.value === "__skip__" ? "#64748b" : "#10b981"
        : "#e2e8f0";
      lb.style.fontWeight = checked ? "700" : "500";
    });
    window.__validatePreReg?.();
  };

  window.__validatePreReg = () => {
    const btn     = document.getElementById("btnConfirmPreReg");
    if (!btn) return;
    const pending = (window._preRegIssues || []).filter(
      (f) => f.type === "choose" && !f.chosen
    );
    btn.disabled       = pending.length > 0;
    btn.style.opacity  = pending.length ? "0.5" : "";
    btn.style.cursor   = pending.length ? "not-allowed" : "";
    btn.innerHTML      = pending.length
      ? `<i data-lucide="alert-triangle"></i> Escolha ${pending.length} item(ns) para continuar`
      : '<i data-lucide="check-circle"></i> Aplicar e Registrar';
  };

  window._preRegIssues   = issues; // inclui blocked (já aceitos)
  window._preRegCallback = onConfirm;
  setTimeout(() => {
    window.__validatePreReg?.();
    try { if (typeof lucide !== 'undefined' && lucide.createIcons) lucide.createIcons(); } catch (_) {}
  }, 50);
}

// ── Fechar / Pular / Confirmar ─────────────────────────────────────
function closePreRegDialog() {
  document.getElementById("fichaModal")?.classList.remove("open");
  window._preRegIssues   = null;
  window._preRegCallback = null;
}

function skipPreRegDialog() {
  document.getElementById("fichaModal")?.classList.remove("open");
  const cb = window._preRegCallback;
  window._preRegIssues   = null;
  window._preRegCallback = null;
  cb?.(false);
}

function confirmPreRegDialog() {
  const issues  = window._preRegIssues || [];
  const unchosen = issues.filter((f) => f.type === "choose" && !f.chosen);
  if (unchosen.length) {
    _toast(`⚠️ Escolha uma opção para ${unchosen.length} item(ns) destacado(s) em laranja.`, "red");
    unchosen.forEach((u) => {
      const el = document.querySelector(`[data-choose-idx="${issues.indexOf(u)}"]`);
      if (el) {
        el.style.animation  = "none";
        void el.offsetHeight;
        el.style.animation  = "shakeOnce .4s ease";
        el.style.boxShadow  = "0 0 0 3px rgba(249,115,22,.3)";
      }
    });
    return;
  }

  // Lê checkboxes de split/rename
  issues.forEach((fix, idx) => {
    if (fix.type === "split" || fix.type === "rename") {
      const cb = document.getElementById("preRegFix_" + idx);
      fix.accepted = cb ? cb.checked : fix.accepted;
    }
  });

  document.getElementById("fichaModal")?.classList.remove("open");
  const cb = window._preRegCallback;
  window._preRegIssues   = null;
  window._preRegCallback = null;
  cb?.(true, issues);
}

export {
  detectItemIssues,
  applyItemFixes,
  showPreRegDialog,
  closePreRegDialog,
  skipPreRegDialog,
  confirmPreRegDialog,
};
