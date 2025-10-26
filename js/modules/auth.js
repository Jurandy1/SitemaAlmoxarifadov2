// js/modules/auth.js
import { signInAnonymously, signInWithCustomToken, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { onSnapshot, query } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js"; 
import { initialAuthToken } from "../firebase-config.js";
import { auth, COLLECTIONS } from "../services/firestore-service.js";
import { DOM_ELEMENTS, showAlert, updateLastUpdateTime, switchTab } from "../utils/dom-helpers.js";
import { setUnidades, setAguaMovimentacoes, setGasMovimentacoes, setMateriais, setEstoqueAgua, setEstoqueGas, setEstoqueInicialDefinido } from "../utils/cache.js";

// Variável de estado local para o módulo
let isAuthReady = false;
let userId = null;

function getUserId() { return userId; }
function isReady() { return isAuthReady; }

/**
 * Inicia os listeners de real-time do Firestore.
 * @param {Function} renderDashboardCallback Callback para renderizar o dashboard.
 * @param {Function} renderControlsCallback Callback para renderizar controles (selects, etc.).
 * @param {Function} renderUIModuleCallback Função para renderizar as UIs dos módulos (água, gás, materiais).
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

    onAuthStateChanged(auth, async (user) => { 
        if (user) {
            isAuthReady = true;
            userId = user.uid;
            console.log("Autenticado com UID:", userId, "Anônimo:", user.isAnonymous);
            if (DOM_ELEMENTS.connectionStatusEl) DOM_ELEMENTS.connectionStatusEl.innerHTML = `<span class="h-3 w-3 bg-green-500 rounded-full"></span> <span class="text-green-700">Conectado</span>`;
            
            initFirestoreListeners(renderDashboardCallback, renderControlsCallback, renderUIModuleCallback);
            
            // Renderização inicial
            updateLastUpdateTime(); 
            switchTab('dashboard'); 
            
        } else {
            isAuthReady = false;
            userId = null; 
            console.log("Usuário deslogado.");
            if (DOM_ELEMENTS.connectionStatusEl) DOM_ELEMENTS.connectionStatusEl.innerHTML = `<span class="h-3 w-3 bg-red-500 rounded-full"></span> <span class="text-red-700">Desconectado</span>`;
            // Lógica para limpar UI (a ser implementada nos módulos de controle/dom-helpers se necessário)
            // clearAlmoxarifadoData(); 
        }
    });

    // Inicia o processo de autenticação
    try {
        if (initialAuthToken) {
            console.log("Tentando login com Custom Token...");
            await signInWithCustomToken(auth, initialAuthToken);
        } else {
            console.log("Nenhum Custom Token encontrado. Tentando login anônimo...");
            await signInAnonymously(auth);
        }
    } catch (error) {
        console.error("Erro CRÍTICO ao autenticar Firebase:", error);
         if (DOM_ELEMENTS.connectionStatusEl) DOM_ELEMENTS.connectionStatusEl.innerHTML = `<span class="h-3 w-3 bg-red-500 rounded-full"></span> <span class="text-red-700">Erro Auth</span>`;
        showAlert('alert-agua', `Erro crítico na autenticação: ${error.message}. Recarregue a página.`, 'error', 60000);
    }
}

export { initAuthAndListeners, getUserId, isReady };
