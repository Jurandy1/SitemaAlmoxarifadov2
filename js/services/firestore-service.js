// js/services/firestore-service.js
// ============================================================
// Serviço de Firestore e Coleções - SEMCAS
// ============================================================

import { collection } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { db, APP_ID } from "../firebase-config.js";

// ============================================================
// DEFINIÇÃO DAS COLEÇÕES PADRÃO
// ============================================================

// Caminho base das coleções (cada app isolado pelo APP_ID)
const basePath = `artifacts/${APP_ID}/public/data`;
console.log("📁 Caminho base Firestore:", basePath);

// ============================================================
// MAPEAMENTO DAS COLEÇÕES DO SISTEMA
// ============================================================

const COLLECTIONS = {
  unidades: collection(db, `${basePath}/unidades`),
  aguaMov: collection(db, `${basePath}/controleAgua`),
  gasMov: collection(db, `${basePath}/controleGas`),
  materiais: collection(db, `${basePath}/controleMateriais`),
  estoqueAgua: collection(db, `${basePath}/estoqueAgua`),
  estoqueGas: collection(db, `${basePath}/estoqueGas`)
};

// ============================================================
// EXPORTS
// ============================================================

export { db, COLLECTIONS };
