let _esc = (v) => String(v ?? "");
let _toast = () => {};

function applyItemFixes(parsed, fixes) {
  if (!fixes || !fixes.length) return parsed;

  const sortedFixes = [...fixes].sort((a, b) => {
    if (a.catIdx !== b.catIdx) return b.catIdx - a.catIdx;
    return b.itemIdx - a.itemIdx;
  });

  let nextSplitId = Math.max(...parsed.categories.flatMap((c) => c.items.map((i) => i.id || 0))) + 100;

  sortedFixes.forEach((fix) => {
    if (!fix.accepted) return;
    const cat = parsed.categories[fix.catIdx];
    if (!cat) return;
    const item = cat.items[fix.itemIdx];
    if (!item) return;

    if (fix.type === "split") {
      const baseUnid = item.unidade || "";
      const baseStatus = item.status || "nao_atendido";
      const baseQs = item.qtdSolicitada || "";
      const baseQa = item.qtdAtendida || "";

      cat.items.splice(fix.itemIdx, 1);
      fix.splits.forEach((sp, si) => {
        cat.items.splice(fix.itemIdx + si, 0, {
          id: nextSplitId++,
          material: sp.material,
          unidade: sp.unidade || baseUnid,
          qtdSolicitada: baseQs,
          qtdAtendida: baseQa,
          status: baseStatus,
          tipo: item.tipo,
          obs: si === 0 ? item.obs || "" : ""
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

function showPreRegDialog(issues, onConfirm, deps) {
  if (deps?.esc) _esc = deps.esc;
  if (deps?.toast) _toast = deps.toast;

  issues.forEach((f) => {
    if (f.type === "rename") f.accepted = true;
    else if (f.type === "split") f.accepted = false;
    else if (f.type === "choose") {
      f.accepted = !!f.suggested;
      f.chosen = f.suggested || null;
    }
  });

  const nChoose = issues.filter((f) => f.type === "choose").length;

  let h = '<div style="max-width:650px;margin:0 auto">';
  h +=
    '<div style="text-align:center;margin-bottom:16px">' +
    '<div style="font-size:32px;margin-bottom:6px">🔍</div>' +
    '<h2 style="font-size:16px;font-weight:800;margin:0">Revisão antes de Registrar</h2>' +
    '<p style="font-size:12px;color:#64748b;margin-top:4px">O sistema detectou ' +
    issues.length +
    " item(ns) que precisam da sua atenção</p>" +
    (nChoose > 0
      ? '<p style="font-size:11px;color:#b91c1c;margin-top:6px;font-weight:700">⚠️ ' +
        nChoose +
        " item(ns) exigem ESCOLHA obrigatória antes de registrar</p>"
      : "") +
    "</div>";

  issues.forEach((fix, idx) => {
    const checkId = "preRegFix_" + idx;

    if (fix.type === "choose") {
      const qtdTxt = (fix.item.qtdSolicitada || "?") + " " + (fix.item.unidade || "");
      h +=
        '<div class="pre-reg-choose" data-choose-idx="' +
        idx +
        '" style="background:#fff7ed;border:2px solid #fb923c;border-radius:10px;padding:14px;margin-bottom:10px">' +
        '<div style="font-size:10px;color:#9a3412;font-weight:800;margin-bottom:6px">🎯 ESCOLHA OBRIGATÓRIA</div>' +
        '<div style="font-size:11px;color:#64748b;margin-bottom:6px">' +
        _esc(fix.reason) +
        "</div>" +
        '<div style="background:#fff;border:1px solid #fed7aa;border-radius:6px;padding:6px 10px;margin-bottom:10px">' +
        '<span style="font-size:10px;color:#9a3412;font-weight:700">ITEM NA REQUISIÇÃO:</span> ' +
        '<span style="font-size:13px;font-weight:800;color:#0f172a">' +
        _esc(fix.original) +
        "</span>" +
        ' <span style="font-size:11px;color:#64748b">(qtd: ' +
        _esc(qtdTxt) +
        ")</span>" +
        "</div>";

      if (fix.hint) {
        h +=
          '<div style="font-size:11px;color:#0369a1;background:#f0f9ff;border:1px solid #bae6fd;border-radius:6px;padding:5px 10px;margin-bottom:8px">' +
          "💡 " +
          _esc(fix.hint) +
          (fix.suggested ? " → sugestão: <b>" + _esc(fix.suggested) + "</b>" : "") +
          "</div>";
      }

      h += '<div style="font-size:11px;font-weight:700;color:#9a3412;margin-bottom:6px">Selecione UMA opção:</div>';
      h += '<div style="display:flex;flex-direction:column;gap:4px">';
      fix.options.forEach((opt) => {
        const isSug = fix.suggested === opt;
        const checked = isSug ? "checked" : "";
        h +=
          '<label style="display:flex;align-items:center;gap:8px;padding:7px 10px;background:#fff;border:1.5px solid ' +
          (isSug ? "#10b981" : "#e2e8f0") +
          ';border-radius:6px;cursor:pointer;font-size:12px;font-weight:' +
          (isSug ? "700" : "500") +
          '">' +
          '<input type="radio" name="choose_' +
          idx +
          '" value="' +
          _esc(opt) +
          '" ' +
          checked +
          " onchange=\"window.__preRegOnChoose(" +
          idx +
          ', this.value)" style="margin:0">' +
          "<span>" +
          _esc(opt) +
          "</span>" +
          (isSug
            ? '<span style="margin-left:auto;font-size:9px;background:#d1fae5;color:#065f46;padding:2px 6px;border-radius:4px;font-weight:700">SUGERIDO</span>'
            : "") +
          "</label>";
      });
      h +=
        '<label style="display:flex;align-items:center;gap:8px;padding:7px 10px;background:#f1f5f9;border:1.5px dashed #cbd5e1;border-radius:6px;cursor:pointer;font-size:11px;color:#64748b;margin-top:2px">' +
        '<input type="radio" name="choose_' +
        idx +
        '" value="__skip__" onchange="window.__preRegOnChoose(' +
        idx +
        ', this.value)" style="margin:0">' +
        "<span>↪️ Manter como está (não corrigir agora)</span>" +
        "</label>";
      h += "</div></div>";
    } else if (fix.type === "split") {
      h +=
        '<div style="background:#f8fafc;border:1.5px solid #94a3b8;border-radius:10px;padding:12px;margin-bottom:10px">' +
        '<div style="display:flex;align-items:flex-start;gap:8px">' +
        '<input type="checkbox" id="' +
        checkId +
        `" onchange="this.closest('[data-fix]').dataset.accepted=this.checked" style="margin-top:3px;flex-shrink:0">` +
        '<div style="flex:1" data-fix data-accepted="false">' +
        '<div style="font-size:10px;color:#475569;font-weight:700;margin-bottom:4px">✂️ SEPARAR ITEM <span style="font-weight:400;color:#94a3b8">(desmarcado por padrão — marque somente se necessário)</span></div>' +
        '<div style="font-size:11px;color:#64748b;margin-bottom:6px">' +
        _esc(fix.reason) +
        "</div>" +
        '<div style="background:#dcfce7;border:1px solid #86efac;border-radius:6px;padding:5px 10px;margin-bottom:6px;font-size:11px;color:#166534">' +
        "✅ <b>Quantidades copiadas:</b> cada item dividido receberá a mesma quantidade do original (ex.: qtd 5 → 5 em cada)." +
        "</div>" +
        '<div style="background:#fee2e2;border:1px solid #fecaca;border-radius:6px;padding:6px 10px;margin-bottom:6px">' +
        '<span style="font-size:9px;color:#991b1b;font-weight:700">ANTES:</span> ' +
        '<span style="font-size:12px;font-weight:700;color:#991b1b;text-decoration:line-through">' +
        _esc(fix.original) +
        "</span>" +
        ' <span style="font-size:10px;color:#991b1b">(' +
        _esc(fix.item.qtdSolicitada || "?") +
        " " +
        _esc(fix.item.unidade || "") +
        ")</span>" +
        "</div>" +
        '<div style="background:#d1fae5;border:1px solid #a7f3d0;border-radius:6px;padding:6px 10px">' +
        '<span style="font-size:9px;color:#065f46;font-weight:700">DEPOIS:</span>';

      fix.splits.forEach((sp, si) => {
        h +=
          '<div style="font-size:12px;font-weight:700;color:#065f46;margin-top:' +
          (si ? "3" : "2") +
          'px">→ ' +
          _esc(sp.material) +
          "</div>";
      });

      h += "</div></div></div></div>";
    } else if (fix.type === "rename") {
      h +=
        '<div style="background:#fefce8;border:1px solid #fde047;border-radius:10px;padding:12px;margin-bottom:10px">' +
        '<div style="display:flex;align-items:flex-start;gap:8px">' +
        '<input type="checkbox" id="' +
        checkId +
        `" checked onchange="this.closest('[data-fix]').dataset.accepted=this.checked" style="margin-top:3px;flex-shrink:0">` +
        '<div style="flex:1" data-fix data-accepted="true">' +
        '<div style="font-size:10px;color:#92400e;font-weight:700;margin-bottom:4px">📝 PADRONIZAR NOME</div>' +
        '<div style="font-size:11px;color:#64748b;margin-bottom:4px">' +
        _esc(fix.reason) +
        "</div>" +
        '<span style="font-size:12px;color:#991b1b;text-decoration:line-through">' +
        _esc(fix.original) +
        "</span>" +
        ' → <span style="font-size:12px;font-weight:700;color:#065f46">' +
        _esc(fix.suggested) +
        "</span>" +
        "</div></div></div>";
    }
  });

  h +=
    '<div style="display:flex;gap:8px;justify-content:center;margin-top:16px">' +
    '<button class="btn btn-s" onclick="closePreRegDialog()">Cancelar</button>' +
    '<button class="btn btn-s" onclick="skipPreRegDialog()">Ignorar e Registrar</button>' +
    '<button class="btn btn-p" id="btnConfirmPreReg" onclick="confirmPreRegDialog()">✅ Aplicar e Registrar</button>' +
    "</div></div>";

  const modal = document.getElementById("fichaModal");
  const toolbar = modal.querySelector(".modal-toolbar");
  const legend = document.getElementById("fichaModalLegend");
  const actions = document.getElementById("fichaModalActions");
  const body = document.getElementById("fichaBody");
  const stats = document.getElementById("fichaStats");

  if (toolbar) toolbar.querySelector(".title").textContent = "🔍 Revisão de Itens";
  if (stats) stats.innerHTML = "";
  if (actions) actions.style.display = "none";
  if (legend) legend.style.display = "none";
  body.innerHTML = '<div style="padding:20px">' + h + "</div>";
  modal.classList.add("open");

  window.__preRegOnChoose = function (idx, value) {
    const is = window._preRegIssues && window._preRegIssues[idx];
    if (!is) return;
    is.chosen = value;
    is.accepted = value !== "__skip__";
    const container = document.querySelector('[data-choose-idx="' + idx + '"]');
    if (container) {
      container.querySelectorAll("label").forEach((lb) => {
        const input = lb.querySelector('input[type="radio"]');
        const isChecked = input && input.checked;
        lb.style.borderColor = isChecked ? (input.value === "__skip__" ? "#64748b" : "#10b981") : "#e2e8f0";
        lb.style.fontWeight = isChecked ? "700" : "500";
      });
    }
    window.__validatePreReg && window.__validatePreReg();
  };

  window.__validatePreReg = function () {
    const btn = document.getElementById("btnConfirmPreReg");
    if (!btn) return;
    const pending = (window._preRegIssues || []).filter((f) => f.type === "choose" && (!f.chosen || f.chosen === null));
    if (pending.length > 0) {
      btn.disabled = true;
      btn.style.opacity = "0.5";
      btn.style.cursor = "not-allowed";
      btn.innerHTML = "⚠️ Escolha " + pending.length + " item(ns) para continuar";
    } else {
      btn.disabled = false;
      btn.style.opacity = "";
      btn.style.cursor = "";
      btn.innerHTML = "✅ Aplicar e Registrar";
    }
  };

  window._preRegIssues = issues;
  window._preRegCallback = onConfirm;

  setTimeout(() => window.__validatePreReg && window.__validatePreReg(), 50);
}

function closePreRegDialog() {
  document.getElementById("fichaModal").classList.remove("open");
  window._preRegIssues = null;
  window._preRegCallback = null;
}

function skipPreRegDialog() {
  document.getElementById("fichaModal").classList.remove("open");
  const cb = window._preRegCallback;
  window._preRegIssues = null;
  window._preRegCallback = null;
  if (cb) cb(false);
}

function confirmPreRegDialog() {
  const issues = window._preRegIssues || [];
  const unchosen = issues.filter((f) => f.type === "choose" && (!f.chosen || f.chosen === null));
  if (unchosen.length > 0) {
    _toast("⚠️ Escolha uma opção para " + unchosen.length + " item(ns) destacado(s) em laranja.", "red");
    unchosen.forEach((u) => {
      const el = document.querySelector('[data-choose-idx="' + issues.indexOf(u) + '"]');
      if (el) {
        el.style.animation = "none";
        void el.offsetHeight;
        el.style.animation = "shakeOnce .4s ease";
        el.style.boxShadow = "0 0 0 3px rgba(249, 115, 22, .3)";
      }
    });
    return;
  }

  issues.forEach((fix, idx) => {
    if (fix.type === "split" || fix.type === "rename") {
      const cb = document.getElementById("preRegFix_" + idx);
      fix.accepted = cb ? cb.checked : false;
    }
  });

  document.getElementById("fichaModal").classList.remove("open");
  const cb = window._preRegCallback;
  window._preRegIssues = null;
  window._preRegCallback = null;
  if (cb) cb(true, issues);
}

export { applyItemFixes, showPreRegDialog, closePreRegDialog, skipPreRegDialog, confirmPreRegDialog };
