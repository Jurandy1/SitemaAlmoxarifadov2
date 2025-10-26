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
    
    // Exports de Controle Geral (que estavam duplicados)
    // Essas funções NÃO ESTÃO DEFINIDAS AQUI, mas o código duplicado as exportava.
    // O app.js deve importar estas funções de 'control-helpers.js'.
    // Mantendo a exportação dos getters/setters do cache.
    DOM_ELEMENTS, 
    findDOMElements, 
    updateLastUpdateTime 
};
