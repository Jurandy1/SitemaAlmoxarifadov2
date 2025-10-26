// js/modules/auth.js
import { 
    signInAnonymously, 
    signInWithCustomToken, 
    onAuthStateChanged, 
    signOut, 
    signInWithEmailAndPassword, 
    createUserWithEmailAndPassword 
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
import { DOM_ELEMENTS, showAlert, updateLastUpdateTime, switchTab, renderPermissionsUI } from "../utils/dom-helpers.js"; 
import { setUnidades, setAguaMovimentacoes, setGasMovimentacoes, setMateriais, setEstoqueAgua, setEstoqueGas, setEstoqueInicialDefinido, setUserRole } from "../utils/cache.js"; 

// Variável de estado local para o módulo
let isAuthReady = false;
let userId = null;

function getUserId() { return userId; }
function isReady() { return isAuthReady; }

// =========================================================================
// LÓGICA DE ROLES
// =========================================================================

/**
 * Obtém o role do usuário no Firestore.
 * Se for o primeiro login, define como 'editor' por padrão (a menos que seja anônimo).
 * @param {string} uid User ID.
 * @param {boolean} isAnonymous True se for login anônimo.
 * @returns {Promise<string>} O role do usuário ('anon', 'editor', 'admin').
 */
async function getUserRoleFromFirestore(uid, isAnonymous) {
    if (isAnonymous) return 'anon';
    
    const roleRef = doc(COLLECTIONS.userRoles, uid);
    const roleDoc = await getDoc(roleRef);

    if (roleDoc.exists()) {
        const role = roleDoc.data().role;
        // Garante um dos roles válidos (anon é tratado acima)
        return ['admin', 'editor'].includes(role) ? role : 'editor'; 
    } else {
        // Primeiro login por email/senha. Define como 'editor' por padrão
        const defaultRole = 'editor';
        await setDoc(roleRef, { 
            role: defaultRole, 
            uid: uid, 
            createdAt: serverTimestamp() 
        });
        return defaultRole;
    }
}

// =========================================================================
// LÓGICA DE AUTENTICAÇÃO
// =========================================================================

/**
 * Faz o login com Email e Senha.
 */
export async function signInEmailPassword(email, password) {
     if (!auth) return;
     try {
         const userCredential = await signInWithEmailAndPassword(auth, email, password);
         showAlert('alert-login', `Bem-vindo(a), ${userCredential.user.email}!`, 'success');
         
         // Fecha o modal após sucesso (o onAuthStateChanged trata o restante)
         if (DOM_ELEMENTS.authModal) DOM_ELEMENTS.authModal.style.display = 'none';
         
     } catch (error) {
         console.error("Erro no login:", error);
         let message = "Erro ao fazer login. Credenciais inválidas ou conta não existe.";
         if (error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password') {
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
export async function signInAnonUser() {
    if (!auth) return;
    try {
        await signInAnonymously(auth);
        showAlert('alert-login', `Acesso Anônimo concedido.`, 'success');
        if (DOM_ELEMENTS.authModal) DOM_ELEMENTS.authModal.style.display = 'none';
    } catch (error) {
         console.error("Erro no login anônimo:", error);
         showAlert('alert-login', `Erro ao tentar acesso anônimo: ${error.message}`, 'error');
    }
}

/**
 * Desloga o usuário atual.
 */
export async function signOutUser() {
    if (!auth) return;
    try {
        await signOut(auth);
        console.log("Usuário deslogado com sucesso.");
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
    console.log("Iniciando listeners do Firestore..."); 

    // Listener de Unidades
    onSnapshot(query(COLLECTIONS.unidades), (snapshot) => { 
        const unidades = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })).sort((a, b) => (a.nome || '').localeCompare(b.nome || ''));
        setUnidades(unidades);
        console.log("Unidades recebidas:", unidades.length);
        renderControlsCallback(); 
        renderUIModuleCallback(); 
        renderPermissionsUI(); // Reaplicar permissões ao carregar unidades
    }, (error) => { console.error("Erro no listener de unidades:", error); showAlert('alert-gestao', `Erro ao carregar unidades: ${error.message}`, 'error'); });

    // Listener de Movimentações de Água
    onSnapshot(query(COLLECTIONS.aguaMov), (snapshot) => {
        const movs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setAguaMovimentacoes(movs);
        console.log("Mov. Água recebidas:", movs.length);
        renderDashboardCallback(); 
        renderUIModuleCallback(); 
    }, (error) => { console.error("Erro no listener de água:", error); showAlert('alert-agua-lista', `Erro ao carregar dados de água: ${error.message}`, 'error'); });

    // Listener de Movimentações de Gás
    onSnapshot(query(COLLECTIONS.gasMov), (snapshot) => {
        const movs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setGasMovimentacoes(movs);
        console.log("Mov. Gás recebidas:", movs.length);
        renderDashboardCallback(); 
        renderUIModuleCallback(); 
    }, (error) => { console.error("Erro no listener de gás:", error); showAlert('alert-gas-lista', `Erro ao carregar dados de gás: ${error.message}`, 'error'); });

    // Listener de Materiais
    onSnapshot(query(COLLECTIONS.materiais), (snapshot) => {
        const materiais = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setMateriais(materiais);
        console.log("Materiais recebidos:", materiais.length);
        renderDashboardCallback(); 
        renderUIModuleCallback();
    }, (error) => { console.error("Erro no listener de materiais:", error); showAlert('alert-materiais-lista', `Erro ao carregar materiais: ${error.message}`, 'error'); });
    
    // Listener de Estoque de Água
    onSnapshot(query(COLLECTIONS.estoqueAgua), (snapshot) => {
        const estoque = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setEstoqueAgua(estoque);
        const inicialDefinido = estoque.some(e => e.tipo === 'inicial');
        setEstoqueInicialDefinido('agua', inicialDefinido);
        console.log("Estoque Água recebido:", estoque.length, "Inicial definido:", inicialDefinido);
        renderUIModuleCallback();
        renderDashboardCallback(); 
    }, (error) => { console.error("Erro no listener de estoque água:", error); });
    
    // Listener de Estoque de Gás
    onSnapshot(query(COLLECTIONS.estoqueGas), (snapshot) => {
        const estoque = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setEstoqueGas(estoque);
        const inicialDefinido = estoque.some(e => e.tipo === 'inicial');
        setEstoqueInicialDefinido('gas', inicialDefinido);
        console.log("Estoque Gás recebido:", estoque.length, "Inicial definido:", inicialDefinido);
        renderUIModuleCallback();
        renderDashboardCallback(); 
    }, (error) => { console.error("Erro no listener de estoque gás:", error); });
}


/**
 * Inicializa a autenticação e configura o listener de estado.
 */
async function initAuthAndListeners(renderDashboardCallback, renderControlsCallback, renderUIModuleCallback) {
    if (!auth) { 
        console.error("Auth não inicializado. Verifique firestore-service."); 
        return; 
    }

    if (DOM_ELEMENTS.connectionStatusEl) {
         DOM_ELEMENTS.connectionStatusEl.innerHTML = `<span class="h-3 w-3 bg-yellow-400 rounded-full animate-pulse"></span> <span>Autenticando...</span>`;
    }
    
    // O modal só é exibido se não houver um token customizado (Ambiente Canvas)
    if (!initialAuthToken && DOM_ELEMENTS.authModal) {
         DOM_ELEMENTS.authModal.style.display = 'flex';
         if (typeof lucide !== 'undefined' && typeof lucide.createIcons === 'function') { lucide.createIcons(); }
    }


    onAuthStateChanged(auth, async (user) => { 
        if (user) {
            isAuthReady = true;
            userId = user.uid;
            
            // 1. OBTÉM O ROLE DO USUÁRIO
            const role = await getUserRoleFromFirestore(user.uid, user.isAnonymous);
            setUserRole(role);
            console.log(`Autenticado com UID: ${userId}, Role: ${role}`);


            if (DOM_ELEMENTS.connectionStatusEl) DOM_ELEMENTS.connectionStatusEl.innerHTML = `<span class="h-3 w-3 bg-green-500 rounded-full"></span> <span class="text-green-700">Conectado (${role})</span>`;
            
            // 2. Inicia os Listeners e Renderiza a UI (apenas se estiver realmente logado)
            if (role !== 'unauthenticated') {
                // Remove o wrapper hidden do conteúdo principal
                if (DOM_ELEMENTS.appContentWrapper) DOM_ELEMENTS.appContentWrapper.classList.remove('hidden');

                initFirestoreListeners(renderDashboardCallback, renderControlsCallback, renderUIModuleCallback);
                
                // Renderização inicial
                updateLastUpdateTime(); 
                switchTab('dashboard'); 
                renderPermissionsUI(); // Aplica as permissões após definir o role

            }

        } else {
            isAuthReady = false;
            userId = null; 
            setUserRole('unauthenticated'); // Limpa o role
            console.log("Usuário deslogado. Aguardando login.");
            
            if (DOM_ELEMENTS.connectionStatusEl) DOM_ELEMENTS.connectionStatusEl.innerHTML = `<span class="h-3 w-3 bg-red-500 rounded-full"></span> <span class="text-red-700">Desconectado</span>`;
            
            // Oculta o conteúdo e mostra o modal de login, se não for ambiente Canvas
            if (DOM_ELEMENTS.appContentWrapper) DOM_ELEMENTS.appContentWrapper.classList.add('hidden');
            if (!initialAuthToken && DOM_ELEMENTS.authModal) DOM_ELEMENTS.authModal.style.display = 'flex';
            
            renderPermissionsUI(); // Limpa a UI de acordo com o role 'unauthenticated'
        }
    });

    // Tenta o login automático (Custom Token) se houver
    try {
        if (initialAuthToken) {
            console.log("Tentando login com Custom Token...");
            await signInWithCustomToken(auth, initialAuthToken);
        }
        // Se não houver Custom Token, o onAuthStateChanged e o modal cuidam.
    } catch (error) {
        console.error("Erro CRÍTICO ao autenticar Firebase (Token):", error);
         if (DOM_ELEMENTS.connectionStatusEl) DOM_ELEMENTS.connectionStatusEl.innerHTML = `<span class="h-3 w-3 bg-red-500 rounded-full"></span> <span class="text-red-700">Erro Auth</span>`;
        showAlert('alert-agua', `Erro crítico na autenticação: ${error.message}. Recarregue a página.`, 'error', 60000);
    }
}


export { initAuthAndListeners, getUserId, isReady, signInEmailPassword, signOutUser, signInAnonUser }; 
