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
const firebaseConfigString = typeof __firebase_config !== 'undefined' ? __firebase_config : JSON.stringify(userFallbackConfig);
const firebaseConfig = JSON.parse(firebaseConfigString);

const rawAppId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
const APP_ID = rawAppId.replace(/[\/.]/g, '-');

const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

export { firebaseConfig, APP_ID, initialAuthToken };
