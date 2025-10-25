// js/modules/gas-control.js
import { Timestamp, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { getUnidades, getGasMovimentacoes, isEstoqueInicialDefinido, getCurrentStatusFilter, setCurrentStatusFilter, getEstoqueGas } from "../utils/cache.js";
// CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
import { DOM_ELEMENTS, showAlert, switchSubTabView, handleSaldoFilterUI, filterTable } from "../utils/dom-helpers.js";
import { getTodayDateString, dateToTimestamp, capitalizeString, formatTimestampComTempo } from "../utils/formatters.js";
import { isReady } from "./auth.js";
import { COLLECTIONS } from "../services/firestore-service.js";
import { executeFinalMovimentacao } from "./movimentacao-modal-handler.js";

// =========================================================================
// LÓGICA DE ESTOQUE (Movido de app.js)
// =========================================================================

/**
 * Renderiza o resumo do estoque de gás.
// ... (código existente)
    if (DOM_ELEMENTS.estoqueGasAtualEl) DOM_ELEMENTS.estoqueGasAtualEl.textContent = estoqueAtual;
}

/**
 * Lança o estoque inicial.
// ... (código existente)
    }
}

// ... (código existente)

// =========================================================================
// INICIALIZAÇÃO DE LISTENERS DO DOM
// =========================================================================

export function initGasListeners() {
    // CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
    if (DOM_ELEMENTS.formGas) {
        DOM_ELEMENTS.formGas.addEventListener('submit', handleGasSubmit);
    }
    if (DOM_ELEMENTS.selectTipoGas) {
        // CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
        DOM_ELEMENTS.selectTipoGas.addEventListener('change', toggleGasFormInputs);
    }
    if (DOM_ELEMENTS.selectUnidadeGas) {
         // CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
         DOM_ELEMENTS.selectUnidadeGas.addEventListener('change', checkUnidadeSaldoAlertGas);
    }
    if (DOM_ELEMENTS.formInicialGas) {
        // CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
        DOM_ELEMENTS.formInicialGas.addEventListener('submit', handleInicialEstoqueSubmit);
    }
    if (DOM_ELEMENTS.btnAbrirInicialGas) {
        // CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS (incluindo o uso dentro da função)
        DOM_ELEMENTS.btnAbrirInicialGas.addEventListener('click', () => { 
            DOM_ELEMENTS.formInicialGasContainer?.classList.remove('hidden'); 
            DOM_ELEMENTS.btnAbrirInicialGas?.classList.add('hidden'); 
        });
    }
    if (DOM_ELEMENTS.formEntradaGas) {
        // CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
        DOM_ELEMENTS.formEntradaGas.addEventListener('submit', handleEntradaEstoqueSubmit);
    }
    if (document.getElementById('filtro-status-gas')) {
        document.getElementById('filtro-status-gas').addEventListener('input', () => filterTable(document.getElementById('filtro-status-gas'), 'table-status-gas'));
    }
    if (document.getElementById('filtro-historico-gas')) {
        document.getElementById('filtro-historico-gas').addEventListener('input', () => filterTable(document.getElementById('filtro-historico-gas'), 'table-historico-gas-all'));
    }
    // REMOVIDO: Listener de sub-navegação movido para control-helpers.js
    // if (document.getElementById('sub-nav-gas')) {
    //     document.getElementById('sub-nav-gas').addEventListener('click', (e) => {
    //         const btn = e.target.closest('.sub-nav-btn');
    //         if (btn && btn.dataset.subview) switchSubTabView('gas', btn.dataset.subview);
    //     });
    // }

    // Listener para o filtro de saldo na tabela de status
    document.querySelectorAll('#filtro-saldo-gas-controls button').forEach(btn => btn.addEventListener('click', (e) => {
        handleSaldoFilterUI('gas', e, renderGasStatus);
    }));

    // Listener para as abas de formulário
    document.querySelectorAll('#content-gas .form-tab-btn').forEach(btn => btn.addEventListener('click', () => {
        const formName = btn.dataset.form;
        document.querySelectorAll('#content-gas .form-tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        // CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
        if (DOM_ELEMENTS.formGas) DOM_ELEMENTS.formGas.classList.toggle('hidden', formName !== 'saida-gas');
        if (DOM_ELEMENTS.formEntradaGas) DOM_ELEMENTS.formEntradaGas.classList.toggle('hidden', formName !== 'entrada-gas');
    }));
}

/**
 * Função de orquestração para a tab de Gás.
 */
export function onGasTabChange() {
    switchSubTabView('gas', 'movimentacao-gas');
    toggleGasFormInputs(); 
    checkUnidadeSaldoAlertGas();
    renderEstoqueGas();
    renderGasStatus();
    renderGasMovimentacoesHistory();
    // Garante que o input de data está em dia
    // CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
    if (DOM_ELEMENTS.inputDataGas) DOM_ELEMENTS.inputDataGas.value = getTodayDateString();
    if (DOM_ELEMENTS.inputDataEntradaGas) DOM_ELEMENTS.inputDataEntradaGas.value = getTodayDateString();
    // CORRIGIDO: Usar verificação `if` em vez de encadeamento opcional na atribuição (Causa do erro 463:5)
    const filtroStatus = document.getElementById('filtro-status-gas');
    if (filtroStatus) filtroStatus.value = '';
    const filtroHistorico = document.getElementById('filtro-historico-gas');
    if (filtroHistorico) filtroHistorico.value = '';
}
