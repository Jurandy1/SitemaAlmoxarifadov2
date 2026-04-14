# CORREÇÃO — Ficha A4 no Sistema Integrado

## PROBLEMA
A ficha A4 no sistema integrado está sem formatação. Precisa ficar igual ao protótipo standalone `fluxo-separacao-completo.html`.

## O QUE CORRIGIR

### 1. CSS — Adicionar ao `style.css` (ou no bloco `<style>` do index.html)

Copiar TODO este bloco CSS. Ele controla a ficha A4, badges de status, tabela de itens, cabeçalho institucional, impressão:

```css
/* ═══════════════════════════════════════════════════
   FICHA A4 — SEPARAÇÃO DE MATERIAIS
   ═══════════════════════════════════════════════════ */

/* Container A4 */
.ficha-a4 {
  background: #fff;
  padding: 28px;
  box-shadow: 0 4px 30px rgba(0,0,0,.1);
  border-radius: 4px;
  min-height: 400px;
  color: #0f172a;
  font-size: 12px;
  max-width: 794px;  /* largura A4 em px */
  margin: 0 auto;
}

/* Cabeçalho institucional */
.ficha-institucional {
  text-align: center;
  margin-bottom: 6px;
  line-height: 1.3;
}
.ficha-institucional .fi-1 {
  font-size: 13px;
  font-weight: 800;
  text-transform: uppercase;
}
.ficha-institucional .fi-2 {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
}
.ficha-institucional .fi-3 {
  font-size: 10px;
  font-weight: 600;
  color: #475569;
  text-transform: uppercase;
}

/* Cabeçalho da ficha (título + unidade + data) */
.ficha-header {
  border-bottom: 3px solid #0f172a;
  padding-bottom: 10px;
  margin-bottom: 12px;
  display: flex;
  justify-content: space-between;
}
.ficha-header h1 {
  font-size: 15px;
  font-weight: 800;
  margin: 0;
}
.ficha-header .ficha-unit {
  font-size: 12px;
  color: #475569;
  font-weight: 600;
  margin-top: 2px;
}
.ficha-header .ficha-date {
  text-align: right;
  font-size: 11px;
  color: #64748b;
}
.ficha-header .ficha-file {
  font-size: 9px;
  color: #94a3b8;
}

/* Info do separador */
.ficha-info {
  display: flex;
  gap: 12px;
  margin-bottom: 10px;
  font-size: 12px;
  align-items: center;
  flex-wrap: wrap;
}

/* Categoria header (barra escura) */
.ficha-cat {
  background: #0f172a;
  color: #fff;
  padding: 4px 10px;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  border-radius: 4px 4px 0 0;
  margin-top: 10px;
}

/* Tabela de itens */
.ficha-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 11px;
  margin-bottom: 2px;
  table-layout: fixed; /* CRÍTICO: força colunas a respeitar width */
}
.ficha-table th {
  padding: 4px 6px;
  font-size: 9px;
  font-weight: 800;
  color: #475569;
  text-align: center;
  border-bottom: 2px solid #cbd5e1;
  text-transform: uppercase;
  background: #f1f5f9;
  letter-spacing: 0.3px;
}
.ficha-table th:nth-child(2) {
  text-align: left;
}
.ficha-table td {
  padding: 4px 6px;
  border-bottom: 1px solid #f1f5f9;
  vertical-align: middle;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Larguras fixas das colunas — ESSENCIAL */
.ficha-table .col-num    { width: 4%; text-align: center; }
.ficha-table .col-mat    { width: 28%; text-align: left; }
.ficha-table .col-unid   { width: 7%; text-align: center; }
.ficha-table .col-sol    { width: 9%; text-align: center; }
.ficha-table .col-ate    { width: 14%; text-align: center; }
.ficha-table .col-status { width: 10%; text-align: center; }
.ficha-table .col-obs    { width: 22%; }

/* Para tabela de entrega/revisão (sem input de edição) */
.ficha-table .col-ate-ro { width: 12%; text-align: center; }
.ficha-table .col-obs-ro { width: 20%; }

/* Cores de fundo por status */
.ficha-table .row-atendido     { background: #f0fdf4; }
.ficha-table .row-parcial      { background: #fffbeb; }
.ficha-table .row-sem_estoque  { background: #fff1f2; }
.ficha-table .row-nao_atendido { background: #f5f3ff; }

/* Input de quantidade na ficha */
.ficha-input-qty {
  width: 100%;
  border: 1px solid #e2e8f0;
  border-radius: 3px;
  padding: 3px 5px;
  font-family: inherit;
  outline: none;
  box-sizing: border-box;
  text-align: center;
  font-size: 11px;
  font-weight: 700;
}
.ficha-input-qty.no-stock {
  color: #dc2626;
  background: #fee2e2;
}

/* Input de observação na ficha */
.ficha-input-obs {
  width: 100%;
  border: 1px solid #e2e8f0;
  border-radius: 3px;
  padding: 3px 5px;
  font-family: inherit;
  outline: none;
  box-sizing: border-box;
  font-size: 10px;
  color: #475569;
}

/* Badges de status */
.badge-status {
  display: inline-block;
  padding: 2px 7px;
  border-radius: 4px;
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 0.3px;
  text-transform: uppercase;
  cursor: pointer;
  border: 1px solid;
  user-select: none;
  white-space: nowrap;
}
.badge-nao_atendido { background: #ede9fe; color: #5b21b6; border-color: #c4b5fd; }
.badge-atendido     { background: #d1fae5; color: #065f46; border-color: #6ee7b7; }
.badge-parcial      { background: #fef3c7; color: #92400e; border-color: #fcd34d; }
.badge-sem_estoque  { background: #fee2e2; color: #991b1b; border-color: #fca5a5; }

/* Pills de tipo de material */
.tipo-pill {
  display: inline-block;
  padding: 3px 10px;
  border-radius: 10px;
  font-size: 10px;
  font-weight: 700;
  white-space: nowrap;
}
.tipo-expediente   { background: #dbeafe; color: #1e40af; }
.tipo-limpeza      { background: #d1fae5; color: #065f46; }
.tipo-higiene      { background: #fce7f3; color: #9d174d; }
.tipo-alimenticio  { background: #fef3c7; color: #92400e; }
.tipo-descartavel  { background: #e0e7ff; color: #3730a3; }
.tipo-atividades   { background: #f3e8ff; color: #6b21a8; }
.tipo-outros       { background: #f1f5f9; color: #475569; }

/* Resumo no rodapé */
.ficha-summary {
  margin-top: 14px;
  padding: 8px 10px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  font-size: 11px;
}

/* Assinaturas */
.ficha-signatures {
  margin-top: 24px;
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 16px;
  font-size: 10px;
}
.ficha-sig {
  text-align: center;
}
.ficha-sig-line {
  border-bottom: 1px solid #0f172a;
  padding-bottom: 3px;
  margin-bottom: 3px;
  min-height: 16px;
  font-weight: 500;
}
.ficha-sig-label {
  font-size: 9px;
  color: #64748b;
  font-weight: 600;
}

/* Toolbar da ficha */
.ficha-toolbar {
  background: #0f172a;
  padding: 10px 14px;
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  border-radius: 10px;
  margin-bottom: 12px;
}
.ficha-toolbar-title {
  color: #f8fafc;
  font-weight: 700;
  font-size: 13px;
}
.ficha-stats {
  display: flex;
  gap: 4px;
  font-size: 11px;
}
.ficha-stat {
  padding: 3px 8px;
  border-radius: 5px;
  font-weight: 600;
}
.fs-total   { background: #1e293b; color: #94a3b8; }
.fs-ok      { background: #052e16; color: #86efac; }
.fs-parcial { background: #451a03; color: #fcd34d; }
.fs-no      { background: #450a0a; color: #fca5a5; }
.fs-na      { background: #2e1065; color: #c4b5fd; }

/* Legenda de status */
.ficha-legend {
  display: flex;
  gap: 6px;
  align-items: center;
  margin-bottom: 10px;
  font-size: 10px;
  color: #64748b;
  flex-wrap: wrap;
}

/* ═══════════════════════════════════════════════════
   INDICADORES DE STATUS (barras no topo)
   ═══════════════════════════════════════════════════ */
.status-bars {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 16px;
}
.status-bar {
  border-radius: 8px;
  padding: 8px 14px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.status-bar .sb-label {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.status-bar .sb-count {
  font-size: 22px;
  font-weight: 800;
}
.sb-para-separar  { background: #fef2f2; color: #dc2626; border: 1px solid #fecaca; }
.sb-em-separacao  { background: #eff6ff; color: #2563eb; border: 1px solid #bfdbfe; }
.sb-pronto        { background: #f0fdf4; color: #16a34a; border: 1px solid #bbf7d0; }
```

