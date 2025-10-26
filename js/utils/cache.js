import { 
    DOM_ELEMENTS, 
    switchTab, 
    findDOMElements, 
    switchSubTabView, 
    filterTable, 
    updateLastUpdateTime, 
    handleSaldoFilterUI, 
    openConfirmDeleteModal 
} from "../utils/dom-helpers.js";
// NOTA DE CORREÇÃO: Removido 'showAlert' da importação acima, pois não é definido em dom-helpers.js
// ou o app.js deveria importá-lo diretamente. Mantenha a exportação no final para
// não quebrar a importação em app.js, se showAlert for definida neste arquivo.

import { onAguaTabChange, initAguaListeners } from "../modules/agua-control.js";
import { onGasTabChange, initGasListeners } from "../modules/gas-control.js";
import { onMateriaisTabChange, initMateriaisListeners } from "../modules/materiais.js";
import { onGestaoTabChange, initGestaoListeners } from "../modules/gestao.js";
import { onRelatorioTabChange, initRelatoriosListeners } from "../modules/relatorios.js";
import { 
    initDashboardListeners, 
    renderDashboard, 
    startDashboardRefresh, 
    stopDashboardRefresh 
} from "../modules/dashboard.js";
import { getTodayDateString } from "../utils/formatters.js";

// ======================================================================
// Variáveis de Cache e Estado Global
// ======================================================================

let __unidades = [];
let __aguaMovimentacoes = [];
let __gasMovimentacoes = [];
let __materiais = [];
let __estoqueAgua = [];
let __estoqueGas = [];
let __estoqueInicialDefinido = { agua: false, gas: false };
let __currentStatusFilter = { agua: 'all', gas: 'all' };
let __dashboardMaterialFilter = null; // 'separacao', 'retirada' ou null (todos pendentes)
let __deleteInfo = { id: null, type: null, collectionRef: null, alertElementId: null, details: null, isInicial: false };
let __userRole = 'unauthenticated'; // 'anon', 'editor', 'admin', 'unauthenticated'

// Variáveis de estado para Previsão
let modoPrevisao = { agua: null, gas: null };
let listaExclusoes = { agua: [], gas: [] };
let graficoPrevisao = { agua: null, gas: null };

// Função para obter o filtro inicial
function initialMaterialFilter() {
    return __dashboardMaterialFilter;
}


// ======================================================================
// GETTERS
// ======================================================================

function getUnidades() { return __unidades; }
function getAguaMovimentacoes() { return __aguaMovimentacoes; }
function getGasMovimentacoes() { return __gasMovimentacoes; }
function getMateriais() { return __materiais; }
function getEstoqueAgua() { return __estoqueAgua; }
function getEstoqueGas() { return __estoqueGas; }
function isEstoqueInicialDefinido(tipo) { return __estoqueInicialDefinido[tipo]; }
function getCurrentStatusFilter(tipo) { return __currentStatusFilter[tipo]; }
function getCurrentDashboardMaterialFilter() { return __dashboardMaterialFilter; }
function getDeleteInfo() { return __deleteInfo; }
function getUserRole() { return __userRole; }
function getModoPrevisao(tipo) { return modoPrevisao[tipo]; }
function getListaExclusoes(tipo) { return listaExclusoes[tipo]; }
function getGraficoPrevisao(tipo) { return graficoPrevisao[tipo]; }

// ======================================================================
// SETTERS
// ======================================================================

function setUnidades(data) { __unidades = data; }
function setAguaMovimentacoes(data) { __aguaMovimentacoes = data; }
function setGasMovimentacoes(data) { __gasMovimentacoes = data; }
function setMateriais(data) { __materiais = data; }
function setEstoqueAgua(data) { __estoqueAgua = data; }
function setEstoqueGas(data) { __estoqueGas = data; }
function setEstoqueInicialDefinido(tipo, isDefined) { __estoqueInicialDefinido[tipo] = isDefined; }
function setCurrentStatusFilter(tipo, filter) { __currentStatusFilter[tipo] = filter; }
function setCurrentDashboardMaterialFilter(filter) { __dashboardMaterialFilter = filter; }
function setDeleteInfo(data) { __deleteInfo = data; }
function setUserRole(role) { __userRole = role; }
function setModoPrevisao(tipo, modo) { modoPrevisao[tipo] = modo; }
function setListaExclusoes(tipo, lista) { listaExclusoes[tipo] = lista; }
function setGraficoPrevisao(tipo, chartInstance) { graficoPrevisao[tipo] = chartInstance; }


