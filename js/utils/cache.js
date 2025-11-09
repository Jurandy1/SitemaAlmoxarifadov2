// js/utils/cache.js
// ======================================================================
// IMPORTAÇÕES
// ======================================================================
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
// VARIÁVEIS DE CACHE E ESTADO GLOBAL
// ======================================================================

// Dados e cache principais
let __unidades = [];
let __aguaMovimentacoes = [];
let __gasMovimentacoes = [];
let __materiais = [];
let __estoqueAgua = [];
let __estoqueGas = [];
// NOVAS VARIÁVEIS PARA ASSISTÊNCIA SOCIAL
let __cestaMovimentacoes = [];
let __cestaEstoque = [];
let __enxovalMovimentacoes = [];
let __enxovalEstoque = [];
// FIM NOVAS VARIÁVEIS

let __estoqueInicialDefinido = { agua: false, gas: false };
let __currentStatusFilter = { agua: 'all', gas: 'all' };
let __dashboardMaterialFilter = null; // 'separacao', 'retirada' ou null
let __deleteInfo = { 
    id: null, 
    type: null, 
    collectionRef: null, 
    alertElementId: null, 
    details: null, 
    isInicial: false 
};
let __userRole = 'unauthenticated'; // 'anon', 'editor', 'admin', 'unauthenticated'

// ======================================================================
// VARIÁVEIS DE PREVISÃO
// ======================================================================

// Essas variáveis são usadas nos gráficos e cálculos de previsão
let modoPrevisao = { agua: null, gas: null };
let listaExclusoes = { agua: [], gas: [] };
let graficoPrevisao = { agua: null, gas: null };


// ======================================================================
// GETTERS
// ======================================================================

function getUnidades() { return __unidades; }
function getAguaMovimentacoes() { return __aguaMovimentacoes; }
function getGasMovimentacoes() { return __gasMovimentacoes; }
function getMateriais() { return __materiais; }
function getEstoqueAgua() { return __estoqueAgua; }
function getEstoqueGas() { return __estoqueGas; }
// NOVOS GETTERS
function getCestaMovimentacoes() { return __cestaMovimentacoes; }
function getCestaEstoque() { return __cestaEstoque; }
function getEnxovalMovimentacoes() { return __enxovalMovimentacoes; }
function getEnxovalEstoque() { return __enxovalEstoque; }
// FIM NOVOS GETTERS

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
// NOVOS SETTERS
function setCestaMovimentacoes(data) { __cestaMovimentacoes = data; }
function setCestaEstoque(data) { __cestaEstoque = data; }
function setEnxovalMovimentacoes(data) { __enxovalMovimentacoes = data; }
function setEnxovalEstoque(data) { __enxovalEstoque = data; }
// FIM NOVOS SETTERS

function setEstoqueInicialDefinido(tipo, isDefined) { __estoqueInicialDefinido[tipo] = isDefined; }
function setCurrentStatusFilter(tipo, filter) { __currentStatusFilter[tipo] = filter; }
function setCurrentDashboardMaterialFilter(filter) { __dashboardMaterialFilter = filter; }
function setDeleteInfo(data) { __deleteInfo = data; }
function setUserRole(role) { __userRole = role; }
function setModoPrevisao(tipo, modo) { modoPrevisao[tipo] = modo; }
function setListaExclusoes(tipo, lista) { listaExclusoes[tipo] = lista; }
function setGraficoPrevisao(tipo, chartInstance) { graficoPrevisao[tipo] = chartInstance; }


// ======================================================================
// FUNÇÕES AUXILIARES
// ======================================================================

// Retorna o filtro inicial dos materiais do dashboard
function initialMaterialFilter() {
    return __dashboardMaterialFilter;
}


// ======================================================================
// EXPORTAÇÕES
// ======================================================================

export { 
    // Getters e Setters principais
    getUnidades, setUnidades,
    getAguaMovimentacoes, setAguaMovimentacoes,
    getGasMovimentacoes, setGasMovimentacoes,
    getMateriais, setMateriais,
    getEstoqueAgua, setEstoqueAgua,
    getEstoqueGas, setEstoqueGas,
    // Novos Getters/Setters Social
    getCestaMovimentacoes, setCestaMovimentacoes,
    getCestaEstoque, setCestaEstoque,
    getEnxovalMovimentacoes, setEnxovalMovimentacoes,
    getEnxovalEstoque, setEnxovalEstoque,
    // Fim Novos Getters/Setters Social

    isEstoqueInicialDefinido, setEstoqueInicialDefinido,
    getCurrentStatusFilter, setCurrentStatusFilter,
    getCurrentDashboardMaterialFilter, setCurrentDashboardMaterialFilter,
    initialMaterialFilter,
    getDeleteInfo, setDeleteInfo,
    getUserRole, setUserRole,

    // Previsão (CORRIGIDO: Exportando as variáveis em si para o previsao.js)
    modoPrevisao, getModoPrevisao, setModoPrevisao, // Exportando a variável e os acessores
    listaExclusoes, getListaExclusoes, setListaExclusoes, // Exportando a variável e os acessores
    graficoPrevisao, getGraficoPrevisao, setGraficoPrevisao, // Exportando a variável e os acessores

    // Utilitários DOM necessários para o app.js
    DOM_ELEMENTS, 
    findDOMElements, 
    updateLastUpdateTime
};
