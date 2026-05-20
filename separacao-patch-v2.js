// ═══════════════════════════════════════════════════════════════════
// PATCH v2 — Seletor de Unidade (separacao.js)
// Aplique as três mudanças abaixo em ordem
// ═══════════════════════════════════════════════════════════════════


// ───────────────────────────────────────────────────────────────────
// MUDANÇA 1 — populateUnidadesSelect
// Substitua a função INTEIRA pela versão abaixo.
// Remove: opção fantasma (optKeep). Adiciona: ícone + contagem no optgroup.
// ───────────────────────────────────────────────────────────────────
function populateUnidadesSelect() {
  const sel = document.getElementById("rU");
  if (!sel) return;

  const TYPE_ICON = {
    SEDE: "🏛️", CT: "🏫", CRAS: "🏠", CREAS: "🏢",
    POP: "🤝",  ABRIGO: "🛏️", OUTROS: "📍",
  };

  const q = rmAcc(String(__rUFilterText || "")).toUpperCase().replace(/\s+/g, " ").trim();
  const unidades = (getUnidades() || [])
    .filter((u) => (u?.atendeMateriais ?? true) === true)
    .filter((u) => {
      if (!q) return true;
      const nome  = String(u?.nome || u?.unidadeNome || "").trim();
      const sigla = String(u?.sigla || "").trim();
      const hay   = rmAcc(`${nome} ${sigla}`).toUpperCase().replace(/\s+/g, " ").trim();
      return hay.includes(q);
    });

  const previous = sel.value || "";

  sel.innerHTML = "";
  const opt0 = document.createElement("option");
  opt0.value = "";
  opt0.textContent = "— Selecione uma unidade —";
  sel.appendChild(opt0);

  if (!unidades.length) {
    const optNF      = document.createElement("option");
    optNF.value      = "";
    optNF.textContent = q ? "— Nenhuma unidade encontrada —" : "— Sem unidades cadastradas —";
    optNF.disabled   = true;
    sel.appendChild(optNF);
    return;
  }

  // Agrupa por tipo e ordena
  const groups = new Map();
  for (const u of unidades) {
    const nome = String(u?.nome || u?.unidadeNome || "").trim();
    if (!nome) continue;
    let tipo = String(u?.tipoUnidade || u?.tipo || "OUTROS").trim().toUpperCase();
    if (tipo === "SEMCAS") tipo = "SEDE";
    if (!groups.has(tipo)) groups.set(tipo, []);
    groups.get(tipo).push({ nome, sigla: String(u?.sigla || "").trim() });
  }
  for (const arr of groups.values())
    arr.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  const tiposOrdenados = [...groups.keys()].sort((a, b) => a.localeCompare(b, "pt-BR"));

  for (const tipo of tiposOrdenados) {
    const arr  = groups.get(tipo);
    const icon = TYPE_ICON[tipo] || "📍";
    const og   = document.createElement("optgroup");
    og.label   = `${icon} ${tipo} (${arr.length})`;           // ← ícone + contagem
    for (const { nome, sigla } of arr) {
      const opt      = document.createElement("option");
      opt.value      = nome;
      opt.textContent = sigla ? `${nome}  [${sigla}]` : nome;
      og.appendChild(opt);
    }
    sel.appendChild(og);
  }

  // ── Restaura seleção SOMENTE se o valor existir no cadastro ──────
  // NÃO cria opção fantasma se o valor não existir.
  if (previous) {
    const match = [...sel.options].find((o) => o.value === previous);
    if (match) sel.value = previous;
    // sem else → valor desconhecido volta para default sem criar fantasma
  }
}


