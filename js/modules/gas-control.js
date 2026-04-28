// js/modules/gas-control.js
// Módulo de Controle de Gás — SEMCAS Almoxarifado v2

import { Timestamp, addDoc, serverTimestamp } from "firebase/firestore";
import {
    getUnidades, getGasMovimentacoes,
    isEstoqueInicialDefinido, getEstoqueGas, getUserRole
} from "../utils/cache.js";
import {
    DOM_ELEMENTS, showAlert, switchSubTabView,
    filterTable, renderPermissionsUI, escapeHTML
} from "../utils/dom-helpers.js";
import {
    getTodayDateString, dateToTimestamp,
    capitalizeString, formatTimestampComTempo
} from "../utils/formatters.js";
import { isReady }                   from "./auth.js";
import { COLLECTIONS }               from "../services/firestore-service.js";
import { executeFinalMovimentacao }  from "./movimentacao-modal-handler.js";
import { generateGasReport }         from "./gas-report.js";

// ─── CORTE DE DATA: apenas dados a partir de 13/04/2026 contam ───────────────
const GAS_CUTOFF_MS = new Date('2026-04-13T00:00:00.000').getTime();

function _filterAfterCutoff(items) {
    return (items || []).filter(item => (item.data?.toMillis?.() ?? 0) >= GAS_CUTOFF_MS);
}

// =========================================================================
// UTILITÁRIOS INTERNOS
// =========================================================================

/**
 * Renderiza ícones Lucide com escopo no elemento recebido.
 * Evita re-processar ícones já existentes no restante da página.
 */
function _lucide(el) {
    if (typeof lucide === 'undefined') return;
    try {
        lucide.createIcons({ el: el ?? document.body });
    } catch (_) {
        lucide.createIcons();
    }
}

/**
 * Botão de exclusão (admin) ou ícone de bloqueio (demais perfis).
 * Usa data-attributes padrão reconhecidos pelo handler global de delete.
 */
function _actionBtn(id, type, details, isAdmin) {
    if (isAdmin) {
        return `<button
            class="btn-danger btn-remove btn-icon"
            title="Excluir registro"
            data-id="${escapeHTML(String(id))}"
            data-type="${escapeHTML(type)}"
            data-details="${escapeHTML(details)}"
        ><i data-lucide="trash-2"></i></button>`;
    }
    return `<span class="text-gray-300 btn-icon" title="Sem permissão de exclusão">
        <i data-lucide="slash"></i></span>`;
}

/** Linha única de tabela vazia. */
function _emptyRow(cols, msg) {
    return `<tr><td colspan="${cols}"
        class="text-center py-8 text-slate-400 italic text-sm">${msg}</td></tr>`;
}

/** Badge colorido. */
function _badge(cls, text) {
    return `<span class="badge ${escapeHTML(cls)}">${escapeHTML(text)}</span>`;
}

// =========================================================================
// ESTOQUE — PAINEL RESUMO
// =========================================================================

export function renderEstoqueGas() {
    const estoqueEl    = document.getElementById('resumo-estoque-gas');
    const loadingEl    = document.getElementById('loading-estoque-gas');
    const inicialBtnEl = document.getElementById('btn-abrir-inicial-gas');
    const inicialContEl = document.getElementById('form-inicial-gas-container');

    loadingEl?.classList.add('hidden');

    const estoqueData = _filterAfterCutoff(getEstoqueGas() || []);
    const movs        = _filterAfterCutoff(getGasMovimentacoes() || []);
    const hasInicial  = estoqueData.some(e => e.tipo === 'inicial');

    const inicial  = estoqueData.filter(e => e.tipo === 'inicial').reduce((s, e) => s + (parseInt(e.quantidade, 10) || 0), 0);
    const entradas = estoqueData.filter(e => e.tipo === 'entrada').reduce((s, e) => s + (parseInt(e.quantidade, 10) || 0), 0);
    const saidas   = movs.filter(m => m.tipo === 'entrega').reduce((s, m) => s + (parseInt(m.quantidade, 10) || 0), 0);
    const atual    = Math.max(0, inicial + entradas - saidas);

    if (!hasInicial) {
        inicialContEl?.classList.remove('hidden');
        inicialBtnEl?.classList.add('hidden');
        estoqueEl?.classList.add('hidden');
        return;
    }

    inicialContEl?.classList.add('hidden');
    inicialBtnEl?.classList.remove('hidden');
    estoqueEl?.classList.remove('hidden');

    const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    setEl('estoque-gas-inicial',  inicial);
    setEl('estoque-gas-entradas', `+${entradas}`);
    setEl('estoque-gas-saidas',   `-${saidas}`);
    setEl('estoque-gas-atual',    atual);
}

