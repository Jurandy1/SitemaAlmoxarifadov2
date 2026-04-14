// js/services/firestore-service.js
import { initializeApp } from "firebase/app";
import { getFirestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager, collection, setLogLevel, getDocs, query, limit } from "firebase/firestore"; 
import { getStorage } from "firebase/storage";
import { getAuth } from "firebase/auth";
import { firebaseConfig, APP_ID } from "../firebase-config.js";

// Instâncias do Firebase
let app, db, auth, storage;

// Referências de Coleções (configuradas após a inicialização)
let COLLECTIONS = {};
let __collectionsPrimary = null;
let __collectionsLegacy = null;
let __activeCollectionsKey = 'primary';

function buildCollections(basePath) {
    return {
        unidades: collection(db, `${basePath}/unidades`),
        aguaMov: collection(db, `${basePath}/controleAgua`),
        gasMov: collection(db, `${basePath}/controleGas`),
        materiais: collection(db, `${basePath}/controleMateriais`),
        estoqueAgua: collection(db, `${basePath}/estoqueAgua`),
        estoqueGas: collection(db, `${basePath}/estoqueGas`),
        userRoles: collection(db, `${basePath}/userRoles`),
        feriados: collection(db, `${basePath}/feriados`),
        cestaMov: collection(db, `${basePath}/socialCestaMov`),
        cestaEstoque: collection(db, `${basePath}/socialCestaEstoque`),
        enxovalMov: collection(db, `${basePath}/socialEnxovalMov`),
        enxovalEstoque: collection(db, `${basePath}/socialEnxovalEstoque`),
        semcasHistDB: collection(db, `${basePath}/semcasHistDB`),
        semcasAliases: collection(db, `${basePath}/semcasAliases`),
    };
}

/**
 * Inicializa as instâncias do Firebase e define as coleções.
 * (Esta função será chamada imediatamente para garantir que as instâncias estejam prontas)
 */
function initializeFirebaseServices() {
    if (app) return; // Já inicializado
    
    // setLogLevel('debug'); // Removido por padrão, mas útil para debug

    app = initializeApp(firebaseConfig);
    // Inicializa Firestore com persistência offline (IndexedDB) para reduzir leituras.
    // Após o primeiro carregamento, os dados vêm do cache local e apenas as
    // alterações (deltas) são buscadas do servidor.
    try {
        db = initializeFirestore(app, {
            experimentalForceLongPolling: true,
            useFetchStreams: false,
            localCache: persistentLocalCache({
                tabManager: persistentMultipleTabManager()
            })
        });
    } catch (e) {
        // Fallback: se a persistência falhar (ex.: navegador incompatível),
        // tenta sem cache persistente.
        console.warn("Persistência IndexedDB falhou, usando Firestore sem cache local:", e.message);
        try {
            db = initializeFirestore(app, {
                experimentalForceLongPolling: true,
                useFetchStreams: false
            });
        } catch (_) {
            db = getFirestore(app);
        }
    }
    // Reduz verbosidade de logs do Firestore no navegador
    setLogLevel('error');
    auth = getAuth(app);
    storage = getStorage(app); 
    
    const basePath = `artifacts/${APP_ID}/public/data`;
    const legacyBasePath = `artifacts/default-app-id/public/data`;
    console.log("Caminho base das coleções:", basePath);
    __collectionsPrimary = buildCollections(basePath);
    __collectionsLegacy = buildCollections(legacyBasePath);
    COLLECTIONS = __collectionsPrimary;
    __activeCollectionsKey = 'primary';
}

async function ensureCollectionsWithData() {
    if (!db || !__collectionsPrimary || !__collectionsLegacy) return __activeCollectionsKey;
    try {
        const hasAnyData = async (cols) => {
            const checks = [cols.unidades, cols.estoqueAgua, cols.aguaMov, cols.materiais];
            for (const c of checks) {
                const snap = await getDocs(query(c, limit(1)));
                if (!snap.empty) return true;
            }
            return false;
        };

        if (await hasAnyData(__collectionsPrimary)) {
            COLLECTIONS = __collectionsPrimary;
            __activeCollectionsKey = 'primary';
            return __activeCollectionsKey;
        }
        if (await hasAnyData(__collectionsLegacy)) {
            COLLECTIONS = __collectionsLegacy;
            __activeCollectionsKey = 'legacy';
            return __activeCollectionsKey;
        }
    } catch (err) {
        console.warn("Erro no ensureCollectionsWithData (verifique as regras de permissão):", err);
    }
    COLLECTIONS = __collectionsPrimary;
    __activeCollectionsKey = 'primary';
    return __activeCollectionsKey;
}

function getLegacyCollections() {
    return __collectionsLegacy;
}

function getPrimaryCollections() {
    return __collectionsPrimary;
}

// ** CHAMADA DA FUNÇÃO DE INICIALIZAÇÃO IMEDIATAMENTE NA CARGA DO MÓDULO **
initializeFirebaseServices();

// Exports
export { 
    initializeFirebaseServices, // Mantida para compatibilidade, mas agora redundante
    db, 
    auth, 
    storage, 
    COLLECTIONS,
    ensureCollectionsWithData,
    getLegacyCollections,
    getPrimaryCollections
};
