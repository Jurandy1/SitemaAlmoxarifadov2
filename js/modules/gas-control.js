// js/modules/gas-control.js
import { Timestamp, addDoc, serverTimestamp } from "firebase/firestore";
import { getUnidades, getGasMovimentacoes, isEstoqueInicialDefinido, getCurrentStatusFilter, setCurrentStatusFilter, getEstoqueGas, getUserRole } from "../utils/cache.js";
import { DOM_ELEMENTS, showAlert, switchSubTabView, handleSaldoFilterUI, filterTable, renderPermissionsUI, escapeHTML } from "../utils/dom-helpers.js";
import { getTodayDateString, dateToTimestamp, capitalizeString, formatTimestampComTempo, formatTimestamp } from "../utils/formatters.js";
import { isReady } from "./auth.js";
import { COLLECTIONS } from "../services/firestore-service.js";
import { executeFinalMovimentacao } from "./movimentacao-modal-handler.js";
import { BaseControl } from "./base-control.js";
import { generateGasReport } from "./gas-report.js";

// ─── CORTE DE DATA: apenas dados a partir de 13/04/2026 contam ───────────────
const GAS_CUTOFF_MS = new Date('2026-04-13T00:00:00.000').getTime();
function _filterAfterCutoff(items) {
    return (items || []).filter(item => (item.data?.toMillis?.() ?? 0) >= GAS_CUTOFF_MS);
}

// Instância do BaseControl para Gás (usada apenas para handleInicialEstoqueSubmit)
const gasControl = new BaseControl({
    type: 'gas',
    collectionMov: COLLECTIONS.gasMov,
    collectionEstoque: COLLECTIONS.estoqueGas,
    getMovimentacoes: getGasMovimentacoes,
    getEstoque: getEstoqueGas
});

function _normName(x) { return (x || '').toLowerCase().replace(/\s+/g, ' ').trim(); }

// =========================================================================
// LÓGICA DE ESTOQUE
// =========================================================================

export function renderEstoqueGas() {
    const estoqueEl    = document.getElementById('resumo-estoque-gas');
    const loadingEl    = document.getElementById('loading-estoque-gas');
    const inicialBtnEl = document.getElementById('btn-abrir-inicial-gas');
    const inicialContEl = document.getElementById('form-inicial-gas-container');

    if (loadingEl) loadingEl.classList.add('hidden');

    const estoqueData = _filterAfterCutoff(getEstoqueGas() || []);
    const movs        = _filterAfterCutoff(getGasMovimentacoes() || []);
    const hasInicial  = (getEstoqueGas() || []).some(e => e.tipo === 'inicial' && (e.data?.toMillis?.() ?? 0) >= GAS_CUTOFF_MS);

    const inicial  = estoqueData.filter(e => e.tipo === 'inicial').reduce((s, e) => s + (parseInt(e.quantidade, 10) || 0), 0);
    const entradas = estoqueData.filter(e => e.tipo === 'entrada').reduce((s, e) => s + (parseInt(e.quantidade, 10) || 0), 0);
    const saidas   = movs.filter(m => m.tipo === 'entrega').reduce((s, m) => s + (parseInt(m.quantidade, 10) || 0), 0);
    const atual    = Math.max(0, inicial + entradas - saidas);

    if (!hasInicial) {
        if (inicialContEl) inicialContEl.classList.remove('hidden');
        if (inicialBtnEl)  inicialBtnEl.classList.add('hidden');
        if (estoqueEl)     estoqueEl.classList.add('hidden');
        return;
    }

    if (inicialContEl) inicialContEl.classList.add('hidden');
    if (inicialBtnEl)  inicialBtnEl.classList.remove('hidden');
    if (estoqueEl)     estoqueEl.classList.remove('hidden');

    const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    setEl('estoque-gas-inicial', inicial);
    setEl('estoque-gas-entradas', `+${entradas}`);
    setEl('estoque-gas-saidas', `-${saidas}`);
    setEl('estoque-gas-atual', atual);
}

export async function handleInicialEstoqueSubmit(e) {
    await gasControl.handleInicialEstoqueSubmit(e);
}

