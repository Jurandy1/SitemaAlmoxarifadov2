// js/utils/db-utils.js
import {
    doc,
    deleteDoc
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { db } from "../services/firestore-service.js";
import { getUserRole } from "./cache.js";
import { showAlert } from "./dom-helpers.js";

/**
 * Deleta um documento com checagem de permissões.
 * @param {string} collectionPath - Caminho da coleção Firestore.
 * @param {string} docId - ID do documento a ser deletado.
 * @param {string} alertId - ID do elemento de alerta para feedback.
 */
export async function executeDelete(collectionPath, docId, alertId) {
    try {
        const role = getUserRole();
        if (!['admin', 'editor'].includes(role)) {
            showAlert(alertId, "Você não tem permissão para deletar este item.", "warning");
            return;
        }

        await deleteDoc(doc(db, collectionPath, docId));
        showAlert(alertId, "Item removido com sucesso.", "success");
    } catch (err) {
        console.error("Erro ao remover documento:", err);
        showAlert(alertId, "Erro ao remover item: permissão insuficiente ou erro de rede.", "error");
    }
}
