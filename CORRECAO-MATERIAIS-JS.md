# CORREÇÃO EXATA — materiais.js

## PROBLEMA 1: Ficha aparece inline (feio e quebrado)
A função `openFichaInline()` (linha 447) cria um div escondido dentro do "Em Separação" e mostra a ficha ali embaixo. Isso fica horrível porque:
- A ficha estica para a largura da página
- Fica abaixo da tabela de separação
- Difícil de editar e visualizar

## PROBLEMA 2: Bug de HTML — duas `<tr>` por item
Na linha 576-577 do `buildFichaHTML`, tem:
```html
<tr data-item-id="${m.id}">
<tr class="${rowClass(m.status)}" data-id="${m.id}">
```
Isso gera DUAS linhas por item, quebrando toda a tabela.

## PROBLEMA 3: CSS da ficha não existe no style.css
O `style.css` do sistema não tem as classes `.ficha-a4`, `.ficha-table`, `.badge-status`, etc.

---

## CORREÇÃO 1: Substituir `openFichaInline()` por modal fullscreen

### No `materiais.js`, DELETAR a função `openFichaInline()` inteira (linhas 447-468):
```javascript
// DELETAR TUDO ISSO:
function openFichaInline() {
    const host = document.getElementById("subview-em-separacao");
    // ... todo o conteúdo ...
}
```

### SUBSTITUIR por esta nova função:
```javascript
function openFichaModal() {
    if (document.getElementById("fichaModal")) return;
    const modal = document.createElement("div");
    modal.id = "fichaModal";
    modal.style.cssText = "display:none;position:fixed;inset:0;z-index:9999;background:rgba(2,6,23,.7);backdrop-filter:blur(4px);overflow-y:auto;padding:20px";
    modal.innerHTML = `
        <div style="max-width:850px;margin:0 auto">
            <div style="background:#0f172a;padding:10px 16px;border-radius:10px;margin-bottom:12px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;position:sticky;top:0;z-index:10">
                <span id="fichaModalTitle" style="color:#f8fafc;font-weight:700;font-size:13px">📋 Ficha</span>
                <div id="fichaModalStats" style="display:flex;gap:4px;font-size:11px"></div>
                <div style="margin-left:auto;display:flex;gap:8px">
                    <button id="fichaModalPrint" style="padding:6px 14px;background:#fff;color:#0f172a;border:none;border-radius:7px;font-size:12px;font-weight:700;cursor:pointer">🖨️ Imprimir</button>
                    <button id="fichaModalPronto" style="padding:6px 14px;background:linear-gradient(135deg,#10b981,#059669);color:#fff;border:none;border-radius:7px;font-size:12px;font-weight:700;cursor:pointer">✅ Pronto p/ Entrega</button>
                    <button id="fichaModalClose" style="padding:6px 14px;background:#334155;color:#e2e8f0;border:none;border-radius:7px;font-size:12px;font-weight:700;cursor:pointer">✕ Fechar</button>
                </div>
            </div>
            <div style="display:flex;gap:6px;align-items:center;margin-bottom:10px;font-size:10px;color:#64748b;flex-wrap:wrap">
                <b>Clique no status:</b>
                <span class="badge-status badge-nao_atendido" style="cursor:default">Não Atendido</span> →
                <span class="badge-status badge-atendido" style="cursor:default">Atendido</span> →
                <span class="badge-status badge-parcial" style="cursor:default">Parcial</span> →
                <span class="badge-status badge-sem_estoque" style="cursor:default">Sem Estoque</span>
            </div>
            <div id="fichaModalBody" class="ficha-a4"></div>
        </div>`;
    document.body.appendChild(modal);

    document.getElementById("fichaModalClose").addEventListener("click", () => {
        modal.style.display = "none";
        fichaEntregaId = null;
    });
    document.getElementById("fichaModalPrint").addEventListener("click", () => printFichaAtual());
    document.getElementById("fichaModalPronto").addEventListener("click", async () => {
        const req = getFluxoV2Entregas().find(r => r.id === fichaEntregaId);
        if (!req) return;
        await updateDoc(reqDocRef(req), {
            status: "pronto",
            itens: (req.itens || []).map(i => i.status === "nao_atendido" ? { ...i, status: "atendido" } : i),
            dataRetirada: serverTimestamp()
        });
        modal.style.display = "none";
        fichaEntregaId = null;
        showAlert("alert-em-separacao", "Movido para Pronto p/ Entrega.", "success");
    });
    // Fechar ao clicar fora
    modal.addEventListener("click", (e) => {
        if (e.target === modal) { modal.style.display = "none"; fichaEntregaId = null; }
    });
    // Fechar com Escape
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && modal.style.display !== "none") {
            modal.style.display = "none"; fichaEntregaId = null;
        }
    });
}
```

