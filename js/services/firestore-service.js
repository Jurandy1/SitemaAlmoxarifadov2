// js/services/firestore-service.js
//
// ═══════════════════════════════════════════════════════════════════════
//  OTIMIZAÇÃO DE LEITURAS FIREBASE — SPARK PLAN (50 K leituras/dia)
// ═══════════════════════════════════════════════════════════════════════
//
//  COMO FUNCIONA O CACHE:
//  • persistentLocalCache (IndexedDB) faz com que, após o PRIMEIRO carregamento,
//    os documentos subsequentes sejam servidos do disco local — SEM custo de leitura.
//  • onSnapshot continua "ao vivo": só gasta uma leitura por DOCUMENTO ALTERADO.
//  • O status.html usa getDocs com aggregate queries (1 leitura total por coleção)
//    e polling a cada 10 min — não usa onSnapshot.
//
//  DICAS PARA REDUZIR LEITURAS ADICIONAIS:
//  1. Não abra múltiplas abas do app simultaneamente (cada aba reinicia listeners).
//  2. Evite recarregar a página sem necessidade; o cache local persiste entre sessões.
//  3. Para o dashboard TV, o status.html já usa polling eficiente (aggregate queries).
//  4. Coleções grandes (controleAgua, controleGas) são varridas só uma vez na abertura;
//     após isso, apenas deltas chegam via WebSocket.
//
// ═══════════════════════════════════════════════════════════════════════

import { initializeApp } from "firebase/app";
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  collection,
  setLogLevel,
  getDocs,
  query,
  limit
} from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { getAuth } from "firebase/auth";
import { firebaseConfig, APP_ID } from "../firebase-config.js";

// ─── INSTÂNCIAS FIREBASE ───────────────────────────────────────────────
let app, db, auth, storage;

// ─── COLEÇÕES ──────────────────────────────────────────────────────────
let COLLECTIONS = {};
let __collectionsPrimary = null;
let __collectionsLegacy  = null;
let __activeCollectionsKey = 'primary';

// ─── LISTENER REGISTRY — evita listeners duplicados ───────────────────
// Cada listener registrado aqui é identificado por uma chave única.
// Se a mesma chave já existir, o listener anterior é cancelado antes de criar um novo.
const _listenerRegistry = new Map(); // key → unsubscribe()

export function registerListener(key, unsubFn) {
  if (_listenerRegistry.has(key)) {
    try { _listenerRegistry.get(key)(); } catch (_) {}
  }
  _listenerRegistry.set(key, unsubFn);
}

export function unregisterListener(key) {
  if (_listenerRegistry.has(key)) {
    try { _listenerRegistry.get(key)(); } catch (_) {}
    _listenerRegistry.delete(key);
  }
}

export function clearAllListeners() {
  _listenerRegistry.forEach((unsub) => { try { unsub(); } catch (_) {} });
  _listenerRegistry.clear();
}

// ─── BUILDER DE COLEÇÕES ───────────────────────────────────────────────
function buildCollections(basePath) {
  return {
    unidades:       collection(db, `${basePath}/unidades`),
    aguaMov:        collection(db, `${basePath}/controleAgua`),
    gasMov:         collection(db, `${basePath}/controleGas`),
    materiais:      collection(db, `${basePath}/controleMateriais`),
    estoqueAgua:    collection(db, `${basePath}/estoqueAgua`),
    estoqueGas:     collection(db, `${basePath}/estoqueGas`),
    userRoles:      collection(db, `${basePath}/userRoles`),
    feriados:       collection(db, `${basePath}/feriados`),
    cestaMov:       collection(db, `${basePath}/socialCestaMov`),
    cestaEstoque:   collection(db, `${basePath}/socialCestaEstoque`),
    enxovalMov:     collection(db, `${basePath}/socialEnxovalMov`),
    enxovalEstoque: collection(db, `${basePath}/socialEnxovalEstoque`),
    semcasHistDB:   collection(db, `${basePath}/semcasHistDB`),
    semcasAliases:  collection(db, `${basePath}/semcasAliases`),
  };
}

