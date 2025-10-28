// js/utils/db-utils.js
import {
    Timestamp,
    deleteDoc,
    doc,
    writeBatch,
    query,
    where,
    getDocs,
    getDoc,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { ref, deleteObject } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-storage.js";
import { db, storage, auth, COLLECTIONS } from "../services/firestore-service.js";
import { getDeleteInfo, setDeleteInfo, getUserRole } from "./cache.js";
import { showAlert, DOM_ELEMENTS } from "./dom-helpers.js";
import { deleteFile } from "../services/storage-service.js";

/**
 * Retorna a coleção correspondente ao tipo de item.
 */
function getCollectionRef(type) {
    switch (type) {
        case 'agua': return COLLECTIONS.aguaMov;
        case 'gas': return COLLECTIONS.gasMov;
        case 'materiais': return COLLECTIONS.materiais;
        case 'unidade': return COLLECTIONS.unidades;
        case 'entrada-agua': return COLLECTIONS.estoqueAgua;
        case 'entrada-gas': return COLLECTIONS.estoqueGas;
        default:
            console.warn(`⚠️ Tipo de coleção inválido: ${type}`);
            return null;
    }
}

/**
 * Executa a exclusão de um documento (chamado pelo modal de confirmação).
 */
async function executeDelete() {
    const info = getDeleteInfo();
    const role = getUserRole();

    if (!auth.currentUser) {
        showAlert(info.alertElementId || 'alert-gestao', 'Erro: usuário não autenticado.', 'error');
        return;
    }

    if (!['admin', 'editor'].includes(role)) {
        showAlert(info.alertElementId || 'alert-gestao', 'Você não tem permissão para excluir este item.', 'warning');
        return;
    }

    if (!info.id || !info.type) {
        showAlert(info.alertElementId || 'alert-gestao', 'Erro: informações de exclusão incompletas.', 'error');
        return;
    }

    // Configura o estado do modal
    if (DOM_ELEMENTS.btnConfirmDelete && DOM_ELEMENTS.btnCancelDelete) {
        DOM_ELEMENTS.btnConfirmDelete.disabled = true;
        DOM_ELEMENTS.btnConfirmDelete.innerHTML = '<div class="loading-spinner-small mx-auto" style="width:18px; height:18px;"></div>';
        DOM_ELEMENTS.btnCancelDelete.disabled = true;
    }

    const collectionRef = getCollectionRef(info.type);
    if (!collectionRef) {
        console.error(`Erro: tipo de coleção inválido (${info.type})`);
        showAlert(info.alertElementId || 'alert-gestao', 'Erro interno: tipo de coleção desconhecido.', 'error');
        return;
    }

    try {
        // Exclusão de arquivo no Storage, se aplicável
        if (info.type === 'materiais') {
            const materialDoc = await getDoc(doc(collectionRef, info.id));
            if (materialDoc.exists()) {
                const storagePath = materialDoc.data().storagePath;
                if (storagePath) {
                    await deleteFile(storagePath);
                    console.log(`🗑️ Arquivo removido do storage: ${storagePath}`);
                }
            }
        }

        // Exclusão do documento principal
        await deleteDoc(doc(collectionRef, info.id));

        if (info.type === 'unidade') {
            await deleteUnitHistory(info.id);
            showAlert(info.alertElementId || 'alert-gestao', `Unidade "${info.details}" e histórico removidos!`, 'success');
        } else {
            const msg = info.isInicial
                ? 'Lançamento de Estoque Inicial removido!'
                : 'Lançamento removido com sucesso!';
            showAlert(info.alertElementId || 'alert-gestao', msg, 'success');
        }

    } catch (error) {
        console.error(`Erro ao remover ${info.type}:`, error);
        showAlert(info.alertElementId || 'alert-gestao', `Erro ao remover: ${error.message}`, 'error');
    } finally {
        if (DOM_ELEMENTS.confirmDeleteModal) DOM_ELEMENTS.confirmDeleteModal.style.display = 'none';
        if (DOM_ELEMENTS.btnConfirmDelete && DOM_ELEMENTS.btnCancelDelete) {
            DOM_ELEMENTS.btnConfirmDelete.disabled = false;
            DOM_ELEMENTS.btnConfirmDelete.textContent = 'Confirmar Exclusão';
            DOM_ELEMENTS.btnCancelDelete.disabled = false;
        }

        setDeleteInfo({
            id: null,
            type: null,
            collectionRef: null,
            alertElementId: null,
            details: null,
            isInicial: false
        });
    }
}

/**
 * Remove todas as movimentações associadas a uma unidade.
 */
async function deleteUnitHistory(unidadeId) {
    if (!unidadeId || !auth.currentUser) return;
    console.log(`🧹 Limpando histórico da unidade ID: ${unidadeId}`);

    const batch = writeBatch(db);
    let total = 0;

    try {
        const collections = [
            { ref: COLLECTIONS.aguaMov, name: 'movimentações de água' },
            { ref: COLLECTIONS.gasMov, name: 'movimentações de gás' },
            { ref: COLLECTIONS.materiais, name: 'materiais' }
        ];

        for (const { ref, name } of collections) {
            const q = query(ref, where("unidadeId", "==", unidadeId));
            const snapshot = await getDocs(q);
            snapshot.forEach(docSnap => {
                batch.delete(docSnap.ref);
                total++;
            });
            console.log(` - ${snapshot.size} ${name} encontradas para exclusão.`);
        }

        if (total > 0) {
            await batch.commit();
            console.log(`✅ Histórico da unidade ${unidadeId} removido (${total} docs).`);
        } else {
            console.log(`ℹ️ Nenhum histórico encontrado para ${unidadeId}.`);
        }

    } catch (error) {
        console.error(`Erro ao limpar histórico da unidade ${unidadeId}:`, error);
        showAlert('alert-gestao',
            `Erro ao limpar o histórico da unidade: ${error.message}. A unidade foi removida, mas o histórico pode permanecer.`,
            'error', 10000);
    }
}

export { executeDelete, getCollectionRef };