// =========================================================================
// ESTOQUE — PONTA-PÉ INICIAL
// =========================================================================

export async function handleInicialEstoqueSubmit(e) {
    e.preventDefault();

    if (!isReady()) {
        showAlert('alert-inicial-gas', 'Erro: Não autenticado.', 'error');
        return;
    }

    const role = getUserRole();
    if (role !== 'admin') {
        showAlert('alert-inicial-gas', 'Permissão negada. Apenas Administradores podem definir o estoque inicial.', 'error');
        return;
    }

    // IDs corretos do formulário #form-inicial-gas
    const qtdEl     = document.getElementById('input-inicial-qtd-gas');
    const respEl    = document.getElementById('input-inicial-responsavel-gas');
    const submitBtn = document.getElementById('btn-submit-inicial-gas');

    const quantidade  = parseInt(qtdEl?.value, 10);
    const responsavel = capitalizeString((respEl?.value || '').trim());

    if (isNaN(quantidade) || quantidade < 0) {
        showAlert('alert-inicial-gas', 'Informe uma quantidade inicial válida (mínimo 0).', 'warning');
        return;
    }
    if (!responsavel) {
        showAlert('alert-inicial-gas', 'Informe o nome do responsável.', 'warning');
        return;
    }

    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<div class="loading-spinner-small mx-auto"></div>';
    }

    try {
        // data: Timestamp.now() garante que o registro passa o filtro _filterAfterCutoff
        await addDoc(COLLECTIONS.estoqueGas, {
            tipo:         'inicial',
            quantidade,
            responsavel,
            data:         Timestamp.now(),
            registradoEm: serverTimestamp(),
        });
        showAlert('alert-inicial-gas', '✅ Estoque inicial de gás definido com sucesso!', 'success');
        e.target?.reset();
        // O listener Firestore atualiza o cache e dispara renderEstoqueGas automaticamente.
    } catch (error) {
        showAlert('alert-inicial-gas', `Erro ao salvar: ${error.message}`, 'error');
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i data-lucide="save"></i><span>Salvar Inicial</span>';
            _lucide(submitBtn.parentElement);
        }
    }
}

// =========================================================================
// ESTOQUE — ENTRADA MANUAL
// =========================================================================

export async function handleEntradaEstoqueSubmit(e) {
    e.preventDefault();

    if (!isReady()) { showAlert('alert-gas', 'Erro: Não autenticado.', 'error'); return; }

    const role = getUserRole();
    if (role !== 'admin') {
        showAlert('alert-gas', 'Permissão negada. Apenas Administradores podem lançar entradas no estoque.', 'error');
        return;
    }

    const quantidade  = parseInt(DOM_ELEMENTS.inputQtdEntradaGas?.value, 10);
    const data        = dateToTimestamp(DOM_ELEMENTS.inputDataEntradaGas?.value);
    const responsavel = capitalizeString(DOM_ELEMENTS.inputResponsavelEntradaGas?.value.trim());
    const notaFiscal  = DOM_ELEMENTS.inputNfEntradaGas?.value.trim() || 'N/A';

    if (!quantidade || quantidade <= 0 || !data || !responsavel) {
        showAlert('alert-gas', 'Dados inválidos. Verifique quantidade, data e responsável.', 'warning');
        return;
    }

    const btn = DOM_ELEMENTS.btnSubmitEntradaGas;
    if (btn) { btn.disabled = true; btn.innerHTML = '<div class="loading-spinner-small mx-auto"></div>'; }

    try {
        await addDoc(COLLECTIONS.estoqueGas, {
            tipo: 'entrada', quantidade, data, responsavel, notaFiscal,
            registradoEm: serverTimestamp(),
        });
        showAlert('alert-gas', '✅ Entrada no estoque salva com sucesso!', 'success');
        DOM_ELEMENTS.formEntradaGas?.reset();
        if (DOM_ELEMENTS.inputDataEntradaGas) DOM_ELEMENTS.inputDataEntradaGas.value = getTodayDateString();
    } catch (error) {
        showAlert('alert-gas', `Erro: ${error.message}`, 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i data-lucide="save"></i> <span>Salvar Entrada</span>';
            _lucide(btn.parentElement);
        }
    }
}