## CORREÇÃO 2: Substituir `abrirFicha()` (linha 526)

### DELETAR a função `abrirFicha()` inteira e SUBSTITUIR por:
```javascript
function abrirFicha(id) {
    fichaEntregaId = id;
    const req = getFluxoV2Entregas().find(r => r.id === id);
    if (!req) return;

    openFichaModal();
    const modal = document.getElementById("fichaModal");
    const body = document.getElementById("fichaModalBody");
    const title = document.getElementById("fichaModalTitle");
    const stats = document.getElementById("fichaModalStats");
    if (!modal || !body) return;

    title.textContent = `📋 ${req.unidade || "Unidade"} — ${req.separador || "-"}`;
    body.innerHTML = buildFichaHTML(req);
    modal.style.display = "block";

    // Atualizar stats
    const itens = req.itens || [];
    const ok = itens.filter(i => i.status === "atendido").length;
    const pa = itens.filter(i => i.status === "parcial").length;
    const se = itens.filter(i => i.status === "sem_estoque").length;
    const na = itens.filter(i => i.status === "nao_atendido").length;
    stats.innerHTML = `
        <span style="padding:3px 8px;border-radius:5px;font-weight:600;background:#1e293b;color:#94a3b8">Total: <b>${itens.length}</b></span>
        <span style="padding:3px 8px;border-radius:5px;font-weight:600;background:#052e16;color:#86efac">✓ ${ok}</span>
        <span style="padding:3px 8px;border-radius:5px;font-weight:600;background:#451a03;color:#fcd34d">◐ ${pa}</span>
        <span style="padding:3px 8px;border-radius:5px;font-weight:600;background:#450a0a;color:#fca5a5">✗ ${se}</span>
        <span style="padding:3px 8px;border-radius:5px;font-weight:600;background:#2e1065;color:#c4b5fd">⊘ ${na}</span>`;

    // Vincular eventos nos inputs e badges
    body.querySelectorAll("tr[data-id]").forEach(row => {
        const itemId = Number(row.getAttribute("data-id"));
        const qty = row.querySelector(".ficha-input-qty");
        const st = row.querySelector(".badge-status");
        const obs = row.querySelector(".ficha-input-obs");
        qty?.addEventListener("change", () => updateFichaItem(itemId, { qtdAtendida: qty.value }, true));
        st?.addEventListener("click", () => cycleFichaStatus(itemId));
        obs?.addEventListener("change", () => updateFichaItem(itemId, { obs: obs.value }, false));
    });
}
```

## CORREÇÃO 3: Corrigir o bug das duas `<tr>` no `buildFichaHTML()`

### Na linha 576-577, SUBSTITUIR:
```javascript
// ERRADO (gera 2 <tr> por item):
<tr data-item-id="${m.id}">
<tr class="${rowClass(m.status)}" data-id="${m.id}">
```

### POR (apenas UMA `<tr>`):
```javascript
<tr class="${rowClass(m.status)}" data-id="${m.id}">
```

