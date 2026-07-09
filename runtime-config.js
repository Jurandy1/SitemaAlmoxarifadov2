const cfg = {
  apiKey: "AIzaSyD7VCxaHo8veaHnM8RwY60EX_DEh3hOVHk",
  authDomain: "controle-almoxarifado-semcas.firebaseapp.com",
  projectId: "controle-almoxarifado-semcas",
  storageBucket: "controle-almoxarifado-semcas.firebasestorage.app",
  messagingSenderId: "916615427315",
  appId: "1:916615427315:web:6823897ed065c50d413386"
};

if (typeof globalThis.__firebase_config === "undefined") {
  globalThis.__firebase_config = JSON.stringify(cfg);
}
if (typeof globalThis.__app_id === "undefined") {
  const fromStorage = (() => {
    try { return globalThis.localStorage?.getItem('semcas_app_id') || ''; } catch (_) { return ''; }
  })();
  globalThis.__app_id = fromStorage || cfg.projectId;
}
if (typeof globalThis.__initial_auth_token === "undefined") {
  globalThis.__initial_auth_token = null;
}