// =========================================================================
// MOVIMENTAÇÃO — FORMULÁRIO (Saída / Entrega)
// =========================================================================

export function toggleGasFormInputs() {
    DOM_ELEMENTS.formGroupQtdEntregueGas?.classList.remove('hidden');
    DOM_ELEMENTS.formGroupQtdRetornoGas?.classList.add('hidden');
    if (DOM_ELEMENTS.inputQtdRetornoGas) DOM_ELEMENTS.inputQtdRetornoGas.value = '0';
}

export function checkUnidadeSaldoAlertGas() {
    const sel     = DOM_ELEMENTS.selectUnidadeGas;
    const alertEl = DOM_ELEMENTS.unidadeSaldoAlertaGas;
    if (!sel || !alertEl) return;

    const val = sel.value;
    if (!val) { alertEl.style.display = 'none'; return; }

    const [, unidadeNome] = val.split('|');
    alertEl.className = 'alert alert-info mt-2';
    alertEl.innerHTML = `<i data-lucide="info" class="w-5 h-5 inline-block -mt-1 mr-2"></i>
        Unidade selecionada: <strong>${escapeHTML(unidadeNome)}</strong>`;
    alertEl.style.display = 'block';
    _lucide(alertEl);
}

export async function handleGasSubmit(e) {
    e.preventDefault();

    if (!isReady()) { showAlert('alert-gas', 'Erro: Não autenticado.', 'error'); return; }

    const role = getUserRole();
    if (role === 'anon') {
        showAlert('alert-gas', 'Permissão negada. Usuário Anônimo não pode lançar movimentações.', 'error');
        return;
    }

    const submitBtn = e.submitter || e.target.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.disabled = true;

    try {
        const selectValue = DOM_ELEMENTS.selectUnidadeGas?.value;
        if (!selectValue) throw new Error('Selecione uma unidade.');

        const [unidadeId, unidadeNome, tipoUnidadeRaw] = selectValue.split('|');
        const tipoMovimentacao   = 'entrega';
        const qtdEntregue        = parseInt(DOM_ELEMENTS.inputQtdEntregueGas?.value, 10) || 0;
        const qtdRetorno         = 0;
        const data               = dateToTimestamp(DOM_ELEMENTS.inputDataGas?.value);
        const responsavelUnidade = capitalizeString(DOM_ELEMENTS.inputResponsavelGas?.value.trim());

        if (!unidadeId || !data || !responsavelUnidade)
            throw new Error('Dados inválidos. Verifique Unidade, Data e Responsável.');
        if (qtdEntregue <= 0)
            throw new Error('A quantidade deve ser maior que zero.');
        if (!isEstoqueInicialDefinido('gas'))
            throw new Error('Defina o Estoque Inicial de Gás antes de lançar saídas.');

        const estoqueData    = _filterAfterCutoff(getEstoqueGas() || []);
        const movsCutoff     = _filterAfterCutoff(getGasMovimentacoes() || []);
        const estoqueInicial = estoqueData.filter(e => e.tipo === 'inicial').reduce((s, e) => s + (parseInt(e.quantidade, 10) || 0), 0);
        const totalEntradas  = estoqueData.filter(e => e.tipo === 'entrada').reduce((s, e) => s + (parseInt(e.quantidade, 10) || 0), 0);
        const totalSaidas    = movsCutoff.filter(m => m.tipo === 'entrega').reduce((s, m) => s + (parseInt(m.quantidade, 10) || 0), 0);
        const estoqueAtual   = Math.max(0, estoqueInicial + totalEntradas - totalSaidas);

        if (qtdEntregue > estoqueAtual)
            throw new Error(`Estoque insuficiente. Disponível: ${estoqueAtual} botijão(ões).`);

        executeFinalMovimentacao({
            unidadeId, unidadeNome, tipoUnidadeRaw,
            tipoMovimentacao, qtdEntregue, qtdRetorno,
            data, responsavelUnidade, itemType: 'gas',
        });

    } catch (error) {
        showAlert('alert-gas', error.message, 'warning');
        if (submitBtn) submitBtn.disabled = false;
    }
}