### 2. ESTRUTURA HTML DA FICHA A4

A ficha DEVE seguir esta estrutura exata. O problema no sistema é que a ficha provavelmente está sendo renderizada sem o container `.ficha-a4` e sem `table-layout: fixed`:

```html
<div class="ficha-a4">
  <!-- Cabeçalho institucional -->
  <div class="ficha-institucional">
    <div class="fi-1">Prefeitura de São Luís</div>
    <div class="fi-2">Secretaria Municipal da Criança e Assistência Social – SEMCAS</div>
    <div class="fi-3">Coordenação de Administração e Patrimônio</div>
  </div>

  <!-- Cabeçalho da ficha -->
  <div class="ficha-header">
    <div>
      <h1>FICHA DE SEPARAÇÃO DE MATERIAIS</h1>
      <div class="ficha-unit">CRAS Bacanga</div>
    </div>
    <div class="ficha-date">
      Data: <b>29/03/2026</b><br>
      <span class="ficha-file">CRASBACANGA.xlsx</span>
    </div>
  </div>

  <!-- Info separador + tipos -->
  <div class="ficha-info">
    <span><b>Separador:</b> Carlos</span>
    <span style="color:#64748b">|</span>
    <span><b>Tipos:</b>
      <span class="tipo-pill tipo-expediente">Expediente</span>
      <span class="tipo-pill tipo-limpeza">Limpeza</span>
      <span class="tipo-pill tipo-descartavel">Descartável</span>
    </span>
  </div>

  <!-- Categoria -->
  <div class="ficha-cat">Material de Expediente</div>

  <!-- Tabela de itens — NOTE: table-layout:fixed é ESSENCIAL -->
  <table class="ficha-table" style="table-layout:fixed">
    <thead>
      <tr>
        <th class="col-num">#</th>
        <th class="col-mat">Material</th>
        <th class="col-unid">Unid.</th>
        <th class="col-sol">Solicit.</th>
        <th class="col-ate">Qtd. Atendida</th>
        <th class="col-status">Status</th>
        <th class="col-obs">Observação</th>
      </tr>
    </thead>
    <tbody>
      <tr class="row-parcial">
        <td class="col-num" style="color:#94a3b8;font-weight:600;font-size:10px">1</td>
        <td class="col-mat" style="font-weight:600">PAPEL A4</td>
        <td class="col-unid" style="color:#64748b;font-size:10px">RESMA</td>
        <td class="col-sol" style="font-weight:700;color:#1e40af">3</td>
        <td class="col-ate" style="padding:2px 4px">
          <input class="ficha-input-qty" value="1 RESMA" placeholder="—">
        </td>
        <td class="col-status" style="padding:2px">
          <span class="badge-status badge-parcial">Parcial</span>
        </td>
        <td class="col-obs" style="padding:2px 4px">
          <input class="ficha-input-obs" value="" placeholder="Obs...">
        </td>
      </tr>
      <!-- mais itens... -->
    </tbody>
  </table>

  <!-- Resumo -->
  <div class="ficha-summary">
    <b>Resumo:</b> 63 itens |
    <span style="color:#059669">12 atendidos</span> |
    <span style="color:#d97706">8 parciais</span> |
    <span style="color:#dc2626">35 sem estoque</span> |
    <span style="color:#7c3aed">8 não atendidos</span>
  </div>

  <!-- Assinaturas -->
  <div class="ficha-signatures">
    <div class="ficha-sig">
      <div class="ficha-sig-line">Carlos</div>
      <div class="ficha-sig-label">Separado por</div>
    </div>
    <div class="ficha-sig">
      <div class="ficha-sig-line"></div>
      <div class="ficha-sig-label">Entregue por</div>
    </div>
    <div class="ficha-sig">
      <div class="ficha-sig-line"></div>
      <div class="ficha-sig-label">Recebido por (assinatura)</div>
    </div>
  </div>
</div>
```

