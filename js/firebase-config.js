// js/firebase-config.js
// ============================================================
// Inicialização completa do Firebase para o sistema SEMCAS
// ============================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-storage.js";

// ------------------------------------------------------------
// Configuração do Firebase SEMCAS (oficial do projeto)
// ------------------------------------------------------------
const firebaseConfig = {
    apiKey: "AIzaSyD7VCxaHo8veaHnM8RwY60EX_DEh3hOVHk", 
    authDomain: "controle-almoxarifado-semcas.firebaseapp.com", 
    projectId: "controle-almoxarifado-semcas", 
    storageBucket: "controle-almoxarifado-semcas.appspot.com", // ✅ corrigido (.app → .appspot.com)
    messagingSenderId: "916615427315", 
    appId: "1:916615427315:web:6823897ed065c50d413386"
};

// ------------------------------------------------------------
// Inicializa o Firebase App
// ------------------------------------------------------------
const app = initializeApp(firebaseConfig);

// ------------------------------------------------------------
// Inicializa os serviços principais (Firestore, Auth, Storage)
// ------------------------------------------------------------
const db = getFirestore(app);
const auth = getAuth(app);
const storage = getStorage(app);

// ------------------------------------------------------------
// Exporta para uso em todos os módulos
// ------------------------------------------------------------
export { app, db, auth, storage };
