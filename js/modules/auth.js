// js/modules/auth.js
console.info("[AUTH] auth.js v11-hotfix carregado");
import {
    signInAnonymously,
    signInWithCustomToken,
    onAuthStateChanged,
    signOut,
    signInWithEmailAndPassword,
    setPersistence,
    browserLocalPersistence,
    indexedDBLocalPersistence,
    browserSessionPersistence,
    sendPasswordResetEmail
} from "firebase/auth";
import {
    onSnapshot,
    query,
    orderBy,
    limit,
    getDoc,
    doc
} from "firebase/firestore";

import { initialAuthToken } from "../firebase-config.js";
import { auth, COLLECTIONS, ensureCollectionsWithData, getLegacyCollections, getPrimaryCollections } from "../services/firestore-service.js";
import {
    DOM_ELEMENTS,
    showAlert,
    updateLastUpdateTime,
    switchTab,
    renderPermissionsUI
} from "../utils/dom-helpers.js";
import {
    setUnidades,
    setAguaMovimentacoes,
    setGasMovimentacoes,
    setMateriais,
    setEstoqueAgua,
    setEstoqueGas,
    setCestaMovimentacoes,
    setCestaEstoque,
    setEnxovalMovimentacoes,
    setEnxovalEstoque,
    setEstoqueInicialDefinido,
    setSemcasHistDB,
    setSemcasAliases,
    setUserRole
} from "../utils/cache.js";
import { onUserLogout } from "./usuarios.js";

// =======================================================================
// VARIÁVEIS DE ESTADO
// =======================================================================
let isAuthReady = false;
let userId = null;
let unsubscribeListeners = [];
let transitioning = false;
let __persistenceWarned = false;
let __renderQueueTimer = null;
let __renderFlags = { dash: false, controls: false, modules: false, permissions: false };

// Callbacks globais para re-uso na reconexão
let _globalRenderDash = null;
let _globalRenderControls = null;
let _globalRenderModules = null;

// =======================================================================
// UTILITÁRIOS
// =======================================================================
function getUserId() { return userId; }
function isReady() { return isAuthReady; }

function shouldRenderDashboardNow() {
    try {
        if (document.body?.classList?.contains('tv-mode')) return true;
        const dashboardPane = document.getElementById('content-dashboard');
        const inicioPane = document.getElementById('content-inicio');
        if (dashboardPane && !dashboardPane.classList.contains('hidden')) return true;
        if (inicioPane && !inicioPane.classList.contains('hidden')) return true;
        return false;
    } catch (_) {
        return false;
    }
}

function scheduleRenders({ dash = false, controls = false, modules = false, permissions = false }, renderDash, renderControls, renderModules) {
    __renderFlags.dash ||= dash;
    __renderFlags.controls ||= controls;
    __renderFlags.modules ||= modules;
    __renderFlags.permissions ||= permissions;

    if (__renderQueueTimer) return;
    __renderQueueTimer = setTimeout(() => {
        const flags = __renderFlags;
        __renderFlags = { dash: false, controls: false, modules: false, permissions: false };
        __renderQueueTimer = null;

        try { if (flags.controls && typeof renderControls === 'function') renderControls(); } catch (e) { console.error(e); }
        try { if (flags.permissions) renderPermissionsUI(); } catch (e) { console.error(e); }
        try { if (flags.modules && typeof renderModules === 'function') renderModules(); } catch (e) { console.error(e); }
        try {
            if (flags.dash && typeof renderDash === 'function' && shouldRenderDashboardNow()) {
                renderDash();
            }
        } catch (e) { console.error(e); }
    }, 80);
}

async function ensureBestAuthPersistence() {
    const candidates = [
        indexedDBLocalPersistence,
        browserLocalPersistence,
        browserSessionPersistence
    ];
    for (const persistence of candidates) {
        try {
            await setPersistence(auth, persistence);
            return true;
        } catch (_) {}
    }
    return false;
}

async function getUserRoleFromFirestore(user) {
    if (!user) return 'unauthenticated';
    if (user.isAnonymous) return 'anon';
    try {
        const primary = getPrimaryCollections?.();
        const legacy = getLegacyCollections?.();
        const candidates = [primary?.userRoles, legacy?.userRoles].filter(Boolean);
        const found = [];
        for (const col of candidates) {
            const ref = doc(col, user.uid);
            const snap = await getDoc(ref);
            if (!snap.exists()) continue;
            const role = snap.data().role;
            if (['admin', 'editor', 'anon'].includes(role)) found.push(role);
        }
        if (found.includes('admin')) return 'admin';
        if (found.includes('editor')) return 'editor';
        return 'anon';
    } catch (err) {
        console.error("Erro ao obter role:", err);
        return 'anon';
    }
}

