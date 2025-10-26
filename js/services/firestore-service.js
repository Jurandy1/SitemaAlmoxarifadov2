// js/services/firestore-service.js
// ============================================================
// Serviço central do Firestore - Define todas as coleções
// ============================================================

import { db } from "../firebase-config.js";
import { collection } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// ------------------------------------------------------------
// Definição das coleções principais do sistema SEMCAS
// ------------------------------------------------------------
export const COLLECTIONS = {
    // Controle de Água
    movimentacoesAgua: collection(db, "movimentacoes_agua"),
    estoqueInicialAgua: collection(db, "estoque_inicial_agua"),
    entradaAgua: collection(db, "entrada_agua"),

    // Controle de Gás
    movimentacoesGas: collection(db, "movimentacoes_gas"),
    estoqueInicialGas: collection(db, "estoque_inicial_gas"),
    entradaGas: collection(db, "entrada_gas"),

    // Controle de Materiais e Unidades
    materiais: collection(db, "controle_materiais"),
    unidades: collection(db, "unidades")
};

// ------------------------------------------------------------
// Exportação direta do db (caso precise em outros módulos)
// ------------------------------------------------------------
export { db };
