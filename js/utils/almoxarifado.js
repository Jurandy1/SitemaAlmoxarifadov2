// js/utils/almoxarifado.js
// Compatibilidade para imports legados do projeto.
// Este módulo evita que builds do Vite falhem quando algum arquivo antigo
// ainda referencia "../utils/almoxarifado.js".

import {
  getAguaMovimentacoes,
  getGasMovimentacoes,
  getEstoqueAgua,
  getEstoqueGas,
  getMateriais,
  getUnidades,
  getEntregas,
  getCurrentDashboardMaterialFilter,
  setCurrentDashboardMaterialFilter
} from "./cache.js";

export {
  getAguaMovimentacoes,
  getGasMovimentacoes,
  getEstoqueAgua,
  getEstoqueGas,
  getMateriais,
  getUnidades,
  getEntregas,
  getCurrentDashboardMaterialFilter,
  setCurrentDashboardMaterialFilter
};

export function getMovimentacoes() {
  return [
    ...(Array.isArray(getAguaMovimentacoes?.()) ? getAguaMovimentacoes() : []),
    ...(Array.isArray(getGasMovimentacoes?.()) ? getGasMovimentacoes() : [])
  ];
}

export function getAlmoxarifadoResumo() {
  return {
    estoqueAgua: getEstoqueAgua?.() || [],
    estoqueGas: getEstoqueGas?.() || [],
    materiais: getMateriais?.() || [],
    unidades: getUnidades?.() || [],
    movimentacoes: getMovimentacoes(),
    entregas: getEntregas?.() || []
  };
}

export function getMateriaisEmEstoque() {
  return getMateriais?.() || [];
}

export function getHistoricoMovimentacoes() {
  return getMovimentacoes();
}

export default {
  getAlmoxarifadoResumo,
  getMateriaisEmEstoque,
  getHistoricoMovimentacoes,
  getMovimentacoes,
  getAguaMovimentacoes,
  getGasMovimentacoes,
  getEstoqueAgua,
  getEstoqueGas,
  getMateriais,
  getUnidades,
  getEntregas
};
