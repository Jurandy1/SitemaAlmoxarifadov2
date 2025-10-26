// js/utils/db-utils.js
import { Timestamp, deleteDoc, doc, writeBatch, query, where, getDocs, getDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { ref, deleteObject } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-storage.js";

// --- CORREÇÃO INÍCIO ---
// 'auth' e 'storage' não são exportados por 'firestore-service.js'.
// Eles devem ser importados de 'firebase-config.js'.
import { db, COLLECTIONS } from "../services/firestore-service.js";
import { storage, auth } from "../firebase-config.js";
// --- CORREÇÃO FIM ---

import { getDeleteInfo, setDeleteInfo } from "./cache.js";
import { showAlert, DOM_ELEMENTS } from "./dom-helpers.js";
import { deleteFile } from "../services/storage-service.js";

/**
 * Obtém a coleção correta baseada no tipo de item.
 * @param {string} type Tipo de item ('agua', 'gas', 'materiais', 'unidade', 'estoqueAgua', 'estoqueGas').
 * @returns {CollectionReference} Referência da coleção.
 */
function getCollectionRef(type) {
    if (type === 'agua') return COLLECTIONS.aguaMov;
    if (type === 'gas') return COLLECTIONS.gasMov;
    if (type === 'materiais') return COLLECTIONS.materiais;
    if (type === 'unidade') return COLLECTIONS.unidades;
    if (type === 'entrada-agua') return COLLECTIONS.estoqueAgua;
    if (type === 'entrada-gas') return COLLECTIONS.estoqueGas;
    return null;
}

/**
 * Executa a exclusão de um documento (chamado pelo modal de confirmação).
 */
async function executeDelete() {
    const info = getDeleteInfo();
    if (!auth.currentUser || !info.id || !info.type) {
         showAlert(info.alertElementId || 'alert-gestao', 'Erro: Não autenticado ou informação de exclusão inválida.', 'error');
         return;
    }

    DOM_ELEMENTS.btnConfirmDelete.disabled = true; 
    DOM_ELEMENTS.btnConfirmDelete.innerHTML = '<div class="loading-spinner-small mx-auto" style="width:18px; height:18px;"></div>';
    DOM_ELEMENTS.btnCancelDelete.disabled = true;
    
    const collectionRef = getCollectionRef(info.type);

    try {
        // Lógica especial para materiais (exclui o arquivo no Storage)
        if (info.type === 'materiais') {
            const materialDoc = await getDoc(doc(collectionRef, info.id));
            if (materialDoc.exists()) {
                const storagePath = materialDoc.data().storagePath;
                if (storagePath) {
                    await deleteFile(storagePath);
                }
            }
        }

        const docRef = doc(collectionRef, info.id);
        await deleteDoc(docRef);

        if (info.type === 'unidade') {
            await deleteUnitHistory(info.id); 
            showAlert(info.alertElementId || 'alert-gestao', `Unidade "${info.details}" e seu histórico removidos!`, 'success');
        } else {
            const message = info.isInicial ? 'Lançamento de Estoque Inicial removido!' : 'Lançamento removido com sucesso!';
            showAlert(info.alertElementId || 'alert-gestao', message, 'success');
        }

    } catch (error) {
        console.error(`Erro ao remover ${info.type}:`, error);
        showAlert(info.alertElementId || 'alert-gestao', `Erro ao remover: ${error.message}`, 'error');
    } finally {
        DOM_ELEMENTS.confirmDeleteModal.style.display = 'none';
        DOM_ELEMENTS.btnConfirmDelete.disabled = false; 
        DOM_ELEMENTS.btnConfirmDelete.textContent = 'Confirmar Exclusão';
        DOM_ELEMENTS.btnCancelDelete.disabled = false;
        setDeleteInfo({ id: null, type: null, collectionRef: null, alertElementId: null, details: null, isInicial: false });
    }
}

/**
 * Remove todas as movimentações de água, gás e materiais associadas a uma unidade.
 * @param {string} unidadeId ID da unidade a ser removida.
 */
async function deleteUnitHistory(unidadeId) {
    if (!unidadeId || !auth.currentUser) return;
    console.log(`Iniciando remoção do histórico para unidade ID: ${unidadeId}`);
    
    const batch = writeBatch(db); 
    let deleteCount = 0;
    
    try {
        const collectionsToDelete = [
            { collection: COLLECTIONS.aguaMov, name: 'movimentações de água' },
            { collection: COLLECTIONS.gasMov, name: 'movimentações de gás' },
            { collection: COLLECTIONS.materiais, name: 'registros de materiais' }
        ];

        for (const { collection, name } of collectionsToDelete) {
            const q = query(collection, where("unidadeId", "==", unidadeId));
            const snapshot = await getDocs(q); 
            snapshot.forEach(doc => { 
                batch.delete(doc.ref); 
                deleteCount++; 
            });
            console.log(` - ${snapshot.size} ${name} para remover.`);
        }
         
        if (deleteCount > 0) {
            await batch.commit(); 
            console.log(`Histórico da unidade ${unidadeId} removido (${deleteCount} documentos).`);
        } else { 
            console.log(`Nenhum histórico encontrado para a unidade ${unidadeId}.`); 
        }
    } catch (error) {
         console.error(`Erro ao remover histórico da unidade ${unidadeId}:`, error);
         showAlert('alert-gestao', `Erro ao limpar o histórico da unidade: ${error.message}. A unidade foi removida, mas o histórico pode permanecer.`, 'error', 10000);
         throw error; 
    }
}

export { executeDelete, getCollectionRef };