export async function handleEntradaEstoqueSubmit(e) {
    e.preventDefault();
    if (!isReady()) { showAlert('alert-gas', 'Erro: Não autenticado.', 'error'); return; }

    const role = getUserRole();
    if (role !== 'admin') {
        showAlert('alert-gas', "Permissão negada. Apenas Administradores podem lançar entradas no estoque.", 'error'); return;
    }

    const quantidade   = parseInt(DOM_ELEMENTS.inputQtdEntradaGas.value, 10);
    const data         = dateToTimestamp(DOM_ELEMENTS.inputDataEntradaGas.value);
    const responsavel  = capitalizeString(DOM_ELEMENTS.inputResponsavelEntradaGas.value.trim());
    const notaFiscal   = DOM_ELEMENTS.inputNfEntradaGas.value.trim() || 'N/A';

    if (!quantidade || quantidade <= 0 || !data || !responsavel) {
        showAlert('alert-gas', 'Dados inválidos. Verifique quantidade, data e responsável.', 'warning'); return;
    }

    DOM_ELEMENTS.btnSubmitEntradaGas.disabled = true;
    DOM_ELEMENTS.btnSubmitEntradaGas.innerHTML = '<div class="loading-spinner-small mx-auto"></div>';

    try {
        await addDoc(COLLECTIONS.estoqueGas, {
            tipo: 'entrada', quantidade, data, responsavel, notaFiscal,
            registradoEm: serverTimestamp()
        });
        showAlert('alert-gas', 'Entrada no estoque salva!', 'success');
        DOM_ELEMENTS.formEntradaGas.reset();
        DOM_ELEMENTS.inputDataEntradaGas.value = getTodayDateString();
    } catch (error) {
        showAlert('alert-gas', `Erro: ${error.message}`, 'error');
    } finally {
        DOM_ELEMENTS.btnSubmitEntradaGas.disabled = false;
        DOM_ELEMENTS.btnSubmitEntradaGas.innerHTML = '<i data-lucide="save"></i> <span>Salvar Entrada</span>';
    }
}

// =========================================================================
// LÓGICA DE MOVIMENTAÇÃO (apenas Saída/Entrega)
// =========================================================================

export function toggleGasFormInputs() {
    // Simplificado: sempre mostra apenas o campo de quantidade de saída
    DOM_ELEMENTS.formGroupQtdEntregueGas?.classList.remove('hidden');
    DOM_ELEMENTS.formGroupQtdRetornoGas?.classList.add('hidden');
    if (DOM_ELEMENTS.inputQtdRetornoGas) DOM_ELEMENTS.inputQtdRetornoGas.value = "0";
}