// =========================================================================
// STATUS — SALDO POR UNIDADE (após o corte)
// =========================================================================

export function renderGasStatus() {
    const table = DOM_ELEMENTS.tableStatusGas;
    if (!table) return;

    const statusMap = new Map();
    getUnidades().forEach(u => {
        let tipo = (u.tipo || 'N/A').toUpperCase();
        if (tipo === 'SEMCAS') tipo = 'SEDE';
        statusMap.set(u.id, { id: u.id, nome: u.nome, tipo, totalSaidas: 0, ultimoLancamento: null });
    });

    const movs = _filterAfterCutoff([...getGasMovimentacoes()])
        .sort((a, b) => (b.data?.toMillis() || 0) - (a.data?.toMillis() || 0));

    movs.forEach(m => {
        const s = statusMap.get(m.unidadeId);
        if (!s) return;
        if (m.tipo === 'entrega') s.totalSaidas += (parseInt(m.quantidade, 10) || 0);
        if (!s.ultimoLancamento) s.ultimoLancamento = {
            data:        m.data,
            respAlmox:   m.responsavelAlmoxarifado || 'N/A',
            respUnidade: m.responsavel,
        };
    });

    const lista = Array.from(statusMap.values())
        .filter(s => s.totalSaidas > 0)
        .sort((a, b) => b.totalSaidas - a.totalSaidas || a.nome.localeCompare(b.nome));

    if (lista.length === 0) {
        table.innerHTML = _emptyRow(4, 'Nenhuma saída registrada após 13/04/2026.');
        return;
    }

    table.innerHTML = lista.map(s => {
        const ult    = s.ultimoLancamento;
        const ultDet = ult
            ? `${formatTimestampComTempo(ult.data)} — Almox: ${escapeHTML(ult.respAlmox)} / Unid: ${escapeHTML(ult.respUnidade)}`
            : 'N/A';
        return `<tr>
            <td class="font-medium">${escapeHTML(s.nome)}</td>
            <td>${escapeHTML(s.tipo)}</td>
            <td class="text-center font-bold text-blue-700">${s.totalSaidas}</td>
            <td class="text-xs text-gray-600">${ultDet}</td>
        </tr>`;
    }).join('');

    _lucide(table);

    const filtro = document.getElementById('filtro-status-gas');
    if (filtro?.value) filterTable(filtro, 'table-status-gas');
}

// Mantido para compatibilidade — seção de débitos foi removida do módulo de gás
export function renderGasDebitosResumo() {}
export function getDebitosGasResumoList() { return []; }

// =========================================================================
// HISTÓRICO — ENTRADAS DE ESTOQUE
// =========================================================================

export function renderGasEstoqueHistory() {
    const table = DOM_ELEMENTS.tableHistoricoEstoqueGas;
    if (!table) return;

    const isAdmin  = getUserRole() === 'admin';
    const ordenado = [..._filterAfterCutoff(getEstoqueGas())]
        .sort((a, b) => (b.registradoEm?.toMillis() || 0) - (a.registradoEm?.toMillis() || 0));

    if (ordenado.length === 0) {
        table.innerHTML = _emptyRow(7, 'Nenhuma entrada de estoque após 13/04/2026.');
        return;
    }

    table.innerHTML = ordenado.map(m => {
        const isInicial = m.tipo === 'inicial';
        const details   = `${isInicial ? 'Estoque Inicial' : 'Entrada Manual'}: ${m.quantidade} botijão(ões).`;
        return `<tr>
            <td>${_badge(isInicial ? 'badge-blue' : 'badge-green', isInicial ? 'Inicial (Sistema)' : 'Entrada Manual')}</td>
            <td class="text-center font-medium">${m.quantidade ?? '—'}</td>
            <td>${formatTimestampComTempo(m.data)}</td>
            <td>${escapeHTML(m.notaFiscal || '—')}</td>
            <td>${escapeHTML(m.responsavel || '—')}</td>
            <td class="text-center text-xs text-gray-500">${formatTimestampComTempo(m.registradoEm)}</td>
            <td class="text-center">${_actionBtn(m.id, 'entrada-gas', details, isAdmin)}</td>
        </tr>`;
    }).join('');

    // Escopo no tbody: garante que o ícone trash-2 seja processado no HTML dinâmico
    _lucide(table);

    const filtro = DOM_ELEMENTS.filtroHistoricoEstoqueGas;
    if (filtro?.value) filterTable(filtro, table.id);
}

