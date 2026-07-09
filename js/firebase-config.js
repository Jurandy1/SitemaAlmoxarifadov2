// js/firebase-config.js
// Este módulo contém apenas a configuração e IDs necessários para inicializar o Firebase.
// É importado pelo firestore-service.js.

// Configuração de fallback caso as variáveis de ambiente do Canvas não estejam definidas
const userFallbackConfig = {
    apiKey: "AIzaSyD7VCxaHo8veaHnM8RwY60EX_DEh3hOVHk", 
    authDomain: "controle-almoxarifado-semcas.firebaseapp.com", 
    projectId: "controle-almoxarifado-semcas", 
    storageBucket: "controle-almoxarifado-semcas.firebasestorage.app", 
    messagingSenderId: "916615427315", 
    appId: "1:916615427315:web:6823897ed065c50d413386" 
};

// Variáveis globais (fornecidas pelo ambiente ou fallback)
const runtimeFirebaseConfig = (typeof globalThis !== 'undefined' && typeof globalThis.__firebase_config !== 'undefined')
    ? globalThis.__firebase_config
    : undefined;
const firebaseConfigString = runtimeFirebaseConfig || JSON.stringify(userFallbackConfig);
const firebaseConfig = JSON.parse(firebaseConfigString);

const runtimeAppId = (typeof globalThis !== 'undefined' && typeof globalThis.__app_id !== 'undefined')
    ? globalThis.__app_id
    : undefined;
const rawAppId = runtimeAppId || 'default-app-id';
const APP_ID = rawAppId.replace(/[\/.]/g, '-');

const initialAuthToken = (typeof globalThis !== 'undefined' && typeof globalThis.__initial_auth_token !== 'undefined')
    ? globalThis.__initial_auth_token
    : null;

try {
    const hostname = (typeof window !== 'undefined' && window.location) ? window.location.hostname : '';
    const isLocal = hostname === 'localhost' || hostname === '127.0.0.1';
    if (!isLocal) {
        if (typeof globalThis === 'undefined' || typeof globalThis.__firebase_config === 'undefined') {
            console.warn('Aviso: __firebase_config não definido. Usando firebaseConfig de fallback.');
        }
        if (typeof globalThis === 'undefined' || typeof globalThis.__app_id === 'undefined') {
            console.warn('Aviso: __app_id não definido. Usando APP_ID de fallback (default-app-id).');
        }
    }
} catch (_) {}

export { firebaseConfig, APP_ID, initialAuthToken };