export function checkUnidadeSaldoAlertGas() {
    if (!DOM_ELEMENTS.selectUnidadeGas) return;
    const selectValue  = DOM_ELEMENTS.selectUnidadeGas.value;
    const saldoAlertaEl = DOM_ELEMENTS.unidadeSaldoAlertaGas;
    if (!selectValue || !saldoAlertaEl) { if (saldoAlertaEl) saldoAlertaEl.style.display = 'none'; return; }

    const [, unidadeNome] = selectValue.split('|');
    const unidadeNomeSafe = escapeHTML(unidadeNome);

    const message = `<i data-lucide="info" class="w-5 h-5 inline-block -mt-1 mr-2"></i> Unidade selecionada: <strong>${unidadeNomeSafe}</strong>`;
    saldoAlertaEl.className = 'alert alert-info mt-2';
    saldoAlertaEl.innerHTML = message;
    saldoAlertaEl.style.display = 'block';
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

export async function handleGasSubmit(e) {
    e.preventDefault();
    if (!isReady()) { showAlert('alert-gas', 'Erro: Não autenticado.', 'error'); return; }

    const role = getUserRole();
    if (role === 'anon') {
        showAlert('alert-gas', "Permissão negada. Usuário Anônimo não pode lançar movimentações.", 'error'); return;
    }

    const submitBtn = e.submitter || e.target.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.disabled = true;

    try {
        const selectValue = DOM_ELEMENTS.selectUnidadeGas.value;
        if (!selectValue) throw new Error('Selecione uma unidade.');
        const [unidadeId, unidadeNome, tipoUnidadeRaw] = selectValue.split('|');

        const tipoMovimentacao = 'entrega'; // Sempre saída — retorno removido
        const qtdEntregue      = parseInt(DOM_ELEMENTS.inputQtdEntregueGas.value, 10) || 0;
        const qtdRetorno       = 0;
        const data             = dateToTimestamp(DOM_ELEMENTS.inputDataGas.value);
        const responsavelUnidade = capitalizeString(DOM_ELEMENTS.inputResponsavelGas.value.trim());

        if (!unidadeId || !data || !responsavelUnidade) throw new Error('Dados inválidos. Verifique Unidade, Data e Responsável.');
        if (qtdEntregue <= 0) throw new Error('A quantidade deve ser maior que zero.');

        if (!isEstoqueInicialDefinido('gas')) throw new Error('Defina o Estoque Inicial de Gás antes de lançar saídas.');

        const estoqueData    = _filterAfterCutoff(getEstoqueGas() || []);
        const movsCutoff     = _filterAfterCutoff(getGasMovimentacoes() || []);
        const estoqueInicial = estoqueData.filter(e => e.tipo === 'inicial').reduce((sum, e) => sum + (parseInt(e.quantidade, 10) || 0), 0);
        const totalEntradas  = estoqueData.filter(e => e.tipo === 'entrada').reduce((sum, e) => sum + (parseInt(e.quantidade, 10) || 0), 0);
        const totalSaidas    = movsCutoff.filter(m => m.tipo === 'entrega').reduce((sum, m) => sum + (parseInt(m.quantidade, 10) || 0), 0);
        const estoqueAtual   = Math.max(0, estoqueInicial + totalEntradas - totalSaidas);

        if (qtdEntregue > estoqueAtual) throw new Error(`Estoque insuficiente. Disponível: ${estoqueAtual}`);

        executeFinalMovimentacao({ unidadeId, unidadeNome, tipoUnidadeRaw, tipoMovimentacao, qtdEntregue, qtdRetorno, data, responsavelUnidade, itemType: 'gas' });

    } catch (error) {
        showAlert('alert-gas', error.message, 'warning');
        if (submitBtn) submitBtn.disabled = false;
    }
}

// =========================================================================
// STATUS — apenas saídas após o corte
// =========================================================================

export function renderGasStatus() {
    if (!DOM_ELEMENTS.tableStatusGas) return;

    const statusMap = new Map();
    getUnidades().forEach(u => {
        let tipo = (u.tipo || 'N/A').toUpperCase();
        if (tipo === 'SEMCAS') tipo = 'SEDE';
        statusMap.set(u.id, { id: u.id, nome: u.nome, tipo, totalSaidas: 0, ultimoLancamento: null });
    });

    const movs = _filterAfterCutoff([...getGasMovimentacoes()]).sort((a, b) => (b.data?.toMillis() || 0) - (a.data?.toMillis() || 0));

    movs.forEach(m => {
        const s = statusMap.get(m.unidadeId);
        if (!s) return;
        if (m.tipo === 'entrega') s.totalSaidas += (parseInt(m.quantidade, 10) || 0);
        if (!s.ultimoLancamento) s.ultimoLancamento = { data: m.data, respAlmox: m.responsavelAlmoxarifado || 'N/A', respUnidade: m.responsavel };
    });

    const lista = Array.from(statusMap.values()).filter(s => s.totalSaidas > 0).sort((a, b) => b.totalSaidas - a.totalSaidas || a.nome.localeCompare(b.nome));

    if (lista.length === 0) {
        DOM_ELEMENTS.tableStatusGas.innerHTML = '<tr><td colspan="4" class="text-center py-4 text-slate-500">Nenhuma saída registrada após 13/04/2026.</td></tr>';
        return;
    }

    DOM_ELEMENTS.tableStatusGas.innerHTML = lista.map(s => {
        const ult = s.ultimoLancamento;
        const ultDet = ult ? `${formatTimestampComTempo(ult.data)} — Almox: ${ult.respAlmox} / Unid: ${ult.respUnidade}` : 'N/A';
        return `<tr>
            <td class="font-medium">${escapeHTML(s.nome)}</td>
            <td>${escapeHTML(s.tipo)}</td>
            <td class="text-center font-bold text-blue-700">${s.totalSaidas}</td>
            <td class="text-xs text-gray-600">${ultDet}</td>
        </tr>`;
    }).join('');

    if (typeof lucide !== 'undefined') lucide.createIcons();

    const filtro = document.getElementById('filtro-status-gas');
    if (filtro && filtro.value) filterTable(filtro, 'table-status-gas');
}

// Mantido para compatibilidade (removido conceito de débito)
export function renderGasDebitosResumo() {
    if (!DOM_ELEMENTS.tableDebitoGasResumo) return;
    DOM_ELEMENTS.tableDebitoGasResumo.innerHTML = '<tr><td colspan="4" class="text-center py-4 text-slate-500">Seção de débitos removida. Use "Saldo nas Unidades" para ver o histórico de saídas.</td></tr>';
}

export function getDebitosGasResumoList() { return []; }

// =========================================================================
// HISTÓRICO DE ESTOQUE — filtrado pelo corte
// =========================================================================

export function renderGasEstoqueHistory() {
    if (!DOM_ELEMENTS.tableHistoricoEstoqueGas) return;

    const estoque  = _filterAfterCutoff(getEstoqueGas());
    const role     = getUserRole();
    const isAdmin  = role === 'admin';

    const ordenado = [...estoque].sort((a, b) => (b.registradoEm?.toMillis() || 0) - (a.registradoEm?.toMillis() || 0));

    if (ordenado.length === 0) {
        DOM_ELEMENTS.tableHistoricoEstoqueGas.innerHTML = `<tr><td colspan="7" class="text-center py-4 text-slate-500">Nenhuma entrada de estoque após 13/04/2026.</td></tr>`;
        return;
    }

    DOM_ELEMENTS.tableHistoricoEstoqueGas.innerHTML = ordenado.map(m => {
        const isInicial  = m.tipo === 'inicial';
        const tipoText   = isInicial ? 'Inicial (Sistema)' : 'Entrada Manual';
        const tipoClass  = isInicial ? 'badge-blue' : 'badge-green';
        const dataMov    = formatTimestampComTempo(m.data);
        const dataLanc   = formatTimestampComTempo(m.registradoEm);
        const details    = `${isInicial ? 'Estoque Inicial' : 'Entrada'}: ${m.quantidade} unidades.`;
        const actionHtml = isAdmin
            ? `<button class="btn-danger btn-remove btn-icon" data-id="${m.id}" data-type="entrada-gas" data-details="${details}"><i data-lucide="trash-2"></i></button>`
            : `<span class="text-gray-400 btn-icon"><i data-lucide="slash"></i></span>`;
        return `<tr>
            <td><span class="badge ${tipoClass}">${tipoText}</span></td>
            <td class="text-center font-medium">${m.quantidade}</td>
            <td>${dataMov}</td>
            <td>${m.notaFiscal || '—'}</td>
            <td>${m.responsavel || '—'}</td>
            <td class="text-center text-xs">${dataLanc}</td>
            <td class="text-center">${actionHtml}</td>
        </tr>`;
    }).join('');

    if (typeof lucide !== 'undefined') lucide.createIcons();

    const filtro = DOM_ELEMENTS.filtroHistoricoEstoqueGas;
    if (filtro && filtro.value) filterTable(filtro, DOM_ELEMENTS.tableHistoricoEstoqueGas.id);
}

// =========================================================================
// HISTÓRICO GERAL — filtrado pelo corte
// =========================================================================

export function renderGasMovimentacoesHistory() {
    if (!DOM_ELEMENTS.tableHistoricoGasAll) return;

    const role    = getUserRole();
    const isAdmin = role === 'admin';

    const ordenado = getFilteredGasMovimentacoes().sort((a, b) => (b.registradoEm?.toMillis() || 0) - (a.registradoEm?.toMillis() || 0));

    if (ordenado.length === 0) {
        DOM_ELEMENTS.tableHistoricoGasAll.innerHTML = `<tr><td colspan="9" class="text-center py-4 text-slate-500">Nenhuma movimentação após 13/04/2026.</td></tr>`;
        return;
    }

    DOM_ELEMENTS.tableHistoricoGasAll.innerHTML = ordenado.map(m => {
        const dataMov    = formatTimestampComTempo(m.data);
        const dataLanc   = formatTimestampComTempo(m.registradoEm);
        const respAlmox  = m.responsavelAlmoxarifado || 'N/A';
        const respUnid   = m.responsavel || 'N/A';
        const details    = `Saída ${m.unidadeNome} (${m.quantidade})`;
        const actionHtml = isAdmin
            ? `<button class="btn-danger btn-remove btn-icon" data-id="${m.id}" data-type="gas" data-details="${details}"><i data-lucide="trash-2"></i></button>`
            : `<span class="text-gray-400 btn-icon"><i data-lucide="slash"></i></span>`;
        return `<tr>
            <td class="text-xs text-gray-500">${m.id}</td>
            <td>${m.unidadeNome || 'N/A'}</td>
            <td><span class="badge badge-red">Saída</span></td>
            <td class="text-center font-medium">${m.quantidade}</td>
            <td>${dataMov}</td>
            <td>${respAlmox}</td>
            <td>${respUnid}</td>
            <td class="text-center text-xs">${dataLanc}</td>
            <td class="text-center">${actionHtml}</td>
        </tr>`;
    }).join('');

    if (typeof lucide !== 'undefined') lucide.createIcons();

    const filtro = document.getElementById('filtro-historico-gas');
    if (filtro && filtro.value) filterTable(filtro, DOM_ELEMENTS.tableHistoricoGasAll.id);

    checkGasHistoryIntegrity();
}

function populateGasFilterUnidades() {
    const sel = document.getElementById('filtro-unidade-gas');
    if (!sel) return;
    const tipoUnidSel = (document.getElementById('filtro-unidade-tipo-gas')?.value || '').toUpperCase();
    const unidades    = getUnidades().filter(u => {
        let uTipo = (u.tipo || 'N/A').toUpperCase();
        if (uTipo === 'SEMCAS') uTipo = 'SEDE';
        return !tipoUnidSel || uTipo === tipoUnidSel;
    });
    const anterior = sel.value;
    sel.innerHTML  = '<option value="">Todas</option>';
    unidades.sort((a, b) => a.nome.localeCompare(b.nome)).forEach(u => {
        const opt     = document.createElement('option');
        opt.value     = u.id;
        opt.textContent = u.nome;
        sel.appendChild(opt);
    });
    sel.value = anterior || '';
}

function getFilteredGasMovimentacoes() {
    const tipoEl        = document.getElementById('filtro-tipo-gas');
    const unidadeEl     = document.getElementById('filtro-unidade-gas');
    const unidadeTipoEl = document.getElementById('filtro-unidade-tipo-gas');
    const respEl        = document.getElementById('filtro-responsavel-gas');
    const origemEl      = document.getElementById('filtro-origem-gas');
    const dataIniEl     = document.getElementById('filtro-data-inicio-gas');
    const dataFimEl     = document.getElementById('filtro-data-fim-gas');

    const tipo                   = tipoEl?.value || '';
    const unidadeId              = unidadeEl?.value || '';
    const unidadeTipoSelecionado = (unidadeTipoEl?.value || '').toUpperCase();
    const respQuery              = (respEl?.value || '').trim().toLowerCase();
    const origem                 = origemEl?.value || '';
    const dataIniStr             = dataIniEl?.value || '';
    const dataFimStr             = dataFimEl?.value || '';

    // Aplica corte de data + apenas entregas
    const base      = _filterAfterCutoff(getGasMovimentacoes()).filter(m => m.tipo === 'entrega');
    const dataIniMs = dataIniStr ? dateToTimestamp(dataIniStr)?.toMillis() : null;
    const dataFimMs = dataFimStr ? (dateToTimestamp(dataFimStr)?.toMillis() ?? null) : null;
    const dataFimEOD = dataFimMs ? dataFimMs + 86_399_999 : null;

    const unidadesMap = new Map(getUnidades().map(u => {
        let uTipo = (u.tipo || 'N/A').toUpperCase();
        if (uTipo === 'SEMCAS') uTipo = 'SEDE';
        return [u.id, { tipo: uTipo }];
    }));

    return base.filter(m => {
        if (unidadeId && m.unidadeId !== unidadeId) return false;
        if (unidadeTipoSelecionado) {
            const info = unidadesMap.get(m.unidadeId);
            if (!info || info.tipo !== unidadeTipoSelecionado) return false;
        }
        const isImport = ((m.responsavel || '').toLowerCase().includes('importa')) || ((m.observacao || '').toLowerCase().includes('importado'));
        if (origem === 'importacao' && !isImport) return false;
        if (origem === 'manual'     &&  isImport) return false;
        if (respQuery) {
            const ru = (m.responsavel || '').toLowerCase();
            const ra = (m.responsavelAlmoxarifado || '').toLowerCase();
            if (!ru.includes(respQuery) && !ra.includes(respQuery)) return false;
        }
        const movMs = m.data?.toMillis?.() ?? null;
        if (dataIniMs  && movMs && movMs < dataIniMs)  return false;
        if (dataFimEOD && movMs && movMs > dataFimEOD) return false;
        return true;
    });
}

function checkGasHistoryIntegrity() {
    const movs  = _filterAfterCutoff(getGasMovimentacoes()).filter(m => m.tipo === 'entrega');
    const estoque = _filterAfterCutoff(getEstoqueGas());
    let incons = 0;
    movs.forEach(m => { if (!m.id || !m.unidadeId || !m.data || !m.quantidade) incons++; });
    const msg = incons === 0 ? 'Integridade OK — nenhuma inconsistência detectada.' : `${incons} possíveis inconsistências encontradas.`;
    if (document.getElementById('alert-historico-gas')) showAlert('alert-historico-gas', msg, incons === 0 ? 'info' : 'warning');
    if (document.getElementById('alert-historico-estoque-gas')) showAlert('alert-historico-estoque-gas', `${estoque.length} registro(s) de estoque a partir de 13/04/2026.`, 'info');
}

// =========================================================================
// LISTENERS
// =========================================================================

export function initGasListeners() {
    if (DOM_ELEMENTS.formGas)             DOM_ELEMENTS.formGas.addEventListener('submit', handleGasSubmit);
    if (DOM_ELEMENTS.selectUnidadeGas)    DOM_ELEMENTS.selectUnidadeGas.addEventListener('change', checkUnidadeSaldoAlertGas);
    if (DOM_ELEMENTS.formInicialGas)      DOM_ELEMENTS.formInicialGas.addEventListener('submit', handleInicialEstoqueSubmit);
    if (DOM_ELEMENTS.btnAbrirInicialGas)  DOM_ELEMENTS.btnAbrirInicialGas.addEventListener('click', () => {
        DOM_ELEMENTS.formInicialGasContainer?.classList.remove('hidden');
        DOM_ELEMENTS.btnAbrirInicialGas?.classList.add('hidden');
    });
    if (DOM_ELEMENTS.formEntradaGas)      DOM_ELEMENTS.formEntradaGas.addEventListener('submit', handleEntradaEstoqueSubmit);

    // Filtros status
    const filtroStatus = document.getElementById('filtro-status-gas');
    if (filtroStatus) filtroStatus.addEventListener('input', () => filterTable(filtroStatus, 'table-status-gas'));

    // Filtros histórico geral
    const filtroHist = document.getElementById('filtro-historico-gas');
    if (filtroHist) filtroHist.addEventListener('input', () => filterTable(filtroHist, 'table-historico-gas-all'));

    ['filtro-tipo-gas','filtro-unidade-gas','filtro-responsavel-gas','filtro-origem-gas','filtro-data-inicio-gas','filtro-data-fim-gas'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', () => {
            renderGasMovimentacoesHistory();
            if (filtroHist && filtroHist.value) filterTable(filtroHist, 'table-historico-gas-all');
        });
    });

    const tipoUnidadeGas = document.getElementById('filtro-unidade-tipo-gas');
    if (tipoUnidadeGas) tipoUnidadeGas.addEventListener('change', () => { populateGasFilterUnidades(); renderGasMovimentacoesHistory(); });

    const btnClear = document.getElementById('btn-limpar-filtros-gas');
    if (btnClear) btnClear.addEventListener('click', () => {
        ['filtro-tipo-gas','filtro-unidade-tipo-gas','filtro-unidade-gas','filtro-responsavel-gas','filtro-origem-gas','filtro-data-inicio-gas','filtro-data-fim-gas'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
        populateGasFilterUnidades();
        renderGasMovimentacoesHistory();
    });

    populateGasFilterUnidades();

    if (DOM_ELEMENTS.filtroHistoricoEstoqueGas) {
        DOM_ELEMENTS.filtroHistoricoEstoqueGas.addEventListener('input', () => filterTable(DOM_ELEMENTS.filtroHistoricoEstoqueGas, DOM_ELEMENTS.tableHistoricoEstoqueGas.id));
    }

    // Sub-navegação principal
    const subNavGas = document.getElementById('sub-nav-gas');
    if (subNavGas) subNavGas.addEventListener('click', e => {
        const btn = e.target.closest('.sub-nav-btn');
        if (btn?.dataset.subview) switchSubTabView('gas', btn.dataset.subview);
    });

    // Filtros de saldo (mantidos para status simples)
    document.querySelectorAll('#filtro-saldo-gas-controls button').forEach(btn => btn.addEventListener('click', (e) => {
        document.querySelectorAll('#filtro-saldo-gas-controls button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        renderGasStatus();
    }));

    // Abas do formulário (Saída / Entrada no Estoque)
    document.querySelectorAll('#content-gas .form-tab-btn').forEach(btn => btn.addEventListener('click', () => {
        const formName = btn.dataset.form;
        document.querySelectorAll('#content-gas .form-tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        if (DOM_ELEMENTS.formGas)       DOM_ELEMENTS.formGas.classList.toggle('hidden', formName !== 'saida-gas');
        if (DOM_ELEMENTS.formEntradaGas) DOM_ELEMENTS.formEntradaGas.classList.toggle('hidden', formName !== 'entrada-gas');
        renderPermissionsUI();
    }));

    // Inner nav do lançamento — mostra diretamente o form
    const innerNavGas = document.querySelector('#subview-movimentacao-gas .module-inner-subnav');
    if (innerNavGas) {
        innerNavGas.addEventListener('click', e => {
            const btn = e.target.closest('button.sub-nav-btn[data-inner]');
            if (!btn) return;
            const target = btn.dataset.inner;
            document.querySelectorAll('#subview-movimentacao-gas .module-inner-subnav .sub-nav-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            DOM_ELEMENTS.innerGasLancamento?.classList.remove('hidden');
            DOM_ELEMENTS.innerGasResumo?.classList.add('hidden');
        });
    }

    // Btn ver status
    if (DOM_ELEMENTS.btnVerStatusGas) DOM_ELEMENTS.btnVerStatusGas.addEventListener('click', () => switchSubTabView('gas', 'status-gas'));

    // Relatório
    const btnRelGas = document.getElementById('btn-gerar-relatorio-gas');
    if (btnRelGas) btnRelGas.addEventListener('click', () => {
        const start = document.getElementById('relatorio-gas-data-inicio')?.value || '';
        const end   = document.getElementById('relatorio-gas-data-fim')?.value   || '';
        generateGasReport(start, end);
    });
}

export function onGasTabChange() {
    const currentSubView = document.querySelector('#sub-nav-gas .sub-nav-btn.active')?.dataset.subview || 'movimentacao-gas';
    switchSubTabView('gas', currentSubView);

    toggleGasFormInputs();
    checkUnidadeSaldoAlertGas();
    renderEstoqueGas();
    renderGasEstoqueHistory();
    renderGasStatus();
    renderGasMovimentacoesHistory();

    if (DOM_ELEMENTS.inputDataGas)       DOM_ELEMENTS.inputDataGas.value       = getTodayDateString();
    if (DOM_ELEMENTS.inputDataEntradaGas) DOM_ELEMENTS.inputDataEntradaGas.value = getTodayDateString();

    // Por padrão, mostrar direto o formulário de lançamento
    if (DOM_ELEMENTS.innerGasResumo)     DOM_ELEMENTS.innerGasResumo.classList.add('hidden');
    if (DOM_ELEMENTS.innerGasLancamento) DOM_ELEMENTS.innerGasLancamento.classList.remove('hidden');

    // Ativar botão de lançamento no inner nav
    DOM_ELEMENTS.btnInnerGasLancamento?.classList.add('active');
    DOM_ELEMENTS.btnInnerGasResumo?.classList.remove('active');

    populateGasFilterUnidades();
    checkGasHistoryIntegrity();
    renderPermissionsUI();
}