// =======================================================================
// LOGIN E LOGOUT
// =======================================================================
async function signInEmailPassword(email, password) {
    try {
        await ensureBestAuthPersistence();
        const credential = await signInWithEmailAndPassword(auth, email, password);
        showAlert('alert-login', `Bem-vindo(a), ${credential.user.email}!`, 'success');
        if (DOM_ELEMENTS.authModal) DOM_ELEMENTS.authModal.style.display = 'none';
    } catch (err) {
        console.error("Erro login:", err);
        let msg = "Não foi possível fazer login.";
        if (['auth/user-not-found', 'auth/wrong-password', 'auth/invalid-credential'].includes(err.code)) {
            msg = "E-mail ou senha incorretos. Se for seu primeiro acesso ou não lembrar a senha, clique em “Esqueci minha senha”.";
        }
        if (err.code === 'auth/invalid-email') msg = "Formato de e-mail inválido.";
        if (err.code === 'auth/too-many-requests') msg = "Muitas tentativas. Aguarde alguns minutos e tente novamente.";
        if (err.code === 'auth/network-request-failed') msg = "Falha de rede. Verifique sua conexão e tente novamente.";
        if (err.code === 'auth/operation-not-allowed') msg = "Login por e-mail/senha não está habilitado no Firebase Authentication.";
        showAlert('alert-login', msg, 'error');
        throw err;
    }
}

async function sendResetPassword(email) {
    if (!email) {
        showAlert('alert-login', 'Informe o e-mail para redefinir a senha.', 'warning');
        return;
    }
    try {
        await sendPasswordResetEmail(auth, email);
        showAlert('alert-login', 'Se o e-mail estiver cadastrado, você receberá um link para redefinir a senha.', 'success');
    } catch (err) {
        console.error('Erro reset senha:', err);
        let msg = 'Não foi possível enviar o e-mail de redefinição.';
        if (err.code === 'auth/invalid-email') msg = 'Formato de e-mail inválido.';
        if (err.code === 'auth/too-many-requests') msg = 'Muitas solicitações. Aguarde alguns minutos e tente novamente.';
        if (err.code === 'auth/network-request-failed') msg = 'Falha de rede. Verifique sua conexão e tente novamente.';
        showAlert('alert-login', msg, 'error');
    }
}

async function signInAnonUser() {
    try {
        await ensureBestAuthPersistence();
        await signInAnonymously(auth);
        showAlert('alert-login', `Acesso Anônimo concedido.`, 'success');
        if (DOM_ELEMENTS.authModal) DOM_ELEMENTS.authModal.style.display = 'none';
    } catch (err) {
        console.error("Erro login anônimo:", err);
        showAlert('alert-login', `Erro ao tentar acesso anônimo: ${err.message}`, 'error');
    }
}

async function signOutUser() {
    try {
        await signOut(auth);
        onUserLogout();
        switchTab('inicio');
        console.log("Usuário deslogado com sucesso.");
    } catch (err) {
        console.error("Erro logout:", err);
    }
}

// =======================================================================
// FIRESTORE LISTENERS
// =======================================================================
function unsubscribeFirestoreListeners() {
    if (unsubscribeListeners.length > 0) {
        console.log(`Parando ${unsubscribeListeners.length} listeners do Firestore...`);
        unsubscribeListeners.forEach(fn => fn());
        unsubscribeListeners = [];
    }
}