// =========================================================================
// HISTÓRICO — MOVIMENTAÇÕES GERAIS (Saídas)
// =========================================================================

export function renderGasMovimentacoesHistory() {
    const table = DOM_ELEMENTS.tableHistoricoGasAll;
    if (!table) return;

    const isAdmin  = getUserRole() === 'admin';
    const ordenado = getFilteredGasMovimentacoes()
        .sort((a, b) => (b.registradoEm?.toMillis() || 0) - (a.registradoEm?.toMillis() || 0));

    if (ordenado.length === 0) {
        table.innerHTML = _emptyRow(9, 'Nenhuma movimentação após 13/04/2026.');
        return;
    }

    table.innerHTML = ordenado.map(m => {
        const details = `Saída — ${escapeHTML(m.unidadeNome || 'N/A')} (${m.quantidade} botijão(ões))`;
        return `<tr>
            <td class="text-xs text-gray-400 font-mono">${escapeHTML(m.id)}</td>
            <td>${escapeHTML(m.unidadeNome || 'N/A')}</td>
            <td>${_badge('badge-red', 'Saída')}</td>
            <td class="text-center font-medium">${m.quantidade ?? '—'}</td>
            <td>${formatTimestampComTempo(m.data)}</td>
            <td>${escapeHTML(m.responsavelAlmoxarifado || 'N/A')}</td>
            <td>${escapeHTML(m.responsavel || 'N/A')}</td>
            <td class="text-center text-xs text-gray-500">${formatTimestampComTempo(m.registradoEm)}</td>
            <td class="text-center">${_actionBtn(m.id, 'gas', details, isAdmin)}</td>
        </tr>`;
    }).join('');

    _lucide(table);

    const filtro = document.getElementById('filtro-historico-gas');
    if (filtro?.value) filterTable(filtro, table.id);
}

// =========================================================================
// INTEGRIDADE DO HISTÓRICO
// =========================================================================

function checkGasHistoryIntegrity() {
    const movs    = _filterAfterCutoff(getGasMovimentacoes()).filter(m => m.tipo === 'entrega');
    const estoque = _filterAfterCutoff(getEstoqueGas());
    const incons  = movs.filter(m => !m.id || !m.unidadeId || !m.data || !m.quantidade).length;

    const msg  = incons === 0
        ? 'Integridade OK — nenhuma inconsistência detectada.'
        : `${incons} possível(is) inconsistência(s) detectada(s). Verifique os registros.`;
    const type = incons === 0 ? 'info' : 'warning';

    if (document.getElementById('alert-historico-gas'))
        showAlert('alert-historico-gas', msg, type);
    if (document.getElementById('alert-historico-estoque-gas'))
        showAlert('alert-historico-estoque-gas',
            `${estoque.length} registro(s) de estoque a partir de 13/04/2026.`, 'info');
}

// =========================================================================
// FILTROS INTERNOS
// =========================================================================

function populateGasFilterUnidades() {
    const sel = document.getElementById('filtro-unidade-gas');
    if (!sel) return;

    const tipoSel  = (document.getElementById('filtro-unidade-tipo-gas')?.value || '').toUpperCase();
    const anterior = sel.value;

    const unidades = getUnidades()
        .filter(u => {
            let uTipo = (u.tipo || 'N/A').toUpperCase();
            if (uTipo === 'SEMCAS') uTipo = 'SEDE';
            return !tipoSel || uTipo === tipoSel;
        })
        .sort((a, b) => a.nome.localeCompare(b.nome));

    sel.innerHTML = '<option value="">Todas</option>';
    unidades.forEach(u => {
        const opt     = document.createElement('option');
        opt.value     = u.id;
        opt.textContent = u.nome;
        sel.appendChild(opt);
    });
    sel.value = anterior || '';
}

