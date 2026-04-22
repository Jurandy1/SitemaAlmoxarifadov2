// js/modules/gas-report.js
// Módulo responsável por gerar e imprimir o relatório completo de Controle de Gás.

import { getEstoqueGas, getGasMovimentacoes, getUnidades } from "../utils/cache.js";
import { formatTimestamp, formatTimestampComTempo, dateToTimestamp } from "../utils/formatters.js";

// ─────────────────────────────────────────────
//  Helpers internos
// ─────────────────────────────────────────────

function _fmtDate(str) {
    if (!str) return '';
    const [y, m, d] = str.split('-');
    return `${d}/${m}/${y}`;
}

function _escHTML(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function _fmtTs(ts) {
    if (!ts || typeof ts.toDate !== 'function') return '—';
    try {
        return ts.toDate().toLocaleString('pt-BR', {
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });
    } catch (_) { return '—'; }
}

function _fmtTsDate(ts) {
    if (!ts || typeof ts.toDate !== 'function') return '—';
    try {
        return ts.toDate().toLocaleDateString('pt-BR', {
            day: '2-digit', month: '2-digit', year: 'numeric'
        });
    } catch (_) { return '—'; }
}

// ─────────────────────────────────────────────
//  Função principal exportada
// ─────────────────────────────────────────────

/**
 * Gera o relatório de Gás em uma nova aba e abre o diálogo de impressão.
 * @param {string} startDateStr  YYYY-MM-DD (pode ser vazio)
 * @param {string} endDateStr    YYYY-MM-DD (pode ser vazio)
 */
export function generateGasReport(startDateStr, endDateStr) {
    // ── 1. Coletar dados do cache ──────────────────────────────────────────
    const estoqueRaw   = getEstoqueGas();
    const movsRaw      = getGasMovimentacoes();
    const unidades     = getUnidades();

    const unidadeMap = new Map(unidades.map(u => {
        let tipo = (u.tipo || 'N/A').toUpperCase();
        if (tipo === 'SEMCAS') tipo = 'SEDE';
        return [u.id, { nome: u.nome, tipo }];
    }));

    // ── 2. Filtrar por data ────────────────────────────────────────────────
    const startMs  = startDateStr ? (dateToTimestamp(startDateStr)?.toMillis() ?? null) : null;
    const endMsRaw = endDateStr   ? (dateToTimestamp(endDateStr)?.toMillis()   ?? null) : null;
    const endMs    = endMsRaw     ? endMsRaw + 86_399_999 : null; // fim do dia

    const inRange = (item) => {
        const d = item.data?.toMillis?.() ?? null;
        if (d === null) return true;
        if (startMs !== null && d < startMs) return false;
        if (endMs   !== null && d > endMs)   return false;
        return true;
    };

    const estoque = [...estoqueRaw]
        .filter(inRange)
        .sort((a, b) => (a.data?.toMillis() ?? 0) - (b.data?.toMillis() ?? 0));

    const movs = [...movsRaw]
        .filter(m => ['entrega', 'retorno', 'retirada'].includes(m.tipo))
        .filter(inRange)
        .sort((a, b) => (a.data?.toMillis() ?? 0) - (b.data?.toMillis() ?? 0));

    // ── 3. Calcular totais ─────────────────────────────────────────────────
    const totalEstoqueInicial = estoque
        .filter(e => e.tipo === 'inicial')
        .reduce((s, e) => s + (parseInt(e.quantidade, 10) || 0), 0);

    const totalEntradaManual = estoque
        .filter(e => e.tipo === 'entrada')
        .reduce((s, e) => s + (parseInt(e.quantidade, 10) || 0), 0);

    const totalSaidas = movs
        .filter(m => m.tipo === 'entrega')
        .reduce((s, m) => s + (parseInt(m.quantidade, 10) || 0), 0);

    const totalRetornos = movs
        .filter(m => m.tipo === 'retorno' || m.tipo === 'retirada')
        .reduce((s, m) => s + (parseInt(m.quantidade, 10) || 0), 0);

    const totalEntradas = totalEstoqueInicial + totalEntradaManual;
    const saldoLiquido  = totalEntradas - totalSaidas;

    // ── 4. Label do período ────────────────────────────────────────────────
    let periodLabel = 'Todo o período registrado';
    if (startDateStr && endDateStr) periodLabel = `${_fmtDate(startDateStr)} a ${_fmtDate(endDateStr)}`;
    else if (startDateStr) periodLabel = `A partir de ${_fmtDate(startDateStr)}`;
    else if (endDateStr)   periodLabel = `Até ${_fmtDate(endDateStr)}`;

    const generatedAt = new Date().toLocaleString('pt-BR');

    // ── 5. Construir HTML e abrir janela ───────────────────────────────────
    const html = _buildHTML({
        periodLabel, generatedAt,
        estoque, movs, unidadeMap,
        totalEstoqueInicial, totalEntradaManual, totalEntradas,
        totalSaidas, totalRetornos, saldoLiquido
    });

    const win = window.open('', '_blank');
    if (!win) {
        alert('O navegador bloqueou a abertura de uma nova aba. Permita pop-ups para este site e tente novamente.');
        return;
    }
    win.document.open();
    win.document.write(html);
    win.document.close();
    // Aguarda os recursos (logo) carregarem antes de acionar print
    win.addEventListener('load', () => {
        setTimeout(() => win.print(), 400);
    });
}

// ─────────────────────────────────────────────
//  Construtor do HTML do relatório
// ─────────────────────────────────────────────

function _buildHTML({ periodLabel, generatedAt, estoque, movs, unidadeMap,
                       totalEstoqueInicial, totalEntradaManual, totalEntradas,
                       totalSaidas, totalRetornos, saldoLiquido }) {

    const saldoClass = saldoLiquido < 0 ? 'negative' : (saldoLiquido === 0 ? 'zero' : 'positive');

    // ── Tabela de Entradas de Estoque ───────────────────────────────────────
    let rowsEstoque = '';
    if (estoque.length === 0) {
        rowsEstoque = '<tr><td colspan="6" class="empty-row">Nenhuma entrada de estoque no período selecionado.</td></tr>';
    } else {
        estoque.forEach(e => {
            const isInicial = e.tipo === 'inicial';
            const tipoBadge = isInicial
                ? '<span class="badge badge-blue">Inicial (Sistema)</span>'
                : '<span class="badge badge-green">Entrada Manual</span>';
            const tipoTooltip = isInicial
                ? 'Estoque inserido manualmente como ponto de partida do sistema'
                : 'Compra / reposição registrada manualmente no almoxarifado';
            rowsEstoque += `
            <tr>
                <td title="${tipoTooltip}">${tipoBadge}</td>
                <td class="num">${e.quantidade ?? '—'}</td>
                <td>${_fmtTsDate(e.data)}</td>
                <td>${_escHTML(e.notaFiscal || '—')}</td>
                <td>${_escHTML(e.responsavel || '—')}</td>
                <td class="small-cell">${_fmtTs(e.registradoEm)}</td>
            </tr>`;
        });
    }

    // ── Tabela de Saídas / Movimentações ────────────────────────────────────
    let rowsMovs = '';
    if (movs.length === 0) {
        rowsMovs = '<tr><td colspan="7" class="empty-row">Nenhuma movimentação no período selecionado.</td></tr>';
    } else {
        movs.forEach(m => {
            const isEntrega = m.tipo === 'entrega';
            const tipoBadge = isEntrega
                ? '<span class="badge badge-red">Saída (Entrega)</span>'
                : '<span class="badge badge-emerald">Retorno (Vazio)</span>';

            // Resolver tipo da unidade pelo mapa ou pelo campo gravado
            const unidadeInfo = unidadeMap.get(m.unidadeId);
            const tipoUnidade = unidadeInfo?.tipo
                || ((m.tipoUnidade || '').toUpperCase() === 'SEMCAS' ? 'SEDE' : (m.tipoUnidade || '—').toUpperCase());

            rowsMovs += `
            <tr>
                <td>${_escHTML(m.unidadeNome || '—')}</td>
                <td><span class="badge-tipo">${_escHTML(tipoUnidade)}</span></td>
                <td>${tipoBadge}</td>
                <td class="num">${m.quantidade ?? '—'}</td>
                <td>${_fmtTsDate(m.data)}</td>
                <td>${_escHTML(m.responsavelAlmoxarifado || '—')}</td>
                <td>${_escHTML(m.responsavel || '—')}</td>
                <td class="small-cell">${_fmtTs(m.registradoEm)}</td>
            </tr>`;
        });
    }

    // ── Nota de rodapé de tipos ──────────────────────────────────────────────
    const totalMovs = movs.length;
    const totalMovsEntregas = movs.filter(m => m.tipo === 'entrega').length;
    const totalMovsRetornos = movs.length - totalMovsEntregas;

    return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<title>Relatório de Gás — SEMCAS</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --blue-dark: #0b1f40;
    --blue-mid:  #1e40af;
    --blue-light:#eff6ff;
    --green:     #16a34a;
    --red:       #dc2626;
    --amber:     #d97706;
    --gray-1:    #0f172a;
    --gray-2:    #334155;
    --gray-3:    #64748b;
    --gray-4:    #94a3b8;
    --gray-5:    #e2e8f0;
    --gray-6:    #f8fafc;
    --border:    #cbd5e1;
    --font: 'Segoe UI', system-ui, Arial, sans-serif;
  }

  body {
    font-family: var(--font);
    font-size: 11px;
    color: var(--gray-1);
    background: #fff;
    padding: 0;
  }

  /* ── Cabeçalho Institucional ── */
  .report-header {
    background: linear-gradient(135deg, #0b1f40 0%, #142d5c 55%, #1a3d80 100%);
    color: #fff;
    padding: 20px 28px 16px;
    display: flex;
    align-items: center;
    gap: 18px;
    position: relative;
  }
  .report-header::after {
    content: '';
    position: absolute;
    bottom: 0; left: 0; right: 0;
    height: 4px;
    background: linear-gradient(90deg, #f59e0b 0%, #fbbf24 15%, #60a5fa 45%, #34d399 75%, #f59e0b 100%);
  }
  .header-logo {
    height: 68px;
    width: auto;
    filter: drop-shadow(0 2px 4px rgba(0,0,0,.4));
    flex-shrink: 0;
  }
  .header-text h1 {
    font-size: 20px;
    font-weight: 800;
    letter-spacing: .02em;
    line-height: 1.2;
  }
  .header-text .subtitle {
    font-size: 11px;
    color: #93c5fd;
    font-weight: 500;
    letter-spacing: .08em;
    text-transform: uppercase;
    margin-top: 4px;
  }
  .header-text .org {
    font-size: 10px;
    color: #7dd3fc;
    margin-top: 2px;
  }
  .header-meta {
    margin-left: auto;
    text-align: right;
    flex-shrink: 0;
  }
  .header-meta .doc-title {
    font-size: 13px;
    font-weight: 800;
    color: #fbbf24;
    text-transform: uppercase;
    letter-spacing: .08em;
  }
  .header-meta .doc-period {
    font-size: 10px;
    color: #bfdbfe;
    margin-top: 3px;
  }
  .header-meta .doc-generated {
    font-size: 9px;
    color: #7dd3fc;
    margin-top: 2px;
  }

  /* ── Resumo / KPIs ── */
  .summary-section {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 0;
    border-bottom: 2px solid var(--border);
    background: var(--gray-6);
  }
  .kpi {
    padding: 12px 14px;
    border-right: 1px solid var(--border);
    text-align: center;
  }
  .kpi:last-child { border-right: none; }
  .kpi-label {
    font-size: 9px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: .07em;
    color: var(--gray-3);
    margin-bottom: 4px;
  }
  .kpi-value {
    font-size: 22px;
    font-weight: 800;
    line-height: 1;
    font-variant-numeric: tabular-nums;
  }
  .kpi-value.blue   { color: var(--blue-mid); }
  .kpi-value.green  { color: var(--green); }
  .kpi-value.red    { color: var(--red); }
  .kpi-value.amber  { color: var(--amber); }
  .kpi-value.positive { color: var(--green); }
  .kpi-value.negative { color: var(--red); }
  .kpi-value.zero   { color: var(--gray-3); }
  .kpi-sub {
    font-size: 9px;
    color: var(--gray-4);
    margin-top: 2px;
  }

  /* ── Seções ── */
  .section {
    padding: 0 0 24px;
  }
  .section-header {
    background: var(--blue-dark);
    color: #fff;
    padding: 9px 18px;
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 0;
  }
  .section-header h2 {
    font-size: 12px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: .1em;
  }
  .section-badge {
    margin-left: auto;
    background: rgba(255,255,255,.15);
    color: #e0f2fe;
    font-size: 10px;
    font-weight: 700;
    padding: 2px 8px;
    border-radius: 999px;
  }
  .section-note {
    background: #fefce8;
    border-left: 4px solid #fbbf24;
    padding: 7px 14px;
    font-size: 10px;
    color: #78350f;
    line-height: 1.5;
  }
  .section-note strong { color: #92400e; }

  /* ── Tabelas ── */
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 10.5px;
  }
  thead th {
    background: #1e3a5f;
    color: #e0f2fe;
    padding: 8px 10px;
    text-align: left;
    font-size: 9.5px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: .07em;
    white-space: nowrap;
    border-bottom: 2px solid var(--blue-mid);
  }
  thead th.num  { text-align: center; }
  tbody tr { border-bottom: 1px solid var(--gray-5); }
  tbody tr:nth-child(even) { background: #f8fafc; }
  tbody tr:hover { background: #eff6ff; }
  tbody td {
    padding: 7px 10px;
    vertical-align: middle;
    color: var(--gray-2);
  }
  tbody td.num       { text-align: center; font-weight: 700; font-variant-numeric: tabular-nums; }
  tbody td.small-cell { font-size: 9.5px; color: var(--gray-3); white-space: nowrap; }
  .empty-row {
    text-align: center;
    padding: 20px !important;
    color: var(--gray-4);
    font-style: italic;
  }

  /* ── Badges ── */
  .badge {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 999px;
    font-size: 9.5px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: .05em;
    white-space: nowrap;
  }
  .badge-blue    { background: #dbeafe; color: #1e40af; border: 1px solid #93c5fd; }
  .badge-green   { background: #d1fae5; color: #065f46; border: 1px solid #6ee7b7; }
  .badge-red     { background: #fee2e2; color: #991b1b; border: 1px solid #fca5a5; }
  .badge-emerald { background: #d1fae5; color: #065f46; border: 1px solid #6ee7b7; }
  .badge-tipo {
    display: inline-block;
    padding: 1px 6px;
    border-radius: 5px;
    font-size: 9px;
    font-weight: 700;
    background: #e0e7ff;
    color: #3730a3;
    border: 1px solid #c7d2fe;
    text-transform: uppercase;
    letter-spacing: .06em;
  }

  /* ── Rodapé ── */
  .report-footer {
    margin-top: 16px;
    border-top: 2px solid var(--border);
    padding: 12px 18px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: var(--gray-6);
    font-size: 9px;
    color: var(--gray-3);
  }
  .report-footer .sig {
    font-weight: 700;
    color: var(--gray-2);
    font-size: 10px;
  }

  /* ── Nota legenda ── */
  .legend-box {
    margin: 0 0 0;
    padding: 8px 14px;
    background: #f0f9ff;
    border-top: 1px solid #bae6fd;
    font-size: 9.5px;
    color: #0369a1;
  }
  .legend-box span { margin-right: 16px; }
  
  /* ── Espaçador ── */
  .spacer { height: 14px; background: #fff; }

  /* ── Print ── */
  @media print {
    body { font-size: 10px; }
    .report-header { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .summary-section { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .section-header { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    thead th { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    tbody tr:nth-child(even) { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .badge { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .report-footer { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .page-break { page-break-before: always; }
    .no-break { page-break-inside: avoid; }
  }

  @page {
    margin: 12mm 10mm 12mm 10mm;
    size: A4 landscape;
  }
</style>
</head>
<body>

<!-- ══════════════════════════════════════════════════════════════
     CABEÇALHO INSTITUCIONAL
     ══════════════════════════════════════════════════════════════ -->
<header class="report-header">
  <img src="./SaoLuis.png" alt="Brasão São Luís" class="header-logo"
       onerror="this.style.display='none'">
  <div class="header-text">
    <h1>Relatório de Controle de Gás</h1>
    <div class="subtitle">Almoxarifado SEMCAS</div>
    <div class="org">Secretaria Municipal da Criança e Assistência Social — Prefeitura de São Luís · MA</div>
  </div>
  <div class="header-meta">
    <div class="doc-title">🔥 Controle de Gás</div>
    <div class="doc-period">📅 Período: ${_escHTML(periodLabel)}</div>
    <div class="doc-generated">Gerado em: ${_escHTML(generatedAt)}</div>
  </div>
</header>

<!-- ══════════════════════════════════════════════════════════════
     RESUMO EXECUTIVO
     ══════════════════════════════════════════════════════════════ -->
<div class="summary-section">
  <div class="kpi">
    <div class="kpi-label">Estoque Inicial (Sistema)</div>
    <div class="kpi-value blue">${totalEstoqueInicial}</div>
    <div class="kpi-sub">botijões</div>
  </div>
  <div class="kpi">
    <div class="kpi-label">Entradas Manuais</div>
    <div class="kpi-value blue">${totalEntradaManual}</div>
    <div class="kpi-sub">botijões comprados</div>
  </div>
  <div class="kpi">
    <div class="kpi-label">Total Disponibilizado</div>
    <div class="kpi-value blue">${totalEntradas}</div>
    <div class="kpi-sub">inicial + entradas</div>
  </div>
  <div class="kpi">
    <div class="kpi-label">Saídas (Entregas)</div>
    <div class="kpi-value red">${totalSaidas}</div>
    <div class="kpi-sub">botijões entregues</div>
  </div>
  <div class="kpi">
    <div class="kpi-label">Saldo (Saída − Retorno)</div>
    <div class="kpi-value ${saldoClass}">${saldoLiquido >= 0 ? '+' : ''}${saldoLiquido}</div>
    <div class="kpi-sub">retornos: ${totalRetornos}</div>
  </div>
</div>

<div class="spacer"></div>

<!-- ══════════════════════════════════════════════════════════════
     SEÇÃO 1: ENTRADAS DE ESTOQUE
     ══════════════════════════════════════════════════════════════ -->
<div class="section no-break">
  <div class="section-header">
    <span>📦</span>
    <h2>Entradas de Estoque de Gás</h2>
    <span class="section-badge">${estoque.length} registro(s)</span>
  </div>
  <div class="section-note">
    <strong>ℹ️ Legenda dos tipos:</strong>
    &nbsp;|&nbsp;
    <strong>Inicial (Sistema)</strong> = saldo inserido manualmente como ponto de partida no sistema (não representa compra).
    &nbsp;|&nbsp;
    <strong>Entrada Manual</strong> = compra ou reposição de botijões cheios registrada pelo almoxarifado.
  </div>

  <table>
    <thead>
      <tr>
        <th style="width:160px">Tipo de Lançamento</th>
        <th class="num" style="width:70px">Qtd.</th>
        <th style="width:110px">Data da Movimentação</th>
        <th style="width:120px">Nota Fiscal</th>
        <th>Responsável (Estoque)</th>
        <th style="width:140px">Lançado Em</th>
      </tr>
    </thead>
    <tbody>
      ${rowsEstoque}
    </tbody>
  </table>
  <div class="legend-box">
    <span>✅ <strong>Inicial (Sistema)</strong>: definido uma única vez para representar o estoque existente antes do uso do sistema</span>
    <span>📥 <strong>Entrada Manual</strong>: cada compra/reposição cadastrada pelo almoxarife</span>
  </div>
</div>

<div class="spacer"></div>

<!-- ══════════════════════════════════════════════════════════════
     SEÇÃO 2: MOVIMENTAÇÕES (SAÍDAS E RETORNOS)
     ══════════════════════════════════════════════════════════════ -->
<div class="section">
  <div class="section-header">
    <span>🔄</span>
    <h2>Movimentações — Saídas e Retornos por Unidade</h2>
    <span class="section-badge">${totalMovs} registro(s) · ${totalMovsEntregas} saída(s) · ${totalMovsRetornos} retorno(s)</span>
  </div>

  <table>
    <thead>
      <tr>
        <th>Unidade</th>
        <th style="width:80px">Tipo</th>
        <th style="width:130px">Tipo de Mov.</th>
        <th class="num" style="width:60px">Qtd.</th>
        <th style="width:110px">Data da Movimentação</th>
        <th style="width:140px">Resp. Almox.</th>
        <th style="width:140px">Resp. Unidade</th>
        <th style="width:140px">Lançado Em</th>
      </tr>
    </thead>
    <tbody>
      ${rowsMovs}
    </tbody>
  </table>
  <div class="legend-box">
    <span>🔴 <strong>Saída (Entrega)</strong>: botijão cheio saiu do almoxarifado para a unidade</span>
    <span>🟢 <strong>Retorno (Vazio)</strong>: botijão vazio recebido de volta da unidade</span>
    <span>📌 <strong>Resp. Almox.</strong>: servidor do almoxarifado que realizou a operação</span>
    <span>📌 <strong>Resp. Unidade</strong>: servidor da unidade que recebeu/devolveu</span>
  </div>
</div>

<!-- ══════════════════════════════════════════════════════════════
     RODAPÉ
     ══════════════════════════════════════════════════════════════ -->
<footer class="report-footer">
  <div>
    <div class="sig">Prefeitura de São Luís — SEMCAS</div>
    <div>Secretaria Municipal da Criança e Assistência Social · Sistema de Almoxarifado v2</div>
  </div>
  <div style="text-align:center">
    <div>Período: <strong>${_escHTML(periodLabel)}</strong></div>
    <div>Registros: ${estoque.length} entrada(s) de estoque · ${totalMovs} movimentação(ões)</div>
  </div>
  <div style="text-align:right">
    <div>Gerado em: <strong>${_escHTML(generatedAt)}</strong></div>
    <div style="margin-top:2px">Documento gerado automaticamente — não requer assinatura.</div>
  </div>
</footer>

</body>
</html>`;
}
