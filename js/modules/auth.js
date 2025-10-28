// js/modules/auth.js
import {
    signInAnonymously,
    signInWithCustomToken,
    onAuthStateChanged,
    signOut,
    signInWithEmailAndPassword,
    // createUserWithEmailAndPassword // Não usado, removido para simplificar
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
// CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
import { DOM_ELEMENTS, showAlert, updateLastUpdateTime, switchTab, renderPermissionsUI } from "../utils/dom-helpers.js";
import { setUnidades, setAguaMovimentacoes, setGasMovimentacoes, setMateriais, setEstoqueAgua, setEstoqueGas, setEstoqueInicialDefinido, setUserRole } from "../utils/cache.js";
// ADICIONADO: Importar a função de logout do novo módulo de usuários
import { onUserLogout } from "./usuarios.js";

// Variável de estado local para o módulo
let isAuthReady = false;
let userId = null;
let unsubscribeListeners = []; // Array para guardar todos os unsubscribers do Firestore

function getUserId() { return userId; }
function isReady() { return isAuthReady; }

// =========================================================================
// LÓGICA DE ROLES
// =========================================================================

/**
 * Obtém o role do usuário no Firestore.
 * Se for o primeiro login, define como 'anon' por padrão.
 * @param {Object} user Objeto User do Firebase Auth.
 * @returns {Promise<string>} O role do usuário ('anon', 'editor', 'admin', 'unauthenticated').
 */
async function getUserRoleFromFirestore(user) { // MODIFICADO: Recebe o objeto 'user'
    if (!user) return 'unauthenticated';

    const uid = user.uid;
    const isAnonymous = user.isAnonymous;

    if (isAnonymous) return 'anon';

    // Se a coleção userRoles não estiver definida (erro inicial), retorna 'anon' como segurança
    if (!COLLECTIONS.userRoles) {
        console.error("Coleção 'userRoles' não está definida em COLLECTIONS.");
        return 'anon'; // Fallback seguro
    }

    const roleRef = doc(COLLECTIONS.userRoles, uid);
    try {
        const roleDoc = await getDoc(roleRef);

        if (roleDoc.exists()) {
            const role = roleDoc.data().role;
            // Garante um dos roles válidos
            return ['admin', 'editor', 'anon'].includes(role) ? role : 'anon'; // Fallback para anon se role inválido
        } else {
            // Primeiro login por email/senha. Define como 'anon' por padrão
            const defaultRole = 'anon'; // MODIFICADO: de 'editor' para 'anon'
            await setDoc(roleRef, {
                role: defaultRole,
                uid: uid,
                email: user.email, // ADICIONADO: Salva o e-mail para a gestão
                createdAt: serverTimestamp()
            });
            console.log(`Novo usuário ${user.email} registrado com role padrão: ${defaultRole}`);
            return defaultRole;
        }
    } catch (error) {
        console.error("Erro ao buscar/definir role do usuário:", error);
        return 'anon'; // Fallback seguro em caso de erro no Firestore
    }
}

// =========================================================================
// LÓGICA DE AUTENTICAÇÃO
// =========================================================================

/**
 * Faz o login com Email e Senha.
 */
async function signInEmailPassword(email, password) {
     if (!auth) return;
     try {
         const userCredential = await signInWithEmailAndPassword(auth, email, password);
         showAlert('alert-login', `Bem-vindo(a), ${userCredential.user.email}!`, 'success');

         // Fecha o modal após sucesso (o onAuthStateChanged trata o restante)
         // CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
         if (DOM_ELEMENTS.authModal) DOM_ELEMENTS.authModal.style.display = 'none';

     } catch (error) {
         console.error("Erro no login:", error);
         let message = "Erro ao fazer login. Verifique suas credenciais.";
         if (error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password' || error.code === 'auth/invalid-credential') { // Adicionado invalid-credential
             message = "E-mail ou senha incorretos.";
         } else if (error.code === 'auth/invalid-email') {
             message = "Formato de e-mail inválido.";
         }
         showAlert('alert-login', message, 'error');
         throw error;
     }
}

/**
 * Tenta o login anônimo.
 */
async function signInAnonUser() {
    if (!auth) return;
    try {
        await signInAnonymously(auth);
        showAlert('alert-login', `Acesso Anônimo concedido.`, 'success');
        // CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
        if (DOM_ELEMENTS.authModal) DOM_ELEMENTS.authModal.style.display = 'none';
    } catch (error) {
         console.error("Erro no login anônimo:", error);
         showAlert('alert-login', `Erro ao tentar acesso anônimo: ${error.message}`, 'error');
         throw error; // Propagar erro para o app.js desabilitar o spinner
    }
}

/**
 * Desloga o usuário atual.
 */
async function signOutUser() {
    if (!auth) return;
    try {
        await signOut(auth);
        console.log("Usuário deslogado com sucesso.");
        // ADICIONADO: Notifica o módulo de usuários para parar os listeners
        onUserLogout();
        // O onAuthStateChanged cuidará da UI
        switchTab('dashboard'); // Volta para o dashboard
    } catch (error) {
        console.error("Erro ao fazer logout:", error);
    }
}


/**
 * Inicia os listeners de real-time do Firestore.
 */
function initFirestoreListeners(renderDashboardCallback, renderControlsCallback, renderUIModuleCallback) {
    if (!isAuthReady) {
        console.warn("Firestore listeners não iniciados: Auth não pronto.");
        return;
    }
    // Limpa listeners antigos antes de iniciar novos
    unsubscribeFirestoreListeners();
    console.log("Iniciando listeners do Firestore...");

    // Listener de Unidades
    const qUnidades = query(COLLECTIONS.unidades);
    const unsubUnidades = onSnapshot(qUnidades, (snapshot) => {
        const unidades = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })).sort((a, b) => (a.nome || '').localeCompare(b.nome || ''));
        setUnidades(unidades);
        console.log("Unidades recebidas:", unidades.length);
        renderControlsCallback();
        renderUIModuleCallback();
        renderPermissionsUI(); // Reaplicar permissões ao carregar unidades
    }, (error) => { console.error("Erro no listener de unidades:", error); showAlert('alert-gestao', `Erro ao carregar unidades: ${error.message}`, 'error'); });
    unsubscribeListeners.push(unsubUnidades);

    // Listener de Movimentações de Água
    const qAgua = query(COLLECTIONS.aguaMov);
    const unsubAgua = onSnapshot(qAgua, (snapshot) => {
        const movs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setAguaMovimentacoes(movs);
        console.log("Mov. Água recebidas:", movs.length);
        renderDashboardCallback();
        renderUIModuleCallback();
    }, (error) => { console.error("Erro no listener de água:", error); showAlert('alert-agua-lista', `Erro ao carregar dados de água: ${error.message}`, 'error'); });
    unsubscribeListeners.push(unsubAgua);

    // Listener de Movimentações de Gás
    const qGas = query(COLLECTIONS.gasMov);
    const unsubGas = onSnapshot(qGas, (snapshot) => {
        const movs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setGasMovimentacoes(movs);
        console.log("Mov. Gás recebidas:", movs.length);
        renderDashboardCallback();
        renderUIModuleCallback();
    }, (error) => { console.error("Erro no listener de gás:", error); showAlert('alert-gas-lista', `Erro ao carregar dados de gás: ${error.message}`, 'error'); });
    unsubscribeListeners.push(unsubGas);

    // Listener de Materiais
    const qMateriais = query(COLLECTIONS.materiais);
    const unsubMateriais = onSnapshot(qMateriais, (snapshot) => {
        const materiais = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setMateriais(materiais);
        console.log("Materiais recebidos:", materiais.length);
        renderDashboardCallback();
        renderUIModuleCallback();
    }, (error) => { console.error("Erro no listener de materiais:", error); showAlert('alert-materiais', `Erro ao carregar materiais: ${error.message}`, 'error'); }); // Corrigido alertId
    unsubscribeListeners.push(unsubMateriais);

    // Listener de Estoque de Água
    const qEstoqueAgua = query(COLLECTIONS.estoqueAgua);
    const unsubEstoqueAgua = onSnapshot(qEstoqueAgua, (snapshot) => {
        const estoque = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setEstoqueAgua(estoque);
        const inicialDefinido = estoque.some(e => e.tipo === 'inicial');
        setEstoqueInicialDefinido('agua', inicialDefinido);
        console.log("Estoque Água recebido:", estoque.length, "Inicial definido:", inicialDefinido);
        renderUIModuleCallback();
        renderDashboardCallback();
    }, (error) => { console.error("Erro no listener de estoque água:", error); });
    unsubscribeListeners.push(unsubEstoqueAgua);

    // Listener de Estoque de Gás
    const qEstoqueGas = query(COLLECTIONS.estoqueGas);
    const unsubEstoqueGas = onSnapshot(qEstoqueGas, (snapshot) => {
        const estoque = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setEstoqueGas(estoque);
        const inicialDefinido = estoque.some(e => e.tipo === 'inicial');
        setEstoqueInicialDefinido('gas', inicialDefinido);
        console.log("Estoque Gás recebido:", estoque.length, "Inicial definido:", inicialDefinido);
        renderUIModuleCallback();
        renderDashboardCallback();
    }, (error) => { console.error("Erro no listener de estoque gás:", error); });
    unsubscribeListeners.push(unsubEstoqueGas);
}

