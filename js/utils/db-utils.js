// js/utils/db-utils.js
import {
  deleteDoc,
  doc,
  getDoc,
  query,
  where,
  getDocs,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { deleteFile } from "../services/storage-service.js";
import { db, COLLECTIONS, auth } from "../services/firestore-service.js";
import { getDeleteInfo, setDeleteInfo } from "../utils/cache.js";
import { showAlert, DOM_ELEMENTS } from "../utils/dom-helpers.js";
// Importa as funções de re-renderização dos módulos
import { onAguaTabChange } from "../modules/agua-control.js";
import { onGasTabChange } from "../modules/gas-control.js";

/**
 * Retorna a referência de coleção com base no tipo.
 * @param {string} type Tipo do item a ser excluído ('agua', 'gas', 'materiais', 'unidade', 'entrada-agua', 'entrada-gas').
 * @returns {import("firebase/firestore").CollectionReference | null} Referência da coleção.
 */
function getCollectionRef(type) {
  switch (type) {
    case "agua":
      return COLLECTIONS.aguaMov;
    case "gas":
      return COLLECTIONS.gasMov;
    case "materiais":
      return COLLECTIONS.materiais;
    case "unidade":
      return COLLECTIONS.unidades;
    case "entrada-agua":
      return COLLECTIONS.estoqueAgua;
    case "entrada-gas":
      return COLLECTIONS.estoqueGas;
    default:
      return null;
  }
}

/**
 * Executa a exclusão de um documento do Firestore.
 */
async function executeDelete() {
  const info = getDeleteInfo();
  if (!auth.currentUser || !info.id || !info.type) {
    showAlert(info.alertElementId || "alert-gestao", "Erro: usuário não autenticado.", "error");
    return;
  }

  const ref = getCollectionRef(info.type);
  if (!ref) {
    showAlert(info.alertElementId || "alert-gestao", "Tipo inválido de coleção.", "error");
    return;
  }

  DOM_ELEMENTS.btnConfirmDelete.disabled = true;
  DOM_ELEMENTS.btnConfirmDelete.innerHTML = '<div class="loading-spinner-small mx-auto"></div>';
  
  const alertId = info.alertElementId || "alert-gestao";

  try {
    // Lógica para exclusão de anexo de materiais
    if (info.type === "materiais") {
      const matDoc = await getDoc(doc(ref, info.id));
      if (matDoc.exists() && matDoc.data().storagePath) {
        await deleteFile(matDoc.data().storagePath);
      }
    }

    await deleteDoc(doc(ref, info.id));

    if (info.type === "unidade") {
      // Se for unidade, exclui também todo o histórico relacionado
      await deleteUnitHistory(info.id);
      showAlert(alertId, "Unidade e histórico removidos.", "success");
    } else {
      showAlert(alertId, "Item removido com sucesso.", "success");
      
      // Re-renderização específica para Estoque e Movimentações
      if (info.type === 'entrada-agua' || info.type === 'agua') {
          // Chama a orquestração completa da aba Água para re-renderizar o histórico e o resumo de estoque
          onAguaTabChange(); 
      } else if (info.type === 'entrada-gas' || info.type === 'gas') {
          // Chama a orquestração completa da aba Gás para re-renderizar o histórico e o resumo de estoque
          onGasTabChange(); 
      }
    }
  } catch (err) {
    console.error(`Erro ao remover ${info.type}:`, err);
    showAlert(alertId, `Erro ao remover: ${err.message}`, "error");
  } finally {
    DOM_ELEMENTS.btnConfirmDelete.disabled = false;
    DOM_ELEMENTS.btnConfirmDelete.textContent = "Confirmar Exclusão";
    DOM_ELEMENTS.confirmDeleteModal.style.display = "none";
    setDeleteInfo({});
    if (typeof lucide !== 'undefined' && typeof lucide.createIcons === 'function') { lucide.createIcons(); }
  }
}

/**
 * Exclui todo o histórico de movimentações (Água, Gás, Materiais) para uma unidade.
 * @param {string} uid ID da unidade a ser excluída.
 */
async function deleteUnitHistory(uid) {
  const batch = writeBatch(db);
  const collections = [
    COLLECTIONS.aguaMov,
    COLLECTIONS.gasMov,
    COLLECTIONS.materiais,
    COLLECTIONS.estoqueAgua,
    COLLECTIONS.estoqueGas
  ];

  for (const col of collections) {
    // Filtra todas as movimentações/entradas que contêm o ID da unidade
    const q = query(col, where("unidadeId", "==", uid));
    const snap = await getDocs(q);
    snap.forEach((d) => batch.delete(d.ref));
  }

  await batch.commit();
  console.log(`Histórico da unidade ${uid} excluído.`);
}

export { executeDelete, getCollectionRef };