// ======================================================================
// FUNÇÕES DE CONTROLE GERAL
// ======================================================================

function renderUIModules() {
    renderUnidadeControls();
    
    if (DOM_ELEMENTS.contentPanes) {
        DOM_ELEMENTS.contentPanes.forEach(pane => {
            if (!pane.classList.contains("hidden")) {
                const tabName = pane.id.replace("content-", "");
                console.log(`renderUIModules calling for tab: ${tabName}`); // Log added
                switch (tabName) {
                    case "dashboard":
                        renderDashboard(); 
                        break;
                    case "agua":
                        onAguaTabChange();
                        break;
                    case "gas":
                        onGasTabChange();
                        break;
                    case "materiais":
                        onMateriaisTabChange();
                        break;
                    case "gestao":
                        onGestaoTabChange();
                        break;
                    case "relatorio":
                        onRelatorioTabChange();
                        break;
                }
            }
        });
    }
}

function renderUnidadeControls() {
    const unidades = getUnidades();
    const selectsToPopulate = [
        { el: DOM_ELEMENTS.selectUnidadeAgua, service: "atendeAgua", includeAll: false, includeSelecione: true },
        { el: DOM_ELEMENTS.selectUnidadeGas, service: "atendeGas", includeAll: false, includeSelecione: true },
        { el: DOM_ELEMENTS.selectUnidadeMateriais, service: "atendeMateriais", includeAll: false, includeSelecione: true },
        { el: document.getElementById("select-previsao-unidade-agua-v2"), service: "atendeAgua", useIdAsValue: true },
        { el: document.getElementById("select-previsao-unidade-gas-v2"), service: "atendeGas", useIdAsValue: true },
        { el: document.getElementById("select-exclusao-agua"), service: "atendeAgua", useIdAsValue: true },
        { el: document.getElementById("select-exclusao-gas"), service: "atendeGas", useIdAsValue: true },
    ];
    
    selectsToPopulate.forEach(({ el, service, includeAll, includeSelecione, filterType, useIdAsValue }) => {
        if (!el) return;

        let unidadesFiltradas = unidades.filter(u => {
            const atendeServico = service ? (u[service] ?? true) : true;
            let tipoUnidadeNormalizado = (u.tipo || "").toUpperCase();
            if (tipoUnidadeNormalizado === "SEMCAS") tipoUnidadeNormalizado = "SEDE";
            const tipoCorreto = !filterType || tipoUnidadeNormalizado === (filterType || "").toUpperCase();
            return atendeServico && tipoCorreto;
        });

        const grupos = unidadesFiltradas.reduce((acc, unidade) => { 
            let tipo = (unidade.tipo || "Sem Tipo").toUpperCase(); 
            if (tipo === "SEMCAS") tipo = "SEDE";
            if (!acc[tipo]) acc[tipo] = []; 
            acc[tipo].push(unidade); 
            return acc; 
        }, {});

        const tiposOrdenados = Object.keys(grupos).sort();
        
        let html = "";
        if (includeSelecione) html += "<option value=''>-- Selecione --</option>";
        if (includeAll) html += "<option value='todas'>Todas as Unidades</option>";

        tiposOrdenados.forEach(tipo => {
            html += `<optgroup label="${tipo}">`;
            grupos[tipo]
                .sort((a, b) => a.nome.localeCompare(b.nome))
                .forEach(unidade => {
                    const optionValue = useIdAsValue ? unidade.id : `${unidade.id}|${unidade.nome}|${unidade.tipo}`;
                    html += `<option value="${optionValue}">${unidade.nome}</option>`; 
                });
            html += `</optgroup>`;
        });
        el.innerHTML = html;
    });

    const selectTipoAgua = document.getElementById("select-previsao-tipo-agua");
    const selectTipoGas = document.getElementById("select-previsao-tipo-gas");
    
    if (selectTipoAgua || selectTipoGas) {
        const uniqueTypes = [...new Set(unidades.map(u => {
            let tipo = (u.tipo || "Sem Tipo").toUpperCase();
            return tipo === "SEMCAS" ? "SEDE" : tipo;
        }))].sort();

        let html = "<option value=''>-- Selecione o Tipo --</option>";
        uniqueTypes.forEach(tipo => {
            html += `<option value="${tipo}">${tipo}</option>`;
        });

        if (selectTipoAgua) selectTipoAgua.innerHTML = html;
        if (selectTipoGas) selectTipoGas.innerHTML = html;
    }
}