function getFilteredGasMovimentacoes() {
    const unidadeId      = document.getElementById('filtro-unidade-gas')?.value     || '';
    const unidadeTipoSel = (document.getElementById('filtro-unidade-tipo-gas')?.value || '').toUpperCase();
    const respQuery      = (document.getElementById('filtro-responsavel-gas')?.value || '').trim().toLowerCase();
    const origem         = document.getElementById('filtro-origem-gas')?.value       || '';
    const dataIniStr     = document.getElementById('filtro-data-inicio-gas')?.value  || '';
    const dataFimStr     = document.getElementById('filtro-data-fim-gas')?.value     || '';

    const base       = _filterAfterCutoff(getGasMovimentacoes()).filter(m => m.tipo === 'entrega');
    const dataIniMs  = dataIniStr ? dateToTimestamp(dataIniStr)?.toMillis() : null;
    const dataFimMs  = dataFimStr ? dateToTimestamp(dataFimStr)?.toMillis() : null;
    const dataFimEOD = dataFimMs  ? dataFimMs + 86_399_999 : null;

    const unidadesMap = new Map(getUnidades().map(u => {
        let uTipo = (u.tipo || 'N/A').toUpperCase();
        if (uTipo === 'SEMCAS') uTipo = 'SEDE';
        return [u.id, { tipo: uTipo }];
    }));

    return base.filter(m => {
        if (unidadeId && m.unidadeId !== unidadeId) return false;
        if (unidadeTipoSel) {
            const info = unidadesMap.get(m.unidadeId);
            if (!info || info.tipo !== unidadeTipoSel) return false;
        }
        const isImport = (m.responsavel || '').toLowerCase().includes('importa')
                      || (m.observacao  || '').toLowerCase().includes('importado');
        if (origem === 'importacao' && !isImport)  return false;
        if (origem === 'manual'     &&  isImport)  return false;
        if (respQuery) {
            const ru = (m.responsavel             || '').toLowerCase();
            const ra = (m.responsavelAlmoxarifado || '').toLowerCase();
            if (!ru.includes(respQuery) && !ra.includes(respQuery)) return false;
        }
        const movMs = m.data?.toMillis?.() ?? null;
        if (dataIniMs  && movMs && movMs < dataIniMs)  return false;
        if (dataFimEOD && movMs && movMs > dataFimEOD) return false;
        return true;
    });
}

// =========================================================================
// LISTENERS
// =========================================================================

