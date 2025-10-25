// js/utils/cache.js
// Este módulo armazena e gerencia o estado global de dados e filtros.

let fb_unidades = [];
let fb_agua_movimentacoes = [];
let fb_gas_movimentacoes = [];
let fb_materiais = [];
let fb_estoque_agua = [];
let fb_estoque_gas = [];

let estoqueInicialDefinido = { agua: false, gas: false };
let currentDashboardMaterialFilter = null; 
let currentStatusFilter = { agua: 'all', gas: 'all' };
let deleteInfo = { id: null, type: null, collectionRef: null, details: null, isInicial: false }; 
let initialMaterialFilter = null; 
let listaExclusoes = { agua: [], gas: [] };
let modoPrevisao = { agua: null, gas: null };
let graficoPrevisao = { agua: null, gas: null };
let tipoSelecionadoPrevisao = { agua: null, gas: null };


// Setters
function setUnidades(data) { fb_unidades = data; }
function setAguaMovimentacoes(data) { fb_agua_movimentacoes = data; }
function setGasMovimentacoes(data) { fb_gas_movimentacoes = data; }
function setMateriais(data) { fb_materiais = data; }
function setEstoqueAgua(data) { fb_estoque_agua = data; }
function setEstoqueGas(data) { fb_estoque_gas = data; }
function setEstoqueInicialDefinido(type, status) { estoqueInicialDefinido[type] = status; }
function setCurrentDashboardMaterialFilter(filter) { currentDashboardMaterialFilter = filter; }
function setCurrentStatusFilter(type, filter) { currentStatusFilter[type] = filter; }
function setDeleteInfo(info) { deleteInfo = info; }


// Getters
function getUnidades() { return fb_unidades; }
function getAguaMovimentacoes() { return fb_agua_movimentacoes; }
function getGasMovimentacoes() { return fb_gas_movimentacoes; }
function getMateriais() { return fb_materiais; }
function getEstoqueAgua() { return fb_estoque_agua; }
function getEstoqueGas() { return fb_estoque_gas; }
function isEstoqueInicialDefinido(type) { return estoqueInicialDefinido[type]; }
function getCurrentDashboardMaterialFilter() { return currentDashboardMaterialFilter; }
function getCurrentStatusFilter(type) { return currentStatusFilter[type]; }
function getDeleteInfo() { return deleteInfo; }


export {
    setUnidades, setAguaMovimentacoes, setGasMovimentacoes, setMateriais, setEstoqueAgua, setEstoqueGas, setEstoqueInicialDefinido,
    getUnidades, getAguaMovimentacoes, getGasMovimentacoes, getMateriais, getEstoqueAgua, getEstoqueGas, isEstoqueInicialDefinido,
    setCurrentDashboardMaterialFilter, getCurrentDashboardMaterialFilter, setCurrentStatusFilter, getCurrentStatusFilter,
    setDeleteInfo, getDeleteInfo,
    // Outros estados globais necessários:
    listaExclusoes, modoPrevisao, graficoPrevisao, tipoSelecionadoPrevisao, initialMaterialFilter
};