### 3. FUNÇÃO JS PARA GERAR O HTML DA FICHA

O problema principal é que o JS provavelmente está gerando HTML sem as classes corretas. Use esta função:

```javascript
function renderFichaA4(reqData) {
  const d = reqData.parsed;
  const items = reqData.items;
  const today = new Date().toLocaleDateString('pt-BR');

  let h = '';

  // Cabeçalho institucional
  h += '<div class="ficha-institucional">';
  h += '<div class="fi-1">Prefeitura de São Luís</div>';
  h += '<div class="fi-2">Secretaria Municipal da Criança e Assistência Social – SEMCAS</div>';
  h += '<div class="fi-3">Coordenação de Administração e Patrimônio</div>';
  h += '</div>';

  // Cabeçalho ficha
  h += '<div class="ficha-header"><div>';
  h += '<h1>FICHA DE SEPARAÇÃO DE MATERIAIS</h1>';
  h += '<div class="ficha-unit">' + esc(d.unitName) + '</div>';
  h += '</div><div class="ficha-date">';
  h += 'Data: <b>' + today + '</b><br>';
  h += '<span class="ficha-file">' + esc(d.fileName || '') + '</span>';
  h += '</div></div>';

  // Separador + tipos
  h += '<div class="ficha-info">';
  h += '<span><b>Separador:</b> ' + esc(reqData.separador) + '</span>';
  h += '<span style="color:#64748b">|</span>';
  h += '<span><b>Tipos:</b> ';
  reqData.tipos.forEach(function(t) {
    var cls = 'tipo-' + t.toLowerCase()
      .replace('í','i').replace('á','a').replace('é','e').replace('ã','a');
    h += '<span class="tipo-pill ' + cls + '">' + t + '</span> ';
  });
  h += '</span></div>';

  // Categorias e itens
  d.categories.forEach(function(cat) {
    h += '<div class="ficha-cat">' + esc(cat.name) + '</div>';
    h += '<table class="ficha-table" style="table-layout:fixed"><thead><tr>';
    h += '<th class="col-num">#</th>';
    h += '<th class="col-mat">Material</th>';
    h += '<th class="col-unid">Unid.</th>';
    h += '<th class="col-sol">Solicit.</th>';
    h += '<th class="col-ate">Qtd. Atendida</th>';
    h += '<th class="col-status">Status</th>';
    h += '<th class="col-obs">Observação</th>';
    h += '</tr></thead><tbody>';

    cat.items.forEach(function(x, i) {
      var m = items[x.id];
      var rowClass = 'row-' + m.status;
      var qtyClass = 'ficha-input-qty' + (m.status === 'sem_estoque' ? ' no-stock' : '');
      var statusClass = 'badge-status badge-' + m.status;
      var statusLabel = {
        nao_atendido: 'Não Atendido',
        atendido: 'Atendido',
        parcial: 'Parcial',
        sem_estoque: 'Sem Estoque'
      }[m.status] || 'Não Atendido';

      h += '<tr class="' + rowClass + '" data-id="' + x.id + '">';
      h += '<td class="col-num" style="color:#94a3b8;font-weight:600;font-size:10px">' + (i+1) + '</td>';
      h += '<td class="col-mat" style="font-weight:600">' + esc(m.material) + '</td>';
      h += '<td class="col-unid" style="color:#64748b;font-size:10px">' + esc(m.unidade) + '</td>';
      h += '<td class="col-sol" style="font-weight:700;color:#1e40af">' + esc(m.qtdSolicitada) + '</td>';
      h += '<td class="col-ate" style="padding:2px 4px"><input class="' + qtyClass + '" value="' + esc(m.qtdAtendida) + '" placeholder="—" onchange="editQty(' + x.id + ',this.value)"></td>';
      h += '<td class="col-status" style="padding:2px"><span class="' + statusClass + '" onclick="cycleStatus(' + x.id + ',this)">' + statusLabel + '</span></td>';
      h += '<td class="col-obs" style="padding:2px 4px"><input class="ficha-input-obs" value="' + esc(m.obs) + '" placeholder="Obs..." onchange="editObs(' + x.id + ',this.value)"></td>';
      h += '</tr>';
    });

    h += '</tbody></table>';
  });

  // Resumo
  var v = Object.values(items);
  h += '<div class="ficha-summary"><b>Resumo:</b> ' + v.length + ' itens | ';
  h += '<span style="color:#059669">' + v.filter(function(i){return i.status==='atendido'}).length + ' atendidos</span> | ';
  h += '<span style="color:#d97706">' + v.filter(function(i){return i.status==='parcial'}).length + ' parciais</span> | ';
  h += '<span style="color:#dc2626">' + v.filter(function(i){return i.status==='sem_estoque'}).length + ' sem estoque</span> | ';
  h += '<span style="color:#7c3aed">' + v.filter(function(i){return i.status==='nao_atendido'}).length + ' não atendidos</span>';
  h += '</div>';

  // Assinaturas
  h += '<div class="ficha-signatures">';
  h += '<div class="ficha-sig"><div class="ficha-sig-line">' + esc(reqData.separador) + '</div><div class="ficha-sig-label">Separado por</div></div>';
  h += '<div class="ficha-sig"><div class="ficha-sig-line"></div><div class="ficha-sig-label">Entregue por</div></div>';
  h += '<div class="ficha-sig"><div class="ficha-sig-line"></div><div class="ficha-sig-label">Recebido por (assinatura)</div></div>';
  h += '</div>';

  // Resumo letras (A:X | P:X | SE:X | NA:X)
  var ok = v.filter(function(i){return i.status==='atendido'}).length;
  var pa = v.filter(function(i){return i.status==='parcial'}).length;
  var se = v.filter(function(i){return i.status==='sem_estoque'}).length;
  var na = v.filter(function(i){return i.status==='nao_atendido'}).length;
  h += '<div style="margin-top:8px;font-size:10px;color:#64748b">';
  h += 'Resumo: A:' + ok + ' | P:' + pa + ' | SE:' + se + ' | NA:' + na;
  h += '</div>';

  return h;
}
```