### Código completo corrigido da seção `list.map()` (linhas 576-594):
```javascript
const rows = cats.map(cat => {
    const list = (cat.items || []).map(it => byId.get(it.id) || it);
    return `<div class="ficha-cat">${escapeHTML(cat.name || "Itens")}</div>
        <table class="ficha-table" style="table-layout:fixed">
            <thead><tr>
                <th class="col-num">#</th>
                <th class="col-mat">Material</th>
                <th class="col-unid">Unid.</th>
                <th class="col-sol">Solicit.</th>
                <th class="col-ate">Qtd. Atendida</th>
                <th class="col-status">Status</th>
                <th class="col-obs">Observacao</th>
            </tr></thead>
            <tbody>${list.map((m, i) => `<tr class="${rowClass(m.status)}" data-id="${m.id}">
                <td class="col-num" style="color:#94a3b8;font-weight:600;font-size:10px">${i + 1}</td>
                <td class="col-mat" style="font-weight:600">${escapeHTML(m.material || "-")}</td>
                <td class="col-unid" style="color:#64748b;font-size:10px">${escapeHTML(m.unidade || "-")}</td>
                <td class="col-sol" style="font-weight:700;color:#1e40af">${escapeHTML(m.qtdSolicitada || "0")}</td>
                <td class="col-ate">${isPrint
                    ? `<span style="font-weight:700;font-size:11px">${escapeHTML(m.qtdAtendida || "—")}</span>`
                    : `<input class="ficha-input-qty ${m.status === "sem_estoque" ? "no-stock" : ""}" value="${escapeHTML(m.qtdAtendida || "")}" placeholder="—">`
                }</td>
                <td class="col-status">${isPrint
                    ? `<span class="${statusBadgeClass(m.status)}" style="cursor:default">${STATUS_LABEL[m.status] || STATUS_LABEL.nao_atendido}</span>`
                    : `<span class="${statusBadgeClass(m.status)}">${STATUS_LABEL[m.status] || STATUS_LABEL.nao_atendido}</span>`
                }</td>
                <td class="col-obs">${isPrint
                    ? `<span style="font-size:10px;color:#475569">${escapeHTML(m.obs || "")}</span>`
                    : `<input class="ficha-input-obs" value="${escapeHTML(m.obs || "")}" placeholder="Obs...">`
                }</td>
            </tr>`).join("")}</tbody>
        </table>`;
}).join("");
```

## CORREÇÃO 4: No `initMateriaisListeners()`, trocar `openFichaInline()` por `openFichaModal()`

### Linha 514, SUBSTITUIR:
```javascript
openFichaInline();
```
### POR:
```javascript
// Modal será criado sob demanda no abrirFicha()
```
(Pode simplesmente deletar a chamada, pois agora o modal é criado quando o usuário clica em "Editar Ficha")

## CORREÇÃO 5: Adicionar CSS ao `style.css` do sistema

Adicionar TODO o bloco CSS do arquivo `CORRECAO-FICHA-A4.md` que já foi enviado anteriormente. Os itens mais críticos que faltam no CSS:

```css
/* ESSENCIAL — sem isso a ficha não funciona */
.ficha-a4 {
    background: #fff;
    padding: 28px;
    box-shadow: 0 4px 30px rgba(0,0,0,.1);
    border-radius: 4px;
    min-height: 400px;
    color: #0f172a;
    font-size: 12px;
    max-width: 794px;
    margin: 0 auto;
}
.ficha-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 11px;
    margin-bottom: 2px;
    table-layout: fixed; /* CRÍTICO */
}
.col-num { width:4%; text-align:center; }
.col-mat { width:28%; text-align:left; }
.col-unid { width:7%; text-align:center; }
.col-sol { width:9%; text-align:center; }
.col-ate { width:14%; text-align:center; }
.col-status { width:10%; text-align:center; }
.col-obs { width:22%; }

/* (copiar o resto do CORRECAO-FICHA-A4.md) */
```

## RESUMO DAS MUDANÇAS

| Linha | Ação | O que muda |
|-------|------|-----------|
| 447-468 | DELETAR `openFichaInline()` | Substituída por `openFichaModal()` |
| 447 | ADICIONAR `openFichaModal()` | Cria modal fullscreen no body |
| 514 | DELETAR `openFichaInline()` chamada | Não precisa mais |
| 526-545 | SUBSTITUIR `abrirFicha()` | Abre o modal em vez de div inline |
| 576-577 | CORRIGIR bug duplo `<tr>` | Remove `<tr data-item-id>` duplicado |
| style.css | ADICIONAR CSS da ficha | Todo o bloco do CORRECAO-FICHA-A4.md |
