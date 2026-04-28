// js/modules/gas-report.js
// Módulo responsável por gerar e imprimir o relatório completo de Controle de Gás.

import { getEstoqueGas, getGasMovimentacoes, getUnidades } from "../utils/cache.js";
import { formatTimestamp, formatTimestampComTempo, dateToTimestamp } from "../utils/formatters.js";

// ─── Corte de data (igual ao gas-control.js) ──────────────────────────────────
const GAS_CUTOFF_MS = new Date('2026-04-13T00:00:00.000').getTime();

function _escHTML(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function _fmtDate(str) {
    if (!str) return '';
    const [y, m, d] = str.split('-');
    return `${d}/${m}/${y}`;
}

function _fmtTs(ts) {
    if (!ts || typeof ts.toDate !== 'function') return '—';
    try { return ts.toDate().toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch (_) { return '—'; }
}

function _fmtTsDate(ts) {
    if (!ts || typeof ts.toDate !== 'function') return '—';
    try { return ts.toDate().toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }); } catch (_) { return '—'; }
}

/**
 * Gera o relatório de Gás em uma nova aba.
 * Apenas dados a partir de 13/04/2026 são incluídos.
 */
export function generateGasReport(startDateStr, endDateStr) {
    const estoqueRaw = getEstoqueGas();
    const movsRaw    = getGasMovimentacoes();
    const unidades   = getUnidades();

    const unidadeMap = new Map(unidades.map(u => {
        let tipo = (u.tipo || 'N/A').toUpperCase();
        if (tipo === 'SEMCAS') tipo = 'SEDE';
        return [u.id, { nome: u.nome, tipo }];
    }));

    // Aplica corte mínimo (13/04/2026) + filtro do usuário
    const userStartMs  = startDateStr ? (dateToTimestamp(startDateStr)?.toMillis() ?? null) : null;
    const userEndMsRaw = endDateStr   ? (dateToTimestamp(endDateStr)?.toMillis()   ?? null) : null;
    const userEndMs    = userEndMsRaw ? userEndMsRaw + 86_399_999 : null;

    const effectiveStart = userStartMs ? Math.max(userStartMs, GAS_CUTOFF_MS) : GAS_CUTOFF_MS;

    const inRange = (item) => {
        const d = item.data?.toMillis?.() ?? null;
        if (d === null) return false;
        if (d < effectiveStart) return false;
        if (userEndMs !== null && d > userEndMs) return false;
        return true;
    };

    const estoque = [...estoqueRaw].filter(inRange).sort((a, b) => (a.data?.toMillis() ?? 0) - (b.data?.toMillis() ?? 0));
    const movs    = [...movsRaw].filter(m => m.tipo === 'entrega').filter(inRange).sort((a, b) => (a.data?.toMillis() ?? 0) - (b.data?.toMillis() ?? 0));

    const totalInicial  = estoque.filter(e => e.tipo === 'inicial').reduce((s, e) => s + (parseInt(e.quantidade, 10) || 0), 0);
    const totalManual   = estoque.filter(e => e.tipo === 'entrada').reduce((s, e) => s + (parseInt(e.quantidade, 10) || 0), 0);
    const totalEntradas = totalInicial + totalManual;
    const totalSaidas   = movs.reduce((s, m) => s + (parseInt(m.quantidade, 10) || 0), 0);
    const saldo         = totalEntradas - totalSaidas;

    // Período exibido (sempre a partir de 13/04/2026 no mínimo)
    const cutoffLabel = '13/04/2026';
    let periodLabel = `A partir de ${cutoffLabel}`;
    if (startDateStr && endDateStr) periodLabel = `${_fmtDate(startDateStr) || cutoffLabel} a ${_fmtDate(endDateStr)}`;
    else if (startDateStr) periodLabel = `A partir de ${_fmtDate(startDateStr) || cutoffLabel}`;
    else if (endDateStr)   periodLabel = `${cutoffLabel} até ${_fmtDate(endDateStr)}`;

    const generatedAt = new Date().toLocaleString('pt-BR');

    // Tabela de entradas
    let rowsEstoque = estoque.length === 0
        ? '<tr><td colspan="6" class="empty-row">Nenhuma entrada de estoque no período.</td></tr>'
        : estoque.map(e => {
            const isInicial = e.tipo === 'inicial';
            const badge = isInicial ? '<span class="badge badge-blue">Inicial (Sistema)</span>' : '<span class="badge badge-green">Entrada Manual</span>';
            return `<tr>
                <td>${badge}</td>
                <td class="num">${e.quantidade ?? '—'}</td>
                <td>${_fmtTsDate(e.data)}</td>
                <td>${_escHTML(e.notaFiscal || '—')}</td>
                <td>${_escHTML(e.responsavel || '—')}</td>
                <td class="small-cell">${_fmtTs(e.registradoEm)}</td>
            </tr>`;
        }).join('');

    // Tabela de saídas
    let rowsMovs = movs.length === 0
        ? '<tr><td colspan="7" class="empty-row">Nenhuma saída no período.</td></tr>'
        : movs.map(m => {
            const info = unidadeMap.get(m.unidadeId);
            const tipoUnidade = info?.tipo || ((m.tipoUnidade || '').toUpperCase() === 'SEMCAS' ? 'SEDE' : (m.tipoUnidade || '—').toUpperCase());
            return `<tr>
                <td>${_escHTML(m.unidadeNome || '—')}</td>
                <td><span class="badge-tipo">${_escHTML(tipoUnidade)}</span></td>
                <td class="num">${m.quantidade ?? '—'}</td>
                <td>${_fmtTsDate(m.data)}</td>
                <td>${_escHTML(m.responsavelAlmoxarifado || '—')}</td>
                <td>${_escHTML(m.responsavel || '—')}</td>
                <td class="small-cell">${_fmtTs(m.registradoEm)}</td>
            </tr>`;
        }).join('');

    const saldoClass = saldo < 0 ? 'negative' : (saldo === 0 ? 'zero' : 'positive');

    const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<title>Relatório de Gás — SEMCAS</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', system-ui, Arial, sans-serif; font-size: 11px; color: #0f172a; background: #fff; }
  .report-header { background: linear-gradient(135deg, #0b1f40 0%, #142d5c 55%, #1a3d80 100%); color: #fff; padding: 20px 28px 16px; display: flex; align-items: center; gap: 18px; position: relative; }
  .report-header::after { content: ''; position: absolute; bottom: 0; left: 0; right: 0; height: 4px; background: linear-gradient(90deg, #f59e0b, #fbbf24 15%, #60a5fa 45%, #34d399 75%, #f59e0b); }
  .header-logo { height: 68px; width: auto; filter: drop-shadow(0 2px 4px rgba(0,0,0,.4)); flex-shrink: 0; }
  .header-text h1 { font-size: 20px; font-weight: 800; }
  .header-text .subtitle { font-size: 11px; color: #93c5fd; font-weight: 500; text-transform: uppercase; margin-top: 4px; }
  .header-text .org { font-size: 10px; color: #7dd3fc; margin-top: 2px; }
  .header-meta { margin-left: auto; text-align: right; flex-shrink: 0; }
  .header-meta .doc-title { font-size: 13px; font-weight: 800; color: #fbbf24; text-transform: uppercase; }
  .header-meta .doc-period { font-size: 10px; color: #bfdbfe; margin-top: 3px; }
  .header-meta .doc-generated { font-size: 9px; color: #7dd3fc; margin-top: 2px; }
  .summary-section { display: grid; grid-template-columns: repeat(4, 1fr); border-bottom: 2px solid #cbd5e1; background: #f8fafc; }
  .kpi { padding: 12px 14px; border-right: 1px solid #cbd5e1; text-align: center; }
  .kpi:last-child { border-right: none; }
  .kpi-label { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: .07em; color: #64748b; margin-bottom: 4px; }
  .kpi-value { font-size: 22px; font-weight: 800; line-height: 1; }
  .kpi-value.blue { color: #1e40af; } .kpi-value.red { color: #dc2626; } .kpi-value.positive { color: #16a34a; } .kpi-value.negative { color: #dc2626; } .kpi-value.zero { color: #64748b; }
  .kpi-sub { font-size: 9px; color: #94a3b8; margin-top: 2px; }
  .section-header { background: #0b1f40; color: #fff; padding: 9px 18px; display: flex; align-items: center; gap: 10px; }
  .section-header h2 { font-size: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: .1em; }
  .section-badge { margin-left: auto; background: rgba(255,255,255,.15); color: #e0f2fe; font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 999px; }
  .section-note { background: #fefce8; border-left: 4px solid #fbbf24; padding: 7px 14px; font-size: 10px; color: #78350f; }
  .cutoff-note { background: #eff6ff; border-left: 4px solid #3b82f6; padding: 7px 14px; font-size: 10px; color: #1e40af; font-weight: 600; }
  table { width: 100%; border-collapse: collapse; font-size: 10.5px; }
  thead th { background: #1e3a5f; color: #e0f2fe; padding: 8px 10px; text-align: left; font-size: 9.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .07em; white-space: nowrap; border-bottom: 2px solid #1e40af; }
  thead th.num { text-align: center; }
  tbody tr { border-bottom: 1px solid #e2e8f0; }
  tbody tr:nth-child(even) { background: #f8fafc; }
  tbody td { padding: 7px 10px; vertical-align: middle; color: #334155; }
  tbody td.num { text-align: center; font-weight: 700; }
  tbody td.small-cell { font-size: 9.5px; color: #64748b; white-space: nowrap; }
  .empty-row { text-align: center; padding: 20px !important; color: #94a3b8; font-style: italic; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 9.5px; font-weight: 800; text-transform: uppercase; white-space: nowrap; }
  .badge-blue { background: #dbeafe; color: #1e40af; border: 1px solid #93c5fd; }
  .badge-green { background: #d1fae5; color: #065f46; border: 1px solid #6ee7b7; }
  .badge-tipo { display: inline-block; padding: 1px 6px; border-radius: 5px; font-size: 9px; font-weight: 700; background: #e0e7ff; color: #3730a3; border: 1px solid #c7d2fe; text-transform: uppercase; }
  .spacer { height: 14px; }
  .report-footer { margin-top: 16px; border-top: 2px solid #e2e8f0; padding: 12px 18px; display: flex; align-items: center; justify-content: space-between; background: #f8fafc; font-size: 9px; color: #64748b; }
  .report-footer .sig { font-weight: 700; color: #334155; font-size: 10px; }
  @media print {
    .report-header, .summary-section, .section-header, thead th, tbody tr:nth-child(even), .badge { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    @page { margin: 12mm 10mm; size: A4 landscape; }
  }
</style>
</head>
<body>
<header class="report-header">
  <img src="./SaoLuis.png" alt="Brasão" class="header-logo" onerror="this.style.display='none'">
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

<div class="cutoff-note">⚠️ Este relatório considera apenas dados a partir de <strong>13/04/2026</strong>. Lançamentos anteriores a essa data não são contabilizados.</div>

<div class="summary-section">
  <div class="kpi"><div class="kpi-label">Estoque Inicial</div><div class="kpi-value blue">${totalInicial}</div><div class="kpi-sub">botijões</div></div>
  <div class="kpi"><div class="kpi-label">Entradas Manuais</div><div class="kpi-value blue">${totalManual}</div><div class="kpi-sub">compras</div></div>
  <div class="kpi"><div class="kpi-label">Total Saídas</div><div class="kpi-value red">${totalSaidas}</div><div class="kpi-sub">botijões entregues</div></div>
  <div class="kpi"><div class="kpi-label">Saldo Atual</div><div class="kpi-value ${saldoClass}">${saldo >= 0 ? '+' : ''}${saldo}</div><div class="kpi-sub">disponível</div></div>
</div>

<div class="spacer"></div>

<div class="section-header"><span>📦</span><h2>Entradas de Estoque</h2><span class="section-badge">${estoque.length} registro(s)</span></div>
<div class="section-note"><strong>Inicial (Sistema)</strong> = saldo de abertura definido no sistema · <strong>Entrada Manual</strong> = compra/reposição registrada</div>
<table>
  <thead><tr>
    <th>Tipo</th><th class="num">Qtd.</th><th>Data</th><th>Nota Fiscal</th><th>Responsável</th><th>Lançado Em</th>
  </tr></thead>
  <tbody>${rowsEstoque}</tbody>
</table>

<div class="spacer"></div>

<div class="section-header"><span>📤</span><h2>Saídas por Unidade</h2><span class="section-badge">${movs.length} registro(s)</span></div>
<table>
  <thead><tr>
    <th>Unidade</th><th>Tipo</th><th class="num">Qtd.</th><th>Data</th><th>Resp. Almox.</th><th>Resp. Unidade</th><th>Lançado Em</th>
  </tr></thead>
  <tbody>${rowsMovs}</tbody>
</table>

<footer class="report-footer">
  <div><div class="sig">Prefeitura de São Luís — SEMCAS</div><div>Sistema de Almoxarifado v2</div></div>
  <div style="text-align:center"><div>Período: <strong>${_escHTML(periodLabel)}</strong></div><div>Dados contados a partir de 13/04/2026</div></div>
  <div style="text-align:right"><div>Gerado: <strong>${_escHTML(generatedAt)}</strong></div><div>Documento gerado automaticamente.</div></div>
</footer>
</body>
</html>`;

    const win = window.open('', '_blank');
    if (!win) { alert('Permita pop-ups para este site e tente novamente.'); return; }
    win.document.open();
    win.document.write(html);
    win.document.close();
    win.addEventListener('load', () => setTimeout(() => win.print(), 400));
}
