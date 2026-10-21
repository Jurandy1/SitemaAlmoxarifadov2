// js/compat/firebase-app.js — substitui "firebase/app" quando o backend é Supabase.
const apps = new Map();

export function initializeApp(options = {}, name = "[DEFAULT]") {
  const app = { name, options, automaticDataCollectionEnabled: false };
  apps.set(name, app);
  return app;
}

export function getApp(name = "[DEFAULT]") {
  return apps.get(name) || initializeApp({}, name);
}

export function getApps() {
  return [...apps.values()];
}

export async function deleteApp(app) {
  apps.delete(app?.name);
}
