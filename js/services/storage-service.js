// js/services/storage-service.js
import { ref, uploadBytes, getDownloadURL, deleteObject } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-storage.js";
import { storage } from "./firestore-service.js";
import { APP_ID } from "../firebase-config.js";

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
        console.log("Arquivo anexo excluído:", storagePath);
    } catch (error) {
        // Ignora erro se o arquivo não existir (not-found)
        if (error.code !== 'storage/object-not-found') {
            console.warn("Erro ao excluir arquivo anexo:", error);
            throw error;
        }
    }
}

export { uploadFile, deleteFile };