export function initGasListeners() {
    // Formulários principais
    DOM_ELEMENTS.formGas?.addEventListener('submit',        handleGasSubmit);
    DOM_ELEMENTS.formEntradaGas?.addEventListener('submit', handleEntradaEstoqueSubmit);
    DOM_ELEMENTS.formInicialGas?.addEventListener('submit', handleInicialEstoqueSubmit);

    // Unidade selecionada
    DOM_ELEMENTS.selectUnidadeGas?.addEventListener('change', checkUnidadeSaldoAlertGas);

    // Botão "Definir Estoque Inicial" (reabrir form após já ter definido)
    DOM_ELEMENTS.btnAbrirInicialGas?.addEventListener('click', () => {
        document.getElementById('form-inicial-gas-container')?.classList.remove('hidden');
        DOM_ELEMENTS.btnAbrirInicialGas?.classList.add('hidden');
    });

    // Busca rápida
    document.getElementById('filtro-status-gas')
        ?.addEventListener('input', e => filterTable(e.target, 'table-status-gas'));
    document.getElementById('filtro-historico-gas')
        ?.addEventListener('input', e => filterTable(e.target, 'table-historico-gas-all'));

    // Filtros avançados — histórico de movimentações
    ['filtro-tipo-gas','filtro-unidade-gas','filtro-responsavel-gas',
     'filtro-origem-gas','filtro-data-inicio-gas','filtro-data-fim-gas']
        .forEach(id => document.getElementById(id)
            ?.addEventListener('input', () => {
                renderGasMovimentacoesHistory();
                const f = document.getElementById('filtro-historico-gas');
                if (f?.value) filterTable(f, 'table-historico-gas-all');
            })
        );

    // Filtro por tipo de unidade → repopula select de unidades
    document.getElementById('filtro-unidade-tipo-gas')
        ?.addEventListener('change', () => {
            populateGasFilterUnidades();
            renderGasMovimentacoesHistory();
        });

    // Limpar todos os filtros
    document.getElementById('btn-limpar-filtros-gas')
        ?.addEventListener('click', () => {
            ['filtro-tipo-gas','filtro-unidade-tipo-gas','filtro-unidade-gas','filtro-responsavel-gas',
             'filtro-origem-gas','filtro-data-inicio-gas','filtro-data-fim-gas']
                .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
            populateGasFilterUnidades();
            renderGasMovimentacoesHistory();
        });

    // Filtro no histórico de estoque
    DOM_ELEMENTS.filtroHistoricoEstoqueGas
        ?.addEventListener('input', () =>
            filterTable(DOM_ELEMENTS.filtroHistoricoEstoqueGas, DOM_ELEMENTS.tableHistoricoEstoqueGas?.id)
        );

    // Sub-navegação principal (Movimentação / Histórico / Status)
    document.getElementById('sub-nav-gas')
        ?.addEventListener('click', e => {
            const btn = e.target.closest('.sub-nav-btn');
            if (btn?.dataset.subview) switchSubTabView('gas', btn.dataset.subview);
        });

    // Filtros de saldo no painel de status
    document.querySelectorAll('#filtro-saldo-gas-controls button').forEach(btn =>
        btn.addEventListener('click', () => {
            document.querySelectorAll('#filtro-saldo-gas-controls button')
                .forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            renderGasStatus();
        })
    );

    // Abas do formulário (Saída / Entrada no Estoque)
    document.querySelectorAll('#content-gas .form-tab-btn').forEach(btn =>
        btn.addEventListener('click', () => {
            const formName = btn.dataset.form;
            document.querySelectorAll('#content-gas .form-tab-btn')
                .forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            DOM_ELEMENTS.formGas?.classList.toggle('hidden',        formName !== 'saida-gas');
            DOM_ELEMENTS.formEntradaGas?.classList.toggle('hidden', formName !== 'entrada-gas');
            renderPermissionsUI();
        })
    );

    // Inner nav do lançamento
    document.querySelector('#subview-movimentacao-gas .module-inner-subnav')
        ?.addEventListener('click', e => {
            const btn = e.target.closest('button.sub-nav-btn[data-inner]');
            if (!btn) return;
            document.querySelectorAll('#subview-movimentacao-gas .module-inner-subnav .sub-nav-btn')
                .forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            DOM_ELEMENTS.innerGasLancamento?.classList.remove('hidden');
            DOM_ELEMENTS.innerGasResumo?.classList.add('hidden');
        });

    // Botão ver status
    DOM_ELEMENTS.btnVerStatusGas
        ?.addEventListener('click', () => switchSubTabView('gas', 'status-gas'));

    // Gerar relatório
    document.getElementById('btn-gerar-relatorio-gas')
        ?.addEventListener('click', () => {
            const start = document.getElementById('relatorio-gas-data-inicio')?.value || '';
            const end   = document.getElementById('relatorio-gas-data-fim')?.value   || '';
            generateGasReport(start, end);
        });

    populateGasFilterUnidades();
}

// =========================================================================
// INICIALIZAÇÃO DA ABA
// =========================================================================

export function onGasTabChange() {
    const currentSubView = document.querySelector('#sub-nav-gas .sub-nav-btn.active')
        ?.dataset.subview || 'movimentacao-gas';

    switchSubTabView('gas', currentSubView);
    toggleGasFormInputs();
    checkUnidadeSaldoAlertGas();
    renderEstoqueGas();
    renderGasEstoqueHistory();
    renderGasStatus();
    renderGasMovimentacoesHistory();

    if (DOM_ELEMENTS.inputDataGas)        DOM_ELEMENTS.inputDataGas.value        = getTodayDateString();
    if (DOM_ELEMENTS.inputDataEntradaGas) DOM_ELEMENTS.inputDataEntradaGas.value = getTodayDateString();

    // Por padrão: exibir diretamente o formulário de lançamento
    DOM_ELEMENTS.innerGasResumo?.classList.add('hidden');
    DOM_ELEMENTS.innerGasLancamento?.classList.remove('hidden');
    DOM_ELEMENTS.btnInnerGasLancamento?.classList.add('active');
    DOM_ELEMENTS.btnInnerGasResumo?.classList.remove('active');

    populateGasFilterUnidades();
    checkGasHistoryIntegrity(); // chamada única aqui — não repetida dentro de renderGasMovimentacoesHistory
    renderPermissionsUI();
}
