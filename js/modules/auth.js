// js/modules/auth.js
import {
    signInAnonymously,
    signInWithCustomToken,
    onAuthStateChanged,
    signOut,
    signInWithEmailAndPassword
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
import { auth, db, COLLECTIONS } from "../services/firestore-service.js";
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

function getUserId() { return userId; }
function isReady() { return isAuthReady; }

// =======================================================================
// LÓGICA DE ROLES
// =======================================================================
async function getUserRoleFromFirestore(user) {
    if (!user) return 'unauthenticated';
    const uid = user.uid;
    const isAnonymous = user.isAnonymous;

    if (isAnonymous) return 'anon';

    if (!COLLECTIONS.userRoles) {
        console.error("Coleção 'userRoles' não está definida.");
        return 'anon';
    }

    const roleRef = doc(COLLECTIONS.userRoles, uid);
    try {
        const roleDoc = await getDoc(roleRef);

        if (roleDoc.exists()) {
            const role = roleDoc.data().role;
            return ['admin', 'editor', 'anon'].includes(role) ? role : 'anon';
        } else {
            const defaultRole = 'anon';
            await setDoc(roleRef, {
                role: defaultRole,
                uid: uid,
                email: user.email,
                createdAt: serverTimestamp()
            });
            console.log(`Novo usuário ${user.email} registrado com role padrão: ${defaultRole}`);
            return defaultRole;
        }
    } catch (error) {
        console.error("Erro ao buscar/definir role:", error);
        return 'anon';
    }
}

// =======================================================================
// AUTENTICAÇÃO
// =======================================================================
async function signInEmailPassword(email, password) {
    if (!auth) return;
    try {
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        showAlert('alert-login', `Bem-vindo(a), ${userCredential.user.email}!`, 'success');
        if (DOM_ELEMENTS.authModal) DOM_ELEMENTS.authModal.style.display = 'none';
    } catch (error) {
        console.error("Erro no login:", error);
        let message = "Erro ao fazer login. Verifique suas credenciais.";
        if (error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password' || error.code === 'auth/invalid-credential') {
            message = "E-mail ou senha incorretos.";
        } else if (error.code === 'auth/invalid-email') {
            message = "Formato de e-mail inválido.";
        }
        showAlert('alert-login', message, 'error');
        throw error;
    }
}

async function signInAnonUser() {
    if (!auth) return;
    try {
        await signInAnonymously(auth);
        showAlert('alert-login', `Acesso Anônimo concedido.`, 'success');
        if (DOM_ELEMENTS.authModal) DOM_ELEMENTS.authModal.style.display = 'none';
    } catch (error) {
        console.error("Erro no login anônimo:", error);
        showAlert('alert-login', `Erro ao tentar acesso anônimo: ${error.message}`, 'error');
        throw error;
    }
}

async function signOutUser() {
    if (!auth) return;
    try {
        await signOut(auth);
        console.log("Usuário deslogado com sucesso.");
        onUserLogout();
        switchTab('dashboard');
    } catch (error) {
        console.error("Erro ao fazer logout:", error);
    }
}

// =======================================================================
// LISTENERS FIRESTORE
// =======================================================================
function unsubscribeFirestoreListeners() {
    if (unsubscribeListeners.length > 0) {
        console.log(`Parando ${unsubscribeListeners.length} listeners do Firestore...`);
        unsubscribeListeners.forEach(unsub => unsub());
        unsubscribeListeners = [];
    }
}

function initFirestoreListeners(renderDashboard, renderControls, renderModules) {
    if (!isAuthReady) {
        console.warn("Firestore listeners não iniciados: Auth não pronto.");
        return;
    }
    unsubscribeFirestoreListeners();
    console.log("Iniciando listeners do Firestore...");

    // Unidades
    const unsubUnidades = onSnapshot(query(COLLECTIONS.unidades), (snap) => {
        const unidades = snap.docs.map(d => ({ id: d.id, ...d.data() }))
            .sort((a, b) => (a.nome || '').localeCompare(b.nome || ''));
        setUnidades(unidades);
        console.log("Unidades recebidas:", unidades.length);
        renderControls();
        renderModules();
        renderPermissionsUI();
    });
    unsubscribeListeners.push(unsubUnidades);

    // Água
    const unsubAgua = onSnapshot(query(COLLECTIONS.aguaMov), (snap) => {
        const movs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        setAguaMovimentacoes(movs);
        console.log("Mov. Água recebidas:", movs.length);
        renderDashboard();
        renderModules();
    });
    unsubscribeListeners.push(unsubAgua);

    // Gás
    const unsubGas = onSnapshot(query(COLLECTIONS.gasMov), (snap) => {
        const movs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        setGasMovimentacoes(movs);
        console.log("Mov. Gás recebidas:", movs.length);
        renderDashboard();
        renderModules();
    });
    unsubscribeListeners.push(unsubGas);

    // Materiais
    const unsubMateriais = onSnapshot(query(COLLECTIONS.materiais), (snap) => {
        const materiais = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        setMateriais(materiais);
        console.log("Materiais recebidos:", materiais.length);
        renderDashboard();
        renderModules();
    });
    unsubscribeListeners.push(unsubMateriais);

    // Estoque Água
    const unsubEstoqueAgua = onSnapshot(query(COLLECTIONS.estoqueAgua), (snap) => {
        const estoque = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        setEstoqueAgua(estoque);
        const inicial = estoque.some(e => e.tipo === 'inicial');
        setEstoqueInicialDefinido('agua', inicial);
        console.log("Estoque Água recebido:", estoque.length, "Inicial definido:", inicial);
        renderDashboard();
        renderModules();
    });
    unsubscribeListeners.push(unsubEstoqueAgua);

    // Estoque Gás
    const unsubEstoqueGas = onSnapshot(query(COLLECTIONS.estoqueGas), (snap) => {
        const estoque = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        setEstoqueGas(estoque);
        const inicial = estoque.some(e => e.tipo === 'inicial');
        setEstoqueInicialDefinido('gas', inicial);
        console.log("Estoque Gás recebido:", estoque.length, "Inicial definido:", inicial);
        renderDashboard();
        renderModules();
    });
    unsubscribeListeners.push(unsubEstoqueGas);
}

// =======================================================================
// INICIALIZAÇÃO DO AUTH
// =======================================================================
async function initAuthAndListeners(renderDashboard, renderControls, renderModules) {
    if (!auth) {
        console.error("Auth não inicializado. Verifique firestore-service.");
        return;
    }

    if (window.authInitialized) {
        console.warn("initAuthAndListeners já foi chamado. Ignorando duplicata.");
        return;
    }
    window.authInitialized = true;

    if (DOM_ELEMENTS.connectionStatusEl)
        DOM_ELEMENTS.connectionStatusEl.innerHTML = `<span class="h-3 w-3 bg-yellow-400 rounded-full animate-pulse"></span> <span>Autenticando...</span>`;

    if (!initialAuthToken && !auth.currentUser && DOM_ELEMENTS.authModal) {
        DOM_ELEMENTS.authModal.style.display = 'flex';
        if (typeof lucide !== 'undefined' && typeof lucide.createIcons === 'function')
            lucide.createIcons();
    }

    let transitioning = false;

    onAuthStateChanged(auth, async (user) => {
        if (transitioning) return;

        if (user) {
            transitioning = true;
            isAuthReady = true;
            userId = user.uid;

            const role = await getUserRoleFromFirestore(user);
            setUserRole(role);
            console.log(`✅ Autenticado com UID: ${userId}, Role: ${role}`);

            const email = user.email || (user.isAnonymous ? 'Anônimo' : 'N/A');
            if (DOM_ELEMENTS.userEmailDisplayEl)
                DOM_ELEMENTS.userEmailDisplayEl.textContent = email;
            if (DOM_ELEMENTS.userRoleDisplayEl) {
                DOM_ELEMENTS.userRoleDisplayEl.textContent =
                    role.charAt(0).toUpperCase() + role.slice(1);
                DOM_ELEMENTS.userRoleDisplayEl.className =
                    `user-role-display text-xs font-semibold px-2 py-0.5 rounded-full ${
                        role === 'admin'
                            ? 'bg-red-200 text-red-800'
                            : role === 'editor'
                                ? 'bg-blue-200 text-blue-800'
                                : 'bg-gray-200 text-gray-800'
                    }`;
            }

            if (DOM_ELEMENTS.connectionStatusEl)
                DOM_ELEMENTS.connectionStatusEl.innerHTML =
                    `<span class="h-3 w-3 bg-green-500 rounded-full"></span> <span class="text-green-700">Conectado (${role})</span>`;

            if (DOM_ELEMENTS.appContentWrapper) DOM_ELEMENTS.appContentWrapper.classList.remove('hidden');
            if (DOM_ELEMENTS.authModal) DOM_ELEMENTS.authModal.style.display = 'none';

            unsubscribeFirestoreListeners();
            initFirestoreListeners(renderDashboard, renderControls, renderModules);

            updateLastUpdateTime();
            renderDashboard();
            renderPermissionsUI();

            setTimeout(() => { transitioning = false; }, 500);
        } else {
            if (transitioning) return;
            isAuthReady = false;
            userId = null;
            setUserRole('unauthenticated');
            console.log("⚠️ Usuário deslogado. Aguardando login.");

            onUserLogout();
            unsubscribeFirestoreListeners();

            if (DOM_ELEMENTS.connectionStatusEl)
                DOM_ELEMENTS.connectionStatusEl.innerHTML =
                    `<span class="h-3 w-3 bg-red-500 rounded-full"></span> <span class="text-red-700">Desconectado</span>`;

            if (DOM_ELEMENTS.appContentWrapper)
                DOM_ELEMENTS.appContentWrapper.classList.add('hidden');
            if (!initialAuthToken && DOM_ELEMENTS.authModal) {
                DOM_ELEMENTS.authModal.style.display = 'flex';
                if (typeof lucide !== 'undefined' && typeof lucide.createIcons === 'function')
                    setTimeout(() => lucide.createIcons(), 50);
            }

            renderPermissionsUI();
        }
    });

    try {
        if (initialAuthToken && !auth.currentUser) {
            console.log("Tentando login com Custom Token...");
            await signInWithCustomToken(auth, initialAuthToken);
        }
    } catch (error) {
        console.error("Erro CRÍTICO ao autenticar Firebase:", error);
        if (DOM_ELEMENTS.connectionStatusEl)
            DOM_ELEMENTS.connectionStatusEl.innerHTML =
                `<span class="h-3 w-3 bg-red-500 rounded-full"></span> <span class="text-red-700">Erro Auth</span>`;
        showAlert('alert-login',
            `Erro crítico na autenticação: ${error.message}. Recarregue a página.`,
            'error', 60000);
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