// ─── INICIALIZAÇÃO FIREBASE ────────────────────────────────────────────
function initializeFirebaseServices() {
  if (app) return; // Guard: não inicializa duas vezes

  app = initializeApp(firebaseConfig);

  const forceLongPolling = (() => {
    try {
      if (typeof window !== 'undefined' && window.__FIRESTORE_FORCE_LONG_POLLING === true) return true;
    } catch (_) {}
    try {
      if (typeof document !== 'undefined' && document.body?.classList?.contains('tv-mode')) return true;
    } catch (_) {}
    return false;
  })();

  // Tenta com cache persistente (IndexedDB) — reduz drasticamente leituras
  // após o primeiro carregamento. Cada aba nova ainda gasta leituras iniciais,
  // mas todos os onSnapshot subsequentes servem do cache.
  let cacheOk = false;
  try {
    db = initializeFirestore(app, {
      // WebSocket (padrão) é MAIS eficiente que long-polling.
      // Se o ambiente bloquear WebSocket, remova as duas linhas abaixo:
      experimentalForceLongPolling: forceLongPolling,
      useFetchStreams: !forceLongPolling,
      localCache: persistentLocalCache({
        tabManager: persistentMultipleTabManager()
      })
    });
    cacheOk = true;
  } catch (e1) {
    console.warn('[Firestore] Cache persistente indisponível, tentando sem WebSocket:', e1.code || e1.message);
    // Fallback 1: long-polling com cache
    try {
      db = initializeFirestore(app, {
        experimentalForceLongPolling: true,
        useFetchStreams: false,
        localCache: persistentLocalCache({
          tabManager: persistentMultipleTabManager()
        })
      });
      cacheOk = true;
    } catch (e2) {
      console.warn('[Firestore] Cache também falhou, usando Firestore padrão:', e2.code || e2.message);
      // Fallback 2: sem cache (todos os carregamentos custam leituras)
      try {
        db = initializeFirestore(app, {
          experimentalForceLongPolling: true,
          useFetchStreams: false
        });
      } catch (_) {
        db = getFirestore(app);
      }
    }
  }

  // Silencia logs verbosos do Firestore no console (economiza memória/CPU)
  setLogLevel('error');

  auth    = getAuth(app);
  storage = getStorage(app);

  const basePath       = `artifacts/${APP_ID}/public/data`;
  const legacyBasePath = `artifacts/default-app-id/public/data`;

  console.log('[Firestore] Cache:', cacheOk ? '✅ Ativo (IndexedDB)' : '⚠️ Inativo');
  console.log('[Firestore] Caminho:', basePath);

  __collectionsPrimary = buildCollections(basePath);
  __collectionsLegacy  = buildCollections(legacyBasePath);
  COLLECTIONS          = __collectionsPrimary;
  __activeCollectionsKey = 'primary';
}

// ─── DETECÇÃO AUTOMÁTICA DE COLEÇÃO COM DADOS ──────────────────────────
// Faz até 4 leituras de 1 doc para verificar qual caminho tem dados.
// Só roda uma vez na sessão (resultado cacheado).
let _ensurePromise = null;

async function ensureCollectionsWithData() {
  if (_ensurePromise) return _ensurePromise;

  _ensurePromise = (async () => {
    if (!db || !__collectionsPrimary || !__collectionsLegacy) return __activeCollectionsKey;
    try {
      const hasAny = async (cols) => {
        const checks = [cols.unidades, cols.estoqueAgua, cols.aguaMov, cols.materiais];
        for (const c of checks) {
          const snap = await getDocs(query(c, limit(1)));
          if (!snap.empty) return true;
        }
        return false;
      };

      if (await hasAny(__collectionsPrimary)) {
        COLLECTIONS = __collectionsPrimary;
        __activeCollectionsKey = 'primary';
        return 'primary';
      }
      if (await hasAny(__collectionsLegacy)) {
        COLLECTIONS = __collectionsLegacy;
        __activeCollectionsKey = 'legacy';
        return 'legacy';
      }
    } catch (err) {
      console.warn('[Firestore] ensureCollections (verifique regras de permissão):', err.code || err.message);
    }

    COLLECTIONS = __collectionsPrimary;
    __activeCollectionsKey = 'primary';
    return 'primary';
  })();

  return _ensurePromise;
}

function getLegacyCollections()  { return __collectionsLegacy;  }
function getPrimaryCollections() { return __collectionsPrimary; }

// ─── INICIALIZAÇÃO AUTOMÁTICA AO CARREGAR O MÓDULO ────────────────────
initializeFirebaseServices();

// ─── EXPORTS ──────────────────────────────────────────────────────────
export {
  initializeFirebaseServices,
  db,
  auth,
  storage,
  COLLECTIONS,
  ensureCollectionsWithData,
  getLegacyCollections,
  getPrimaryCollections,
};
