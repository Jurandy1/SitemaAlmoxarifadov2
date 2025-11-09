// js/services/firestore-service.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getFirestore, collection, setLogLevel } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js"; 
import { getStorage } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-storage.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { firebaseConfig, APP_ID } from "../firebase-config.js";

// Instâncias do Firebase
let app, db, auth, storage;

// Referências de Coleções (configuradas após a inicialização)
let COLLECTIONS = {};

/**
 * Inicializa as instâncias do Firebase e define as coleções.
 * (Esta função será chamada imediatamente para garantir que as instâncias estejam prontas)
 */
function initializeFirebaseServices() {
    if (app) return; // Já inicializado
    
    // setLogLevel('debug'); // Removido por padrão, mas útil para debug

    app = initializeApp(firebaseConfig);
    db = getFirestore(app);
    auth = getAuth(app);
    storage = getStorage(app); 
    
    const basePath = `artifacts/${APP_ID}/public/data`;
    console.log("Caminho base das coleções:", basePath);

    COLLECTIONS = {
        unidades: collection(db, `${basePath}/unidades`),
        aguaMov: collection(db, `${basePath}/controleAgua`),
        gasMov: collection(db, `${basePath}/controleGas`),
        materiais: collection(db, `${basePath}/controleMateriais`),
        estoqueAgua: collection(db, `${basePath}/estoqueAgua`),
        estoqueGas: collection(db, `${basePath}/estoqueGas`),
        userRoles: collection(db, `${basePath}/userRoles`),
        // NOVAS COLEÇÕES PARA ASSISTÊNCIA SOCIAL
        cestaMov: collection(db, `${basePath}/socialCestaMov`),
        cestaEstoque: collection(db, `${basePath}/socialCestaEstoque`),
        enxovalMov: collection(db, `${basePath}/socialEnxovalMov`),
        enxovalEstoque: collection(db, `${basePath}/socialEnxovalEstoque`),
    };
}

// ** CHAMADA DA FUNÇÃO DE INICIALIZAÇÃO IMEDIATAMENTE NA CARGA DO MÓDULO **
initializeFirebaseServices();

// Exports
export { 
    initializeFirebaseServices, // Mantida para compatibilidade, mas agora redundante
    db, 
    auth, 
    storage, 
    COLLECTIONS 
};