### 4. CSS DA JANELA DE IMPRESSÃO

Quando abrir a nova janela para imprimir, copiar TODOS estes estilos. O problema atual é que a janela de impressão provavelmente não tem os estilos da ficha:

```javascript
function openPrintWindow(contentHTML) {
  var w = window.open('', '_blank', 'width=850,height=1100');
  if (!w) { alert('Permita popups para imprimir'); return; }

  w.document.write('<!DOCTYPE html><html><head><meta charset="UTF-8">');
  w.document.write('<title>Imprimir — SEMCAS</title>');
  w.document.write('<style>');
  w.document.write([
    "* { box-sizing:border-box; margin:0; padding:0; }",
    "body { font-family:'Segoe UI',system-ui,sans-serif; color:#0f172a; padding:8mm; background:#fff; font-size:12px; }",

    ".ficha-institucional { text-align:center; margin-bottom:6px; line-height:1.3; }",
    ".fi-1 { font-size:13px; font-weight:800; text-transform:uppercase; }",
    ".fi-2 { font-size:11px; font-weight:700; text-transform:uppercase; }",
    ".fi-3 { font-size:10px; font-weight:600; color:#475569; text-transform:uppercase; }",

    ".ficha-header { border-bottom:3px solid #0f172a; padding-bottom:10px; margin-bottom:12px; display:flex; justify-content:space-between; }",
    ".ficha-header h1 { font-size:15px; font-weight:800; margin:0; }",
    ".ficha-unit { font-size:12px; color:#475569; font-weight:600; margin-top:2px; }",
    ".ficha-date { text-align:right; font-size:11px; color:#64748b; }",
    ".ficha-file { font-size:9px; color:#94a3b8; }",

    ".ficha-info { display:flex; gap:12px; margin-bottom:10px; font-size:12px; align-items:center; flex-wrap:wrap; }",

    ".ficha-cat { background:#0f172a; color:#fff; padding:4px 10px; font-size:10px; font-weight:800; letter-spacing:0.5px; text-transform:uppercase; border-radius:4px 4px 0 0; margin-top:10px; }",

    ".ficha-table { width:100%; border-collapse:collapse; font-size:11px; margin-bottom:2px; table-layout:fixed; }",
    ".ficha-table th { padding:4px 6px; font-size:9px; font-weight:800; color:#475569; text-align:center; border-bottom:2px solid #cbd5e1; text-transform:uppercase; background:#f1f5f9; }",
    ".ficha-table th:nth-child(2) { text-align:left; }",
    ".ficha-table td { padding:4px 6px; border-bottom:1px solid #e2e8f0; vertical-align:middle; overflow:hidden; text-overflow:ellipsis; }",

    ".col-num { width:4%; text-align:center; }",
    ".col-mat { width:30%; text-align:left; }",
    ".col-unid { width:8%; text-align:center; }",
    ".col-sol { width:10%; text-align:center; }",
    ".col-ate { width:12%; text-align:center; }",
    ".col-status { width:11%; text-align:center; }",
    ".col-obs { width:20%; }",

    ".row-atendido { background:#f0fdf4; }",
    ".row-parcial { background:#fffbeb; }",
    ".row-sem_estoque { background:#fff1f2; }",
    ".row-nao_atendido { background:#f5f3ff; }",

    ".ficha-input-qty, .ficha-input-obs { border:none; background:transparent; font-family:inherit; font-size:11px; font-weight:700; text-align:center; padding:2px; width:100%; }",
    ".ficha-input-obs { font-size:10px; color:#475569; text-align:left; font-weight:400; }",
    ".ficha-input-qty.no-stock { color:#dc2626; }",

    ".badge-status { display:inline-block; padding:2px 7px; border-radius:4px; font-size:9px; font-weight:800; letter-spacing:0.3px; text-transform:uppercase; border:1px solid; }",
    ".badge-nao_atendido { background:#ede9fe; color:#5b21b6; border-color:#c4b5fd; }",
    ".badge-atendido { background:#d1fae5; color:#065f46; border-color:#6ee7b7; }",
    ".badge-parcial { background:#fef3c7; color:#92400e; border-color:#fcd34d; }",
    ".badge-sem_estoque { background:#fee2e2; color:#991b1b; border-color:#fca5a5; }",

    ".tipo-pill { display:inline-block; padding:2px 8px; border-radius:8px; font-size:9px; font-weight:700; }",
    ".tipo-expediente { background:#dbeafe; color:#1e40af; }",
    ".tipo-limpeza { background:#d1fae5; color:#065f46; }",
    ".tipo-higiene { background:#fce7f3; color:#9d174d; }",
    ".tipo-alimenticio { background:#fef3c7; color:#92400e; }",
    ".tipo-descartavel { background:#e0e7ff; color:#3730a3; }",
    ".tipo-atividades { background:#f3e8ff; color:#6b21a8; }",
    ".tipo-outros { background:#f1f5f9; color:#475569; }",

    ".ficha-summary { margin-top:14px; padding:8px 10px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:6px; font-size:11px; }",

    ".ficha-signatures { margin-top:24px; display:grid; grid-template-columns:1fr 1fr 1fr; gap:16px; font-size:10px; }",
    ".ficha-sig { text-align:center; }",
    ".ficha-sig-line { border-bottom:1px solid #0f172a; padding-bottom:3px; margin-bottom:3px; min-height:16px; font-weight:500; }",
    ".ficha-sig-label { font-size:9px; color:#64748b; font-weight:600; }",

    "@page { size:A4 portrait; margin:5mm; }",
    "@media print { body { padding:0; } }"
  ].join('\n'));
  w.document.write('</style></head><body>');
  w.document.write(contentHTML);
  w.document.write('<script>window.onload=function(){window.print()}<\/script>');
  w.document.write('</body></html>');
  w.document.close();
}
```

### 5. ERROS COMUNS QUE CAUSAM O PROBLEMA

1. **Falta `table-layout: fixed`** — Sem isso o browser auto-dimensiona as colunas e fica tudo desalinhado
2. **Falta `max-width: 794px`** — Sem isso a ficha estica para a largura toda da tela
3. **Classes diferentes** — O protótipo usa classes curtas (.it, .ch, .bs) mas o sistema pode ter conflito. Use as classes longas (.ficha-table, .ficha-cat, .badge-status)
4. **Container não existe** — A ficha precisa estar dentro de `<div class="ficha-a4">...</div>`
5. **Janela de impressão sem estilos** — A nova janela não herda o CSS do sistema, precisa dos estilos inline
