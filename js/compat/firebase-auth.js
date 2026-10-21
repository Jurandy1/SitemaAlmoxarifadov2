// js/compat/firebase-auth.js — substitui "firebase/auth" usando Supabase Auth.
import { supabase, createIsolatedClient } from "./supabase-client.js";

function authError(code, message) {
  const e = new Error(message || code);
  e.code = code;
  return e;
}

// Converte erros do Supabase para os códigos que o app já trata (auth/...)
function mapError(error) {
  const msg = String(error?.message || "");
  const status = error?.status;
  if (/invalid login credentials/i.test(msg)) return authError("auth/invalid-credential", msg);
  if (/email not confirmed/i.test(msg)) return authError("auth/invalid-credential", msg);
  if (/invalid.*email|unable to validate email/i.test(msg)) return authError("auth/invalid-email", msg);
  if (/already registered|already been registered|already exists/i.test(msg)) return authError("auth/email-already-in-use", msg);
  if (/reauthenticat/i.test(msg)) return authError("auth/requires-recent-login", msg);
  if (/password should be|weak password/i.test(msg)) return authError("auth/weak-password", msg);
  if (/anonymous sign-ins are disabled|signups not allowed|not enabled/i.test(msg)) return authError("auth/operation-not-allowed", msg);
  if (status === 429 || /rate limit|too many/i.test(msg)) return authError("auth/too-many-requests", msg);
  if (/fetch|network/i.test(msg)) return authError("auth/network-request-failed", msg);
  return authError("auth/internal-error", msg);
}

function toUser(u, client) {
  if (!u) return null;
  return {
    uid: u.id,
    email: u.email || null,
    isAnonymous: !!u.is_anonymous,
    displayName: u.user_metadata?.name || null,
    emailVerified: !!u.email_confirmed_at,
    metadata: { creationTime: u.created_at, lastSignInTime: u.last_sign_in_at },
    providerData: [],
    userMetadata: u.user_metadata || {},
    async getIdToken() {
      const { data } = await client.auth.getSession();
      return data.session?.access_token || null;
    },
  };
}

function makeAuth(client) {
  const listeners = new Set();
  const auth = { currentUser: null, _client: client, _ready: false, _listeners: listeners };
  let lastUid;

  client.auth.onAuthStateChange((event, session) => {
    const user = toUser(session?.user, client);
    const uid = user?.uid || null;
    const changed = uid !== lastUid;
    auth.currentUser = user;
    lastUid = uid;
    const first = !auth._ready;
    auth._ready = true;
    // Firebase só avisa em entrada/saída — renovação de token não dispara o callback
    if (first || changed) {
      // setTimeout: o Supabase não permite chamar a API dentro deste callback
      listeners.forEach((cb) => setTimeout(() => cb(user), 0));
    }
  });

  return auth;
}

const defaultAuth = makeAuth(supabase);
const secondaryAuths = new Map();

export function getAuth(app) {
  if (!app || app.name === "[DEFAULT]") return defaultAuth;
  if (!secondaryAuths.has(app.name)) secondaryAuths.set(app.name, makeAuth(createIsolatedClient()));
  return secondaryAuths.get(app.name);
}

export function onAuthStateChanged(auth, next, error) {
  const cb = typeof next === "function" ? next : next?.next;
  if (typeof cb !== "function") return () => {};
  auth._listeners.add(cb);
  // Quem se inscreve depois da sessão inicial recebe o estado atual, como no Firebase
  if (auth._ready) setTimeout(() => cb(auth.currentUser), 0);
  return () => auth._listeners.delete(cb);
}

export async function signInWithEmailAndPassword(auth, email, password) {
  const { data, error } = await auth._client.auth.signInWithPassword({ email: String(email || "").trim(), password });
  if (error) throw mapError(error);
  auth.currentUser = toUser(data.user, auth._client);
  return { user: auth.currentUser };
}

export async function signInAnonymously(auth) {
  // Como no Firebase: se já existe um visitante logado, reaproveita em vez de criar outro
  const { data: atual } = await auth._client.auth.getSession();
  if (atual.session?.user?.is_anonymous) {
    auth.currentUser = toUser(atual.session.user, auth._client);
    return { user: auth.currentUser };
  }
  const { data, error } = await auth._client.auth.signInAnonymously();
  if (error) throw mapError(error);
  auth.currentUser = toUser(data.user, auth._client);
  return { user: auth.currentUser };
}

export async function createUserWithEmailAndPassword(auth, email, password) {
  // Conta criada pelo admin começa com senha provisória: o usuário troca no primeiro acesso
  const { data, error } = await auth._client.auth.signUp({
    email: String(email || "").trim(),
    password,
    options: { data: { must_change_password: true } },
  });
  if (error) throw mapError(error);
  if (!data.user) throw authError("auth/internal-error", "Usuário não criado");
  auth.currentUser = toUser(data.user, auth._client);
  return { user: auth.currentUser };
}

export async function signOut(auth) {
  const { error } = await auth._client.auth.signOut();
  if (error) throw mapError(error);
  auth.currentUser = null;
}

export async function sendPasswordResetEmail(auth, email) {
  const redirectTo = typeof window !== "undefined" ? window.location.origin + window.location.pathname : undefined;
  const { error } = await auth._client.auth.resetPasswordForEmail(String(email || "").trim(), { redirectTo });
  if (error) throw mapError(error);
}

export async function updatePassword(user, newPassword) {
  const { error } = await supabase.auth.updateUser({ password: newPassword, data: { must_change_password: false } });
  if (error) throw mapError(error);
}

export async function signInWithCustomToken() {
  throw authError("auth/operation-not-allowed", "Custom token não é suportado no Supabase");
}

// Persistência é gerenciada pelo Supabase (localStorage)
export async function setPersistence() {}
export const browserLocalPersistence = { type: "LOCAL" };
export const browserSessionPersistence = { type: "SESSION" };
export const indexedDBLocalPersistence = { type: "LOCAL" };
export const inMemoryPersistence = { type: "NONE" };
