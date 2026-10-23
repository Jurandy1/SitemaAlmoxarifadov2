// js/utils/almoxarifado.js
// Compatibilidade para imports legados do projeto.
// Este módulo evita que builds do Vite falhem quando algum arquivo antigo
// ainda referencia "../utils/almoxarifado.js".

import {
  getEstoqueAgua,
  getEstoqueGas,
  getMateriais,
  getUnidades,
  getMovimentacoes,
  getEntregas
} from "./cache.js";

export {
  getEstoqueAgua,
  getEstoqueGas,
  getMateriais,
  getUnidades,
  getMovimentacoes,
  getEntregas
};

export function getAlmoxarifadoResumo() {
  return {
    estoqueAgua: getEstoqueAgua?.() || [],
    estoqueGas: getEstoqueGas?.() || [],
    materiais: getMateriais?.() || [],
    unidades: getUnidades?.() || [],
    movimentacoes: getMovimentacoes?.() || [],
    entregas: getEntregas?.() || []
  };
}

export function getMateriaisEmEstoque() {
  return getMateriais?.() || [];
}

export function getHistoricoMovimentacoes() {
  return getMovimentacoes?.() || [];
}

export default {
  getAlmoxarifadoResumo,
  getMateriaisEmEstoque,
  getHistoricoMovimentacoes,
  getEstoqueAgua,
  getEstoqueGas,
  getMateriais,
  getUnidades,
  getMovimentacoes,
  getEntregas
};