// ───────────────────────────────────────────────────────────────────
// MUDANÇA 2 — buildUnitQuickPick  (NOVA função)
// Adicione esta função antes de populateUnidadesSelect.
// Gera chips de seleção rápida coloridos por tipo.
// ───────────────────────────────────────────────────────────────────
function buildUnitQuickPick(rawUnitName, maxSugs = 8) {
  const sugs = _suggestUnits(rawUnitName || "", maxSugs);
  if (!sugs.length) return "";

  const unidades = getUnidades() || [];
  const TYPE_COLOR = {
    SEDE: "#6366f1", CT: "#06b6d4", CRAS: "#3b82f6", CREAS: "#8b5cf6",
    POP: "#14b8a6",  ABRIGO: "#ef4444", OUTROS: "#64748b",
  };
  const TYPE_ICON = {
    SEDE: "🏛️", CT: "🏫", CRAS: "🏠", CREAS: "🏢",
    POP: "🤝",  ABRIGO: "🛏️", OUTROS: "📍",
  };

  const getInfo = (nome) => {
    const u = unidades.find((x) =>
      String(x?.nome || "").toLowerCase() === String(nome || "").toLowerCase()
    );
    let tipo = String(u?.tipoUnidade || u?.tipo || "OUTROS").toUpperCase();
    if (tipo === "SEMCAS") tipo = "SEDE";
    return { icon: TYPE_ICON[tipo] || "📍", color: TYPE_COLOR[tipo] || "#64748b" };
  };

  const chips = sugs.map((n) => {
    const { icon, color } = getInfo(n);
    const safeName = esc(n).replace(/'/g, "\\'");
    return `<button type="button"
      onclick="pickSuggestedUnit('${safeName}')"
      style="display:inline-flex;align-items:center;gap:5px;padding:4px 10px;
             border:0.5px solid ${color}40;background:${color}10;color:var(--color-text-primary, #0f172a);
             border-radius:20px;font-size:11px;font-weight:600;cursor:pointer;
             font-family:inherit;white-space:nowrap;transition:.15s"
      onmouseover="this.style.background='${color}25';this.style.borderColor='${color}80'"
      onmouseout="this.style.background='${color}10';this.style.borderColor='${color}40'"
    >${icon} ${esc(n)}</button>`;
  }).join("");

  const titleTxt = rawUnitName
    ? `Sugestões para "${esc(rawUnitName.slice(0, 35))}${rawUnitName.length > 35 ? "…" : ""}"`
    : "Seleção rápida";

  return `<div style="margin-top:8px">
    <div style="font-size:10px;font-weight:700;color:#64748b;
                text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">
      ${titleTxt}
    </div>
    <div style="display:flex;flex-wrap:wrap;gap:5px">${chips}</div>
  </div>`;
}


// ───────────────────────────────────────────────────────────────────
// MUDANÇA 3 — dentro de handleFile
// Localize o bloco  try { const warnEl = document.getElementById('rUWarn'); ...
// e substitua APENAS o conteúdo do if(isUnknown || !found){ ... }
// ───────────────────────────────────────────────────────────────────

// Substitua este trecho existente:
//
//   if (isUnknown || !found) {
//     const sugg = _suggestUnits(__lastDetectedRawUnit, 5);
//     const chips = sugg.length ? `...` : '';
//     warnEl.style.display = 'block';
//     warnEl.innerHTML = `⚠️ Unidade não identificada. Selecione manualmente.${chips}`;
//     warnEl.querySelectorAll('button[data-sug]').forEach(btn => { ... });
//   } else {
//     warnEl.style.display = 'none';
//     warnEl.innerHTML = '...';
//   }
//
// Por este:

/*
  if (isUnknown || !found) {
    warnEl.style.display = 'block';
    warnEl.innerHTML = `
      <div style="display:flex;align-items:flex-start;gap:7px;margin-bottom:8px">
        <span style="font-size:15px;flex-shrink:0">⚠️</span>
        <div>
          <b style="color:#92400e;font-size:12px;display:block;margin-bottom:2px">
            Unidade não identificada automaticamente.
          </b>
          <span style="font-size:11px;color:#78350f">
            Use o campo de busca acima, o dropdown, ou clique numa sugestão:
          </span>
        </div>
      </div>
      ${buildUnitQuickPick(__lastDetectedRawUnit, 8)}
    `;
  } else {
    warnEl.style.display = 'none';
    warnEl.innerHTML = '';
  }
*/


// ───────────────────────────────────────────────────────────────────
// MUDANÇA 4 — adicione campo de busca no HTML (index.html / template)
// Localize o label da unidade no formulário de requisição e adicione
// um input de busca logo acima do <select id="rU">:
// ───────────────────────────────────────────────────────────────────

/*
  <!-- Antes do <select id="rU"> -->
  <div style="position:relative;margin-bottom:4px">
    <input
      type="search"
      id="rUSearch"
      placeholder="Buscar unidade..."
      autocomplete="off"
      oninput="filterUnidadesSelect()"
      style="width:100%;height:34px;border:0.5px solid var(--border,#e2e8f0);
             border-radius:8px;padding:0 10px;font-size:13px;
             background:var(--surface,#fff);color:inherit;outline:none"
      aria-label="Filtrar lista de unidades"
    >
  </div>
  <!-- O <select id="rU"> já existe — mantém como está -->
*/