async function initFirestoreListeners(renderDash, renderControls, renderModules) {
    unsubscribeFirestoreListeners();
    console.log("Iniciando listeners do Firestore...");

    // Armazena referências globais para reconexão
    _globalRenderDash = renderDash;
    _globalRenderControls = renderControls;
    _globalRenderModules = renderModules;

    await ensureCollectionsWithData();

    let gotAnySnapshot = false;
    let lastListenerError = null;

    const addListener = (q, cb) => {
        const unsub = onSnapshot(
            q,
            snap => {
                gotAnySnapshot = true;
                cb(snap);
            },
            err => {
                lastListenerError = err;
                const code = String(err?.code || '').toLowerCase();
                const msg = String(err?.message || '').toLowerCase();

                if (code === 'unavailable' || msg.includes('aborted') || msg.includes('network request failed')) {
                    console.warn("Conexão com Firestore perdida temporariamente.");
                    try { showAlert('connectionStatus', 'Conexão instável. Tentando reconectar…', 'warning', 6000); } catch (_) {}
                    return;
                }

                if (code === 'permission-denied' || msg.includes('missing or insufficient permissions')) {
                    try { showAlert('alert-login', 'Sem permissão para ler os dados (' + q.type + ').', 'error', 10000); } catch (_) {}
                    try {
                        if (DOM_ELEMENTS.appContentWrapper) DOM_ELEMENTS.appContentWrapper.classList.add('hidden');
                        if (DOM_ELEMENTS.authModal) DOM_ELEMENTS.authModal.style.display = 'flex';
                    } catch (_) {}
                    console.error("Erro no listener Firestore (permission-denied):", err, "Query:", q);
                    return;
                }

                if (code === 'failed-precondition' && msg.includes('index')) {
                    try { showAlert('connectionStatus', 'Consulta do Firestore precisa de índice. Verifique o console para o link de criação.', 'warning', 10000); } catch (_) {}
                }

                console.error("Erro no listener Firestore:", err);
            }
        );
        unsubscribeListeners.push(unsub);
    };

    // Unidades
    addListener(query(COLLECTIONS.unidades), snap => {
        const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        setUnidades(data);
        scheduleRenders({ controls: true, modules: true, permissions: true }, renderDash, renderControls, renderModules);
    });

    // Água (sem limit — o cálculo de estoque precisa de TODAS as movimentações)
    // Com persistência offline, apenas deltas são lidos após o 1º load.
    addListener(query(COLLECTIONS.aguaMov, orderBy("registradoEm", "desc")), snap => {
        const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        setAguaMovimentacoes(data);
        scheduleRenders({ dash: true, modules: true }, renderDash, renderControls, renderModules);
    });

    // Gás (sem limit — mesmo motivo que Água: cálculo de estoque precisa de tudo)
    addListener(query(COLLECTIONS.gasMov, orderBy("registradoEm", "desc")), snap => {
        const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        setGasMovimentacoes(data);
        scheduleRenders({ dash: true, modules: true }, renderDash, renderControls, renderModules);
    });

    // Materiais
    addListener(query(COLLECTIONS.materiais, orderBy("registradoEm", "desc"), limit(500)), snap => {
        const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        try { console.info("[FM] materiais listener:", data.length, "docs"); } catch (_) {}
        setMateriais(data);
        scheduleRenders({ dash: true, modules: true }, renderDash, renderControls, renderModules);
    });

    // Estoques
    addListener(query(COLLECTIONS.estoqueAgua), snap => {
        const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        setEstoqueAgua(data);
        const inicial = data.some(e => e.tipo === 'inicial');
        setEstoqueInicialDefinido('agua', inicial);
        scheduleRenders({ dash: true, modules: true }, renderDash, renderControls, renderModules);
    });

    addListener(query(COLLECTIONS.estoqueGas), snap => {
        const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        setEstoqueGas(data);
        const inicial = data.some(e => e.tipo === 'inicial');
        setEstoqueInicialDefinido('gas', inicial);
        scheduleRenders({ dash: true, modules: true }, renderDash, renderControls, renderModules);
    });

    // Assistência Social (limits menores — módulos secundários)
    addListener(query(COLLECTIONS.cestaMov, orderBy("registradoEm", "desc"), limit(200)), snap => {
        const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        setCestaMovimentacoes(data);
        scheduleRenders({ modules: true }, renderDash, renderControls, renderModules);
    });

    addListener(query(COLLECTIONS.cestaEstoque), snap => {
        const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        setCestaEstoque(data);
        scheduleRenders({ modules: true }, renderDash, renderControls, renderModules);
    });

    addListener(query(COLLECTIONS.enxovalMov, orderBy("registradoEm", "desc"), limit(200)), snap => {
        const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        setEnxovalMovimentacoes(data);
        scheduleRenders({ modules: true }, renderDash, renderControls, renderModules);
    });

    addListener(query(COLLECTIONS.enxovalEstoque), snap => {
        const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        setEnxovalEstoque(data);
        scheduleRenders({ modules: true }, renderDash, renderControls, renderModules);
    });

    addListener(query(COLLECTIONS.semcasHistDB, orderBy("weekStart", "desc"), limit(200)), snap => {
        const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        try { console.info("[FM] semcasHistDB listener (economico):", data.length, "docs"); } catch (_) {}
        setSemcasHistDB(data);
        window.__semcasHistDB = data;
        window.__semcasHistDBAt = Date.now();
        window.__semcasHistDBPartial = true;
        scheduleRenders({ modules: true }, renderDash, renderControls, renderModules);
    });

    addListener(query(COLLECTIONS.semcasAliases), snap => {
        const config = snap.docs.find(d => d.id === "config")?.data() || {};
        const aliases = config.aliases || {};
        setSemcasAliases(aliases);
        window.__semcasAliases = aliases;
        scheduleRenders({ modules: true }, renderDash, renderControls, renderModules);
    });

    setTimeout(() => {
        try {
            if (gotAnySnapshot) return;
            if (lastListenerError) {
                showAlert('connectionStatus', 'Não foi possível carregar os dados do banco. Verifique sua conexão/permissões.', 'error', 10000);
                return;
            }
            showAlert('connectionStatus', 'Carregando dados do banco…', 'info', 8000);
        } catch (_) {}
    }, 4000);
}

