// js/modules/auth.js
import {
    signInAnonymously,
    signInWithCustomToken,
    onAuthStateChanged,
    signOut,
    signInWithEmailAndPassword,
    setPersistence,
    browserSessionPersistence,
    sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import {
    onSnapshot,
    query,
    getDoc,
    doc,
    setDoc,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

import { initialAuthToken } from "../firebase-config.js";
import { auth, COLLECTIONS } from "../services/firestore-service.js";
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

// Callbacks globais para re-uso na reconexão
let _globalRenderDash = null;
let _globalRenderControls = null;
let _globalRenderModules = null;

// =======================================================================
// UTILITÁRIOS
// =======================================================================
function getUserId() { return userId; }
function isReady() { return isAuthReady; }

async function getUserRoleFromFirestore(user) {
    if (!user) return 'unauthenticated';
    if (user.isAnonymous) return 'anon';
    const ref = doc(COLLECTIONS.userRoles, user.uid);
    try {
        const snap = await getDoc(ref);
        if (snap.exists()) {
            const role = snap.data().role;
            return ['admin', 'editor', 'anon'].includes(role) ? role : 'anon';
        } else {
            await setDoc(ref, {
                role: 'anon',
                uid: user.uid,
                email: user.email,
                createdAt: serverTimestamp()
            });
            return 'anon';
        }
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
        const credential = await signInWithEmailAndPassword(auth, email, password);
        showAlert('alert-login', `Bem-vindo(a), ${credential.user.email}!`, 'success');
        if (DOM_ELEMENTS.authModal) DOM_ELEMENTS.authModal.style.display = 'none';
    } catch (err) {
        console.error("Erro login:", err);
        let msg = "Erro ao fazer login. Verifique suas credenciais.";
        if (['auth/user-not-found', 'auth/wrong-password', 'auth/invalid-credential'].includes(err.code)) msg = "E-mail ou senha incorretos.";
        if (err.code === 'auth/invalid-email') msg = "Formato de e-mail inválido.";
        showAlert('alert-login', `${msg} (${err.code || 'erro'})`, 'error');
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
        showAlert('alert-login', 'E-mail de redefinição de senha enviado.', 'success');
    } catch (err) {
        console.error('Erro reset senha:', err);
        let msg = 'Não foi possível enviar o e-mail de redefinição.';
        if (err.code === 'auth/invalid-email') msg = 'Formato de e-mail inválido.';
        if (err.code === 'auth/user-not-found') msg = 'Usuário não encontrado.';
        showAlert('alert-login', `${msg} (${err.code || 'erro'})`, 'error');
    }
}

async function signInAnonUser() {
    try {
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
        switchTab('dashboard');
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

function initFirestoreListeners(renderDash, renderControls, renderModules) {
    unsubscribeFirestoreListeners();
    console.log("Iniciando listeners do Firestore...");

    // Armazena referências globais para reconexão
    _globalRenderDash = renderDash;
    _globalRenderControls = renderControls;
    _globalRenderModules = renderModules;

    const addListener = (q, cb) => {
        const unsub = onSnapshot(
            q,
            cb,
            err => {
                const msg = String(err?.message || '').toLowerCase();
                // Silencia erros de canal abortado/queda de rede no preview
                if (msg.includes('aborted') || msg.includes('network') || msg.includes('failed')) {
                    console.warn("Conexão com Firestore perdida temporariamente.");
                    return;
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
        if(renderControls) renderControls();
        if(renderModules) renderModules();
        renderPermissionsUI();
    });

    // Água
    addListener(query(COLLECTIONS.aguaMov), snap => {
        const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        setAguaMovimentacoes(data);
        if(renderDash) renderDash();
        if(renderModules) renderModules();
    });

    // Gás
    addListener(query(COLLECTIONS.gasMov), snap => {
        const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        setGasMovimentacoes(data);
        if(renderDash) renderDash();
        if(renderModules) renderModules();
    });

    // Materiais
    addListener(query(COLLECTIONS.materiais), snap => {
        const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        setMateriais(data);
        if(renderDash) renderDash();
        if(renderModules) renderModules();
    });

    // Estoques
    addListener(query(COLLECTIONS.estoqueAgua), snap => {
        const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        setEstoqueAgua(data);
        const inicial = data.some(e => e.tipo === 'inicial');
        setEstoqueInicialDefinido('agua', inicial);
        if(renderDash) renderDash();
        if(renderModules) renderModules();
    });

    addListener(query(COLLECTIONS.estoqueGas), snap => {
        const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        setEstoqueGas(data);
        const inicial = data.some(e => e.tipo === 'inicial');
        setEstoqueInicialDefinido('gas', inicial);
        if(renderDash) renderDash();
        if(renderModules) renderModules();
    });

    // Assistência Social
    addListener(query(COLLECTIONS.cestaMov), snap => {
        const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        setCestaMovimentacoes(data);
        if(renderModules) renderModules();
    });

    addListener(query(COLLECTIONS.cestaEstoque), snap => {
        const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        setCestaEstoque(data);
        if(renderModules) renderModules();
    });

    addListener(query(COLLECTIONS.enxovalMov), snap => {
        const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        setEnxovalMovimentacoes(data);
        if(renderModules) renderModules();
    });

    addListener(query(COLLECTIONS.enxovalEstoque), snap => {
        const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        setEnxovalEstoque(data);
        if(renderModules) renderModules();
    });
}

// Listener de Reconexão Automática
window.addEventListener('online', () => {
    console.log("🔄 Conexão de rede detectada. Tentando reconectar listeners...");
    if (auth.currentUser && _globalRenderDash) {
        setTimeout(() => {
            initFirestoreListeners(_globalRenderDash, _globalRenderControls, _globalRenderModules);
            showAlert('connectionStatus', 'Conexão restabelecida. Atualizando...', 'success', 3000);
        }, 2000); // Pequeno delay para garantir estabilidade
    }
});

// =======================================================================
// AUTH STATE HANDLER
// =======================================================================
async function initAuthAndListeners(renderDash, renderControls, renderModules) {
    await setPersistence(auth, browserSessionPersistence);
    console.log("Persistência de NAVEGADOR (session) ativada.");

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

            unsubscribeFirestoreListeners();
            
            // Sempre tenta iniciar os listeners, mesmo se o navegador achar que está offline (pode ser falso positivo)
            initFirestoreListeners(renderDash, renderControls, renderModules);

            renderPermissionsUI();
            renderDash();
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