/**
 * Para todos os listeners de real-time do Firestore.
 */
function unsubscribeFirestoreListeners() {
    if (unsubscribeListeners.length > 0) {
        console.log(`Parando ${unsubscribeListeners.length} listeners do Firestore...`);
        unsubscribeListeners.forEach(unsubscribe => unsubscribe());
        unsubscribeListeners = []; // Limpa o array
    }
}


/**
 * Inicializa a autenticação e configura o listener de estado.
 */
async function initAuthAndListeners(renderDashboardCallback, renderControlsCallback, renderUIModuleCallback) {
    if (!auth) {
        console.error("Auth não inicializado. Verifique firestore-service.");
        return;
    }

    // CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
    if (DOM_ELEMENTS.connectionStatusEl) {
         DOM_ELEMENTS.connectionStatusEl.innerHTML = `<span class="h-3 w-3 bg-yellow-400 rounded-full animate-pulse"></span> <span>Autenticando...</span>`;
    }

    // O modal só é exibido se não houver um token customizado (Ambiente Canvas) e não houver usuário logado
    if (!initialAuthToken && !auth.currentUser && DOM_ELEMENTS.authModal) { // Adicionado !auth.currentUser
         DOM_ELEMENTS.authModal.style.display = 'flex';
         if (typeof lucide !== 'undefined' && typeof lucide.createIcons === 'function') { lucide.createIcons(); }
    }


    onAuthStateChanged(auth, async (user) => {
        if (user) {
            isAuthReady = true;
            userId = user.uid;

            // 1. OBTÉM O ROLE DO USUÁRIO
            // MODIFICADO: Passa o objeto 'user' inteiro
            const role = await getUserRoleFromFirestore(user);
            setUserRole(role);
            console.log(`Autenticado com UID: ${userId}, Role: ${role}`);

            // Atualiza o display do e-mail e role no cabeçalho
            const email = user?.email || (user?.isAnonymous ? 'Anônimo' : 'N/A');
            // CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
            if (DOM_ELEMENTS.userEmailDisplayEl) DOM_ELEMENTS.userEmailDisplayEl.textContent = email;
            // CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
             if (DOM_ELEMENTS.userRoleDisplayEl) { // Exibe o role no header
                DOM_ELEMENTS.userRoleDisplayEl.textContent = role.charAt(0).toUpperCase() + role.slice(1);
                DOM_ELEMENTS.userRoleDisplayEl.className = `user-role-display text-xs font-semibold px-2 py-0.5 rounded-full ${role === 'admin' ? 'bg-red-200 text-red-800' : (role === 'editor' ? 'bg-blue-200 text-blue-800' : 'bg-gray-200 text-gray-800')}`;
             }

            // CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
            if (DOM_ELEMENTS.connectionStatusEl) DOM_ELEMENTS.connectionStatusEl.innerHTML = `<span class="h-3 w-3 bg-green-500 rounded-full"></span> <span class="text-green-700">Conectado (${role})</span>`;

            // 2. Inicia os Listeners e Renderiza a UI (apenas se estiver realmente logado)
            if (role !== 'unauthenticated') {
                // Remove o wrapper hidden do conteúdo principal
                // CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
                if (DOM_ELEMENTS.appContentWrapper) DOM_ELEMENTS.appContentWrapper.classList.remove('hidden');
                 // Esconde o modal de login se ainda estiver visível
                 // CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
                if (DOM_ELEMENTS.authModal) DOM_ELEMENTS.authModal.style.display = 'none';

                initFirestoreListeners(renderDashboardCallback, renderControlsCallback, renderUIModuleCallback);

                // Renderização inicial
                updateLastUpdateTime();
                // Força a renderização inicial do Dashboard, pois o switchTab pode não ser chamado se já estiver ativo
                renderDashboardCallback();
                renderPermissionsUI(); // Aplica as permissões após definir o role

            }

        } else {
            isAuthReady = false;
            userId = null;
            setUserRole('unauthenticated'); // Limpa o role
            console.log("Usuário deslogado. Aguardando login.");

            // ADICIONADO: Limpa o cache de usuários ao deslogar
            onUserLogout();
            // ADICIONADO: Para todos os listeners do Firestore ao deslogar
            unsubscribeFirestoreListeners();

            // CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
            if (DOM_ELEMENTS.connectionStatusEl) DOM_ELEMENTS.connectionStatusEl.innerHTML = `<span class="h-3 w-3 bg-red-500 rounded-full"></span> <span class="text-red-700">Desconectado</span>`;

            // Oculta o conteúdo e mostra o modal de login, se não for ambiente Canvas
            // CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
            if (DOM_ELEMENTS.appContentWrapper) DOM_ELEMENTS.appContentWrapper.classList.add('hidden');
            if (!initialAuthToken && DOM_ELEMENTS.authModal) {
                 DOM_ELEMENTS.authModal.style.display = 'flex';
                 // Garante que os ícones do modal sejam renderizados
                 if (typeof lucide !== 'undefined' && typeof lucide.createIcons === 'function') {
                    setTimeout(() => lucide.createIcons(), 50); // Pequeno delay
                 }
            }

            renderPermissionsUI(); // Limpa a UI de acordo com o role 'unauthenticated'
        }
    });

    // Tenta o login automático (Custom Token) se houver
    try {
        if (initialAuthToken && !auth.currentUser) { // Adicionado !auth.currentUser para evitar re-login desnecessário
            console.log("Tentando login com Custom Token...");
            await signInWithCustomToken(auth, initialAuthToken);
        }
        // Se não houver Custom Token, o onAuthStateChanged e o modal cuidam.
    } catch (error) {
        console.error("Erro CRÍTICO ao autenticar Firebase (Token):", error);
        // CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
         if (DOM_ELEMENTS.connectionStatusEl) DOM_ELEMENTS.connectionStatusEl.innerHTML = `<span class="h-3 w-3 bg-red-500 rounded-full"></span> <span class="text-red-700">Erro Auth</span>`;
        showAlert('alert-login', `Erro crítico na autenticação: ${error.message}. Recarregue a página.`, 'error', 60000); // Mostra no modal
    }
}


// EXPORTS CORRIGIDOS: Apenas exporta as funções de utilidade e as funções que precisam ser chamadas de fora.
export {
    initAuthAndListeners,
    getUserId,
    isReady,
    signInEmailPassword,
    signOutUser,
    signInAnonUser
};