// Reconexão: O Firebase com persistência offline (IndexedDB) já gerencia
// a reconexão automaticamente. NÃO reiniciamos os listeners aqui para
// evitar re-leitura completa de todas as coleções a cada oscilação de rede.
window.addEventListener('online', () => {
    console.log("🔄 Conexão de rede restabelecida. O Firebase reconectará automaticamente.");
    if (auth.currentUser) {
        showAlert('connectionStatus', 'Conexão restabelecida.', 'success', 3000);
    }
});

// =======================================================================
// AUTH STATE HANDLER
// =======================================================================
async function initAuthAndListeners(renderDash, renderControls, renderModules) {
    try { await ensureBestAuthPersistence(); } catch (_) {}

    if (window.authInitialized) return;
    window.authInitialized = true;

    onAuthStateChanged(auth, async (user) => {
        if (transitioning) return;

        if (user) {
            transitioning = true;
            isAuthReady = true;
            userId = user.uid;
            
            // Tenta obter role, fallback para anon se der erro
            let role = 'anon';
            try {
                role = await getUserRoleFromFirestore(user);
            } catch (e) { console.warn("Erro ao obter role, usando anon:", e); }
            setUserRole(role);

            console.log(`✅ Autenticado com UID: ${userId}, Role: ${role}`);
            if (DOM_ELEMENTS.userEmailDisplayEl) DOM_ELEMENTS.userEmailDisplayEl.textContent = user.email || 'Usuário';
            if (DOM_ELEMENTS.authModal) DOM_ELEMENTS.authModal.style.display = 'none';
            if (DOM_ELEMENTS.appContentWrapper) {
                DOM_ELEMENTS.appContentWrapper.classList.remove('hidden');
                DOM_ELEMENTS.appContentWrapper.style.display = '';
            }

            unsubscribeFirestoreListeners();
            
            // Sempre tenta iniciar os listeners, mesmo se o navegador achar que está offline (pode ser falso positivo)
            await initFirestoreListeners(renderDash, renderControls, renderModules);

            renderPermissionsUI();
            if (typeof renderDash === 'function' && shouldRenderDashboardNow()) renderDash();
            updateLastUpdateTime();

            setTimeout(() => transitioning = false, 400);
        } else {
            if (transitioning) return;
            isAuthReady = false;
            userId = null;
            setUserRole('unauthenticated');
            console.log("⚠️ Usuário deslogado. Aguardando login.");

            onUserLogout();
            unsubscribeFirestoreListeners();
            if (DOM_ELEMENTS.appContentWrapper)
                DOM_ELEMENTS.appContentWrapper.classList.add('hidden');
            if (DOM_ELEMENTS.authModal)
                DOM_ELEMENTS.authModal.style.display = 'flex';

            renderPermissionsUI();

            if (!__persistenceWarned) {
                __persistenceWarned = true;
                const ok = await ensureBestAuthPersistence();
                if (!ok) {
                    showAlert('alert-login', 'Seu navegador está bloqueando o armazenamento do login no preview. Use uma aba normal (não incorporada) para manter logado após atualizar.', 'warning', 10000);
                }
            }
        }
    });

    if (initialAuthToken && !auth.currentUser) {
        try {
            console.log("Tentando login com Custom Token...");
            await signInWithCustomToken(auth, initialAuthToken);
        } catch (err) {
            console.error("Erro crítico Auth:", err);
            showAlert('alert-login', `Erro na autenticação: ${err.message}`, 'error');
        }
    }
}

// =======================================================================
// EXPORTS
// =======================================================================
export {
    initAuthAndListeners,
    getUserId,
    isReady,
    signInEmailPassword,
    signOutUser,
    signInAnonUser,
    sendResetPassword
};
