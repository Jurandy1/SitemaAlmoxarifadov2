// js/services/storage-service.js
// ============================================================
// Serviço de upload e exclusão de arquivos no Firebase Storage
// ============================================================

import { ref, uploadBytes, getDownloadURL, deleteObject } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-storage.js";
import { storage, APP_ID } from "../firebase-config.js"; // ✅ Correção: import direto do firebase-config.js

/**
 * Faz o upload de um arquivo para o Firebase Storage.
 * @param {File} file Arquivo a ser enviado.
 * @returns {Promise<{fileURL: string, storagePath: string}>} URL de download e caminho do Storage.
 */
async function uploadFile(file) {
    if (!storage) throw new Error("Storage não inicializado.");
    
    const fileId = `${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '')}`;
    const storagePath = `artifacts/${APP_ID}/pedidosMateriais/${fileId}`;
    const storageRef = ref(storage, storagePath);
    
    const snapshot = await uploadBytes(storageRef, file);
    const fileURL = await getDownloadURL(snapshot.ref);
    
    console.log("📤 Arquivo enviado com sucesso:", storagePath);
    return { fileURL, storagePath };
}

/**
 * Exclui um arquivo do Firebase Storage.
 * @param {string} storagePath Caminho do arquivo no Storage.
 */
async function deleteFile(storagePath) {
    if (!storage) throw new Error("Storage não inicializado.");
    if (!storagePath) return;

    try {
        const fileRef = ref(storage, storagePath);
        await deleteObject(fileRef);
        console.log("🗑️ Arquivo excluído do Storage:", storagePath);
    } catch (error) {
        // Ignora erro se o arquivo não existir (not-found)
        if (error.code !== 'storage/object-not-found') {
            console.warn("⚠️ Erro ao excluir arquivo:", error);
            throw error;
        }
    }
}

// ============================================================
// EXPORTS
// ============================================================

export { uploadFile, deleteFile };