function initAllListeners() {
    DOM_ELEMENTS.navButtons.forEach(button => button.addEventListener("click", () => {
        stopDashboardRefresh(); 
        switchTab(button.dataset.tab); // This logs "Switching to tab: ..."

        switch (button.dataset.tab) {
            case "dashboard":
                console.log("Calling initDashboardListeners, startDashboardRefresh, renderDashboard..."); // Add log
                initDashboardListeners();
                startDashboardRefresh();
                renderDashboard();
                break;
            case "agua":
                console.log("Calling onAguaTabChange..."); // Add log
                onAguaTabChange();
                break;
            case "gas":
                console.log("Calling onGasTabChange..."); // Add log
                onGasTabChange();
                break;
            case "materiais":
                console.log("Calling onMateriaisTabChange..."); // Add log
                onMateriaisTabChange();
                break;
            case "gestao":
                console.log("Calling onGestaoTabChange..."); // Add log
                onGestaoTabChange();
                break;
            case "relatorio":
                console.log("Calling onRelatorioTabChange..."); // Add log
                onRelatorioTabChange();
                break;
        }
    }));

    document.querySelector("main").addEventListener("click", (e) => {
        const removeBtn = e.target.closest("button.btn-remove[data-id]");
        // Debugging: Log the button dataset if found
        // if (removeBtn) {
        //     console.log("Remove button clicked, dataset:", removeBtn.dataset);
        // }
        if (removeBtn) {
             // Determine alert ID based on type
             let alertId = 'alert-gestao'; // Default
             if (removeBtn.dataset.type === 'agua') alertId = 'alert-agua';
             else if (removeBtn.dataset.type === 'gas') alertId = 'alert-gas';
             else if (removeBtn.dataset.type === 'materiais') alertId = 'alert-materiais'; // Added case
             // Add cases for 'unidade' if needed, though default might be okay

             console.log(`openConfirmDeleteModal called with type: ${removeBtn.dataset.type}, alertId: ${alertId}`); // Log added

             openConfirmDeleteModal(
                removeBtn.dataset.id,
                removeBtn.dataset.type,
                removeBtn.dataset.details,
                alertId // Use the determined alert ID
                // Pass collectionRef and isInicial if applicable (modified openConfirmDeleteModal in dom-helpers needed)
             );
        }
    });

    if (DOM_ELEMENTS.btnCancelDelete) 
        DOM_ELEMENTS.btnCancelDelete.addEventListener("click", () => DOM_ELEMENTS.confirmDeleteModal.style.display = "none");
    
    // Initial listeners setup for all modules regardless of the starting tab
    console.log("Initializing listeners for all modules..."); // Add log
    initDashboardListeners();
    initAguaListeners();
    initGasListeners();
    initMateriaisListeners();
    initGestaoListeners();
    initRelatoriosListeners();
}

// ================================================================
// EXPORTAÇÕES CORRETAS
// ================================================================
export { 
    getUnidades, 
    setUnidades, 
    getAguaMovimentacoes, 
    setAguaMovimentacoes, 
    getGasMovimentacoes, 
    setGasMovimentacoes, 
    getMateriais, 
    setMateriais, 
    getEstoqueAgua, 
    setEstoqueAgua, 
    getEstoqueGas, 
    setEstoqueGas,
    isEstoqueInicialDefinido,
    setEstoqueInicialDefinido,
    getCurrentStatusFilter,
    setCurrentStatusFilter,
    getCurrentDashboardMaterialFilter,
    setCurrentDashboardMaterialFilter,
    initialMaterialFilter,
    setDeleteInfo,
    getDeleteInfo,
    getUserRole,
    setUserRole,
    // Exports para Previsão
    getModoPrevisao,
    setModoPrevisao,
    getListaExclusoes,
    setListaExclusoes,
    getGraficoPrevisao,
    setGraficoPrevisao,
    // Exports de Controle Geral para app.js
    renderUIModules, 
    renderUnidadeControls, 
    initAllListeners, 
    DOM_ELEMENTS, 
    findDOMElements, 
    updateLastUpdateTime 
};
