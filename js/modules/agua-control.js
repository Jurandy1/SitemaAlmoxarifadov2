// js/modules/agua-control.js
import { Timestamp, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { getUnidades, getAguaMovimentacoes, isEstoqueInicialDefinido, getCurrentStatusFilter, setCurrentStatusFilter, getEstoqueAgua } from "../utils/cache.js";
import { DOM_ELEMENTS, showAlert, switchSubTabView, handleSaldoFilterUI, filterTable } from "../utils/dom-helpers.js";
import { getTodayDateString, dateToTimestamp, capitalizeString, formatTimestampComTempo } from "../utils/formatters.js";
import { isReady } from "./auth.js";
import { COLLECTIONS } from "../services/firestore-service.js";
import { executeFinalMovimentacao } from "./movimentacao-modal-handler.js";

// =========================================================================
// LÓGICA DE ESTOQUE (Movido de app.js)
// =========================================================================

function renderEstoqueAgua() {
    const estoque = getEstoqueAgua();
    if (!estoque) return;

    const { inicial, entradas, saidas, atual } = estoque;

    if (DOM_ELEMENTS.estoqueAguaInicialEl) DOM_ELEMENTS.estoqueAguaInicialEl.textContent = inicial;
    if (DOM_ELEMENTS.estoqueAguaEntradasEl) DOM_ELEMENTS.estoqueAguaEntradasEl.textContent = entradas;
    if (DOM_ELEMENTS.estoqueAguaSaidasEl) DOM_ELEMENTS.estoqueAguaSaidasEl.textContent = saidas;
    if (DOM_ELEMENTS.estoqueAguaAtualEl) DOM_ELEMENTS.estoqueAguaAtualEl.textContent = atual;
}

async function handleInicialEstoqueAguaSubmit(e) {
    e.preventDefault();
    try {
        showAlert("alert-inicial-agua", "Registrando estoque inicial...", "info");
        const qtd = parseInt(DOM_ELEMENTS.inputInicialQtdAgua.value.trim());
        const responsavel = DOM_ELEMENTS.inputInicialResponsavelAgua.value.trim();
        if (!qtd || !responsavel) {
            showAlert("alert-inicial-agua", "Preencha todos os campos.", "warning");
            return;
        }

        await addDoc(COLLECTIONS.estoqueInicialAgua, {
            quantidade: qtd,
            responsavel,
            data: serverTimestamp(),
        });

        showAlert("alert-inicial-agua", "Estoque inicial cadastrado com sucesso!", "success");
        DOM_ELEMENTS.formInicialAgua.reset();
        renderEstoqueAgua();
    } catch (err) {
        console.error(err);
        showAlert("alert-inicial-agua", "Erro ao registrar estoque inicial.", "error");
    }
}

async function handleAguaSubmit(e) {
    e.preventDefault();
    try {
        const unidade = DOM_ELEMENTS.selectUnidadeAgua.value;
        const tipo = DOM_ELEMENTS.selectTipoAgua.value;
        const qtd = parseInt(document.getElementById('input-qtd-entregue-agua').value);
        const responsavel = DOM_ELEMENTS.inputResponsavelAgua.value.trim();
        if (!unidade || !tipo || !qtd || !responsavel) {
            showAlert("alert-agua", "Preencha todos os campos.", "warning");
            return;
        }

        await addDoc(COLLECTIONS.movimentacoesAgua, {
            unidade,
            tipo,
            quantidade: qtd,
            responsavel,
            data: serverTimestamp(),
        });

        showAlert("alert-agua", "Saída registrada com sucesso!", "success");
        DOM_ELEMENTS.formAgua.reset();
        renderEstoqueAgua();
        renderAguaStatus();
    } catch (err) {
        console.error(err);
        showAlert("alert-agua", "Erro ao registrar saída de água.", "error");
    }
}

async function handleEntradaEstoqueAguaSubmit(e) {
    e.preventDefault();
    try {
        const qtd = parseInt(DOM_ELEMENTS.inputQtdEntradaAgua.value.trim());
        const nf = DOM_ELEMENTS.inputNfEntradaAgua.value.trim();
        const responsavel = DOM_ELEMENTS.inputResponsavelEntradaAgua.value.trim();
        if (!qtd || !nf || !responsavel) {
            showAlert("alert-agua", "Preencha todos os campos.", "warning");
            return;
        }

        await addDoc(COLLECTIONS.entradaAgua, {
            quantidade: qtd,
            nf,
            responsavel,
            data: serverTimestamp(),
        });

        showAlert("alert-agua", "Entrada registrada com sucesso!", "success");
        DOM_ELEMENTS.formEntradaAgua.reset();
        renderEstoqueAgua();
    } catch (err) {
        console.error(err);
        showAlert("alert-agua", "Erro ao registrar entrada de água.", "error");
    }
}

function checkUnidadeSaldoAlertAgua() {
    const selectUnidade = DOM_ELEMENTS.selectUnidadeAgua;
    const alertEl = DOM_ELEMENTS.unidadeSaldoAlertaAgua;
    if (!selectUnidade || !alertEl) return;

    const unidade = selectUnidade.value;
    if (!unidade) {
        alertEl.style.display = 'none';
        return;
    }

    const saldo = getCurrentStatusFilter('agua');
    alertEl.textContent = saldo === 'devendo'
        ? "⚠️ Unidade com saldo negativo."
        : saldo === 'credito'
        ? "✅ Unidade com crédito disponível."
        : "";
    alertEl.style.display = saldo ? 'block' : 'none';
}

function renderAguaStatus() {
    console.log("Renderizando status de Água...");
}

function renderAguaMovimentacoesHistory() {
    console.log("Renderizando histórico de Água...");
}

// =========================================================================
// INICIALIZAÇÃO DE LISTENERS DO DOM
// =========================================================================

function initAguaListeners() {
    if (DOM_ELEMENTS.formAgua) {
        DOM_ELEMENTS.formAgua.addEventListener('submit', handleAguaSubmit);
    }
    if (DOM_ELEMENTS.selectTipoAgua) {
        DOM_ELEMENTS.selectTipoAgua.addEventListener('change', checkUnidadeSaldoAlertAgua);
    }
    if (DOM_ELEMENTS.selectUnidadeAgua) {
        DOM_ELEMENTS.selectUnidadeAgua.addEventListener('change', checkUnidadeSaldoAlertAgua);
    }
    if (DOM_ELEMENTS.formInicialAgua) {
        DOM_ELEMENTS.formInicialAgua.addEventListener('submit', handleInicialEstoqueAguaSubmit);
    }
    if (DOM_ELEMENTS.btnAbrirInicialAgua) {
        DOM_ELEMENTS.btnAbrirInicialAgua.addEventListener('click', () => { 
            DOM_ELEMENTS.formInicialAguaContainer?.classList.remove('hidden'); 
            DOM_ELEMENTS.btnAbrirInicialAgua?.classList.add('hidden'); 
        });
    }
    if (DOM_ELEMENTS.formEntradaAgua) {
        DOM_ELEMENTS.formEntradaAgua.addEventListener('submit', handleEntradaEstoqueAguaSubmit);
    }
    if (document.getElementById('filtro-status-agua')) {
        document.getElementById('filtro-status-agua').addEventListener('input', () => filterTable(document.getElementById('filtro-status-agua'), 'table-status-agua'));
    }
    if (document.getElementById('filtro-historico-agua')) {
        document.getElementById('filtro-historico-agua').addEventListener('input', () => filterTable(document.getElementById('filtro-historico-agua'), 'table-historico-agua-all'));
    }

    document.querySelectorAll('#filtro-saldo-agua-controls button').forEach(btn => btn.addEventListener('click', (e) => {
        handleSaldoFilterUI('agua', e, renderAguaStatus);
    }));

    document.querySelectorAll('#content-agua .form-tab-btn').forEach(btn => btn.addEventListener('click', () => {
        const formName = btn.dataset.form;
        document.querySelectorAll('#content-agua .form-tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        if (DOM_ELEMENTS.formAgua) DOM_ELEMENTS.formAgua.classList.toggle('hidden', formName !== 'saida-agua');
        if (DOM_ELEMENTS.formEntradaAgua) DOM_ELEMENTS.formEntradaAgua.classList.toggle('hidden', formName !== 'entrada-agua');
    }));
}

// =========================================================================
// FUNÇÃO DE ORQUESTRAÇÃO
// =========================================================================

function onAguaTabChange() {
    switchSubTabView('agua', 'movimentacao-agua');
    checkUnidadeSaldoAlertAgua();
    renderEstoqueAgua();
    renderAguaStatus();
    renderAguaMovimentacoesHistory();

    if (DOM_ELEMENTS.inputDataAgua) DOM_ELEMENTS.inputDataAgua.value = getTodayDateString();
    if (DOM_ELEMENTS.inputDataEntradaAgua) DOM_ELEMENTS.inputDataEntradaAgua.value = getTodayDateString();

    const filtroStatus = document.getElementById('filtro-status-agua');
    if (filtroStatus) filtroStatus.value = '';
    const filtroHistorico = document.getElementById('filtro-historico-agua');
    if (filtroHistorico) filtroHistorico.value = '';
}

// =========================================================================
// EXPORTS
// =========================================================================

export {
    renderEstoqueAgua,
    renderAguaStatus,
    renderAguaMovimentacoesHistory,
    handleAguaSubmit,
    handleEntradaEstoqueAguaSubmit,
    handleInicialEstoqueAguaSubmit,
    checkUnidadeSaldoAlertAgua,
    initAguaListeners, // ✅ agora apenas aqui
    onAguaTabChange
};
