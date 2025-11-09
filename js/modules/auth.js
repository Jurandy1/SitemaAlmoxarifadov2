// js/modules/auth.js
import {
    signInAnonymously,
    signInWithCustomToken,
    onAuthStateChanged,
    signOut,
    signInWithEmailAndPassword,
    setPersistence,
    browserSessionPersistence // ALTERADO: de browserLocalPersistence para browserSessionPersistence
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
    setCestaMovimentacoes, // NOVO
    setCestaEstoque, // NOVO
    setEnxovalMovimentacoes, // NOVO
    setEnxovalEstoque, // NOVO
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
        showAlert('alert-login', msg, 'error');
        throw err;
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

    const addListener = (q, cb) => {
        const unsub = onSnapshot(
            q,
            cb,
            err => {
                const msg = String(err?.message || '').toLowerCase();
                // Silencia erros de canal abortado/queda de rede no preview
                if (msg.includes('aborted') || msg.includes('network') || msg.includes('failed')) return;
                console.error(err);
            }
        );
        unsubscribeListeners.push(unsub);
    };

    addListener(query(COLLECTIONS.unidades), snap => {
        const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        setUnidades(data);
        renderControls();
        renderModules();
        renderPermissionsUI();
    });

    addListener(query(COLLECTIONS.aguaMov), snap => {
        const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        setAguaMovimentacoes(data);
        renderDash();
        renderModules();
    });

    addListener(query(COLLECTIONS.gasMov), snap => {
        const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        setGasMovimentacoes(data);
        renderDash();
        renderModules();
    });

    addListener(query(COLLECTIONS.materiais), snap => {
        const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        setMateriais(data);
        renderDash();
        renderModules();
    });

    addListener(query(COLLECTIONS.estoqueAgua), snap => {
        const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        setEstoqueAgua(data);
        const inicial = data.some(e => e.tipo === 'inicial');
        setEstoqueInicialDefinido('agua', inicial);
        renderDash();
        renderModules();
    });

    addListener(query(COLLECTIONS.estoqueGas), snap => {
        const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        setEstoqueGas(data);
        const inicial = data.some(e => e.tipo === 'inicial');
        setEstoqueInicialDefinido('gas', inicial);
        renderDash();
        renderModules();
    });

    // NOVOS LISTENERS PARA ASSISTÊNCIA SOCIAL
    addListener(query(COLLECTIONS.cestaMov), snap => {
        const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        setCestaMovimentacoes(data);
        renderModules();
    });

    addListener(query(COLLECTIONS.cestaEstoque), snap => {
        const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        setCestaEstoque(data);
        renderModules();
    });

    addListener(query(COLLECTIONS.enxovalMov), snap => {
        const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        setEnxovalMovimentacoes(data);
        renderModules();
    });

    addListener(query(COLLECTIONS.enxovalEstoque), snap => {
        const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        setEnxovalEstoque(data);
        renderModules();
    });
    // FIM NOVOS LISTENERS
}

// =======================================================================
// AUTH STATE HANDLER
// =======================================================================
async function initAuthAndListeners(renderDash, renderControls, renderModules) {
    // ALTERADO: de browserLocalPersistence para browserSessionPersistence
    // Isso força o Firebase a não usar o cache de dados local (IndexedDB),
    // que é o que provavelmente está corrompendo na Smart TV.
    // Ele ainda manterá o usuário logado durante a sessão (aba aberta).
    await setPersistence(auth, browserSessionPersistence);
    console.log("Persistência de NAVEGADOR (session) ativada. Não usará cache local de dados."); // MENSAGEM ATUALIZADA

    if (window.authInitialized) return;
    window.authInitialized = true;

    onAuthStateChanged(auth, async (user) => {
        if (transitioning) return;

        if (user) {
            transitioning = true;
            isAuthReady = true;
            userId = user.uid;
            const role = await getUserRoleFromFirestore(user);
            setUserRole(role);

            console.log(`✅ Autenticado com UID: ${userId}, Role: ${role}`);
            if (DOM_ELEMENTS.userEmailDisplayEl) DOM_ELEMENTS.userEmailDisplayEl.textContent = user.email || 'Usuário';

            unsubscribeFirestoreListeners();
            // Evita iniciar listeners se estiver offline (preview/local sem rede)
            if (!navigator.onLine) {
                console.warn('Offline detectado: listeners Firestore não serão iniciados até reconexão.');
            } else {
                initFirestoreListeners(renderDash, renderControls, renderModules);
            }

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
    signInAnonUser
};
