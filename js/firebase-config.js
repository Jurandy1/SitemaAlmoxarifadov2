// js/firebase-config.js
// ============================================================
// Configuração central do Firebase - SEMCAS
// ============================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-storage.js";

// ============================================================
// CONFIGURAÇÃO DO PROJETO FIREBASE
// ============================================================

const firebaseConfig = {
  apiKey: "AIzaSyD7VCxaHo8veaHnM8RwY60EX_DEh3hOVHk",
  authDomain: "controle-almoxarifado-semcas.firebaseapp.com",
  projectId: "controle-almoxarifado-semcas",
  storageBucket: "controle-almoxarifado-semcas.firebasestorage.app",
  messagingSenderId: "916615427315",
  appId: "1:916615427315:web:6823897ed065c50d413386"
};

// ============================================================
// INICIALIZAÇÃO DO FIREBASE
// ============================================================

const app = initializeApp(firebaseConfig);

// Instâncias principais (compartilhadas entre módulos)
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

// ============================================================
// VARIÁVEIS AUXILIARES
// ============================================================

// ID de aplicação base para coleções
const APP_ID = "default-app-id";

// Token inicial (caso futuro para autenticação com token custom)
const initialAuthToken = null;

// ============================================================
// EXPORTS
// ============================================================

export { app, auth, db, storage, firebaseConfig, APP_ID, initialAuthToken };
