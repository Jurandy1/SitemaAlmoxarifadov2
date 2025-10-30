// Este é o arquivo principal que orquestra a inicialização e os módulos.

import { initializeFirebaseServices } from "./services/firestore-service.js";
// Adicionado signInAnonUser e signInEmailPassword para o formulário de login no DOM
import { initAuthAndListeners, signOutUser, signInAnonUser, signInEmailPassword } from "./modules/auth.js"; 
import { renderDashboard, startDashboardRefresh, stopDashboardRefresh, renderDashboardAguaChart, renderDashboardGasChart } from "./modules/dashboard.js";
// CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
// NOTA: showAlert foi importado aqui. Certifique-se de que ele está corretamente exportado em control-helpers.js
// OU remova-o daqui e importe-o de utils/dom-helpers.js (melhor prática).
import { renderUIModules, renderUnidadeControls, initAllListeners, DOM_ELEMENTS, findDOMElements, updateLastUpdateTime, showAlert } from "./modules/control-helpers.js";
import { executeDelete } from "./utils/db-utils.js";
import { handleFinalMovimentacaoSubmit } from "./modules/movimentacao-modal-handler.js";
import { getTodayDateString } from "./utils/formatters.js";
import { initPrevisaoListeners } from "./modules/previsao.js"; 
import { initSocialListeners } from "./modules/social-control.js"; // NOVO

// Variável de estado da UI local (para manter o dashboard na tela)
let visaoAtiva = 'dashboard'; 

/**
 * Função que configura o app: encontra elementos DOM e adiciona listeners.
 */
function setupApp() {
    console.log("Executando setupApp...");
    
    // 1. Encontrar todos os elementos do DOM e armazenar em DOM_ELEMENTS
    findDOMElements(); 
    
    // 2. Definir datas iniciais
    const todayStr = getTodayDateString();
    // CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS (Adicionadas cestaData e enxovalData)
    [DOM_ELEMENTS.inputDataAgua, DOM_ELEMENTS.inputDataGas, DOM_ELEMENTS.inputDataSeparacao, DOM_ELEMENTS.inputDataEntradaAgua, DOM_ELEMENTS.inputDataEntradaGas, DOM_ELEMENTS.cestaData, DOM_ELEMENTS.enxovalData].forEach(input => {
        if(input) input.value = todayStr;
    });

    // 3. Adicionar listeners globais e específicos de módulo
    initAllListeners();
    
    // 4. Configurar listener de exclusão no modal
    if (DOM_ELEMENTS.btnConfirmDelete) DOM_ELEMENTS.btnConfirmDelete.addEventListener('click', executeDelete);
    
    // 5. Configurar listener para o modal de movimentação final
    // CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
    if (DOM_ELEMENTS.btnSalvarMovimentacaoFinal) DOM_ELEMENTS.btnSalvarMovimentacaoFinal.addEventListener('click', handleFinalMovimentacaoSubmit);

    // 6. ADICIONADO: Inicializa os listeners da Previsão (globais)
    initPrevisaoListeners();
    
    // 7. ADICIONADO: Inicializa os listeners de Assistência Social (globais)
    initSocialListeners();
    
    // 8. ADICIONADO: Listeners do Modal de Login
    if (DOM_ELEMENTS.formLogin) {
        DOM_ELEMENTS.formLogin.addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = DOM_ELEMENTS.inputLoginEmail.value;
            const password = DOM_ELEMENTS.inputLoginPassword.value;
            const btn = document.getElementById('btn-submit-login');
            
            try {
                // Desabilita o botão enquanto tenta logar
                btn.disabled = true;
                btn.innerHTML = '<div class="loading-spinner-small mx-auto"></div>';
                // Chama a função de login
                await signInEmailPassword(email, password);
            } catch (error) {
                // Tratamento de erro aprimorado
                console.error("Erro de login:", error);
                // Exibe um alerta de erro
                if (typeof showAlert === 'function') {
                    showAlert('login', 'Erro ao logar: ' + (error.message || 'Verifique suas credenciais.'), 'error');
                }
            } finally {
                // Reabilita o botão e restaura o ícone
                btn.disabled = false;
                btn.innerHTML = '<i data-lucide="log-in"></i> Entrar';
                if (typeof lucide !== 'undefined' && typeof lucide.createIcons === 'function') { lucide.createIcons(); }
            }
        });
    }
    
    if (DOM_ELEMENTS.btnLoginAnonimo) {
        DOM_ELEMENTS.btnLoginAnonimo.addEventListener('click', async () => {
             DOM_ELEMENTS.btnLoginAnonimo.disabled = true;
             DOM_ELEMENTS.btnLoginAnonimo.innerHTML = '<div class="loading-spinner-small mx-auto"></div>';
             
             try {
                await signInAnonUser();
             } catch(error) {
                console.error("Erro no Login Anônimo:", error);
                if (typeof showAlert === 'function') {
                    showAlert('login', 'Erro no acesso anônimo. Tente novamente.', 'error');
                }
             } finally {
                // Restaura o botão
                DOM_ELEMENTS.btnLoginAnonimo.disabled = false;
                DOM_ELEMENTS.btnLoginAnonimo.innerHTML = '<i data-lucide="user-x"></i> Acesso Anônimo (Visualização)';
                if (typeof lucide !== 'undefined' && typeof lucide.createIcons === 'function') { lucide.createIcons(); }
             }
        });
    }
    
    if (DOM_ELEMENTS.btnLogout) {
         DOM_ELEMENTS.btnLogout.addEventListener('click', signOutUser);
    }

    console.log("Setup inicial do DOM concluído.");
    
    // 9. Configurar o estado inicial do dashboard (inicia o refresh ao entrar na aba)
    const dashboardBtn = document.querySelector('.nav-btn[data-tab="dashboard"]');
    if (dashboardBtn) dashboardBtn.click();
}

/**
 * Ponto de entrada principal do aplicativo.
 */
function main() {
    console.log("Iniciando main()...");
    
    // 1. Inicializa o Firebase (instâncias, mas sem login)
    initializeFirebaseServices(); 

    // 2. Configura o App (DOM e Listeners)
    setupApp();

    // 3. Inicia a Autenticação e os Listeners do Firestore (usa callbacks para garantir a ordem)
    initAuthAndListeners(
        renderDashboard,        // Callback para renderizar o Dashboard
        renderUnidadeControls,  // Callback para renderizar selects/controles
        renderUIModules         // Callback para renderizar módulos (Água, Gás, etc.)
    );

}

// Inicia a aplicação após o DOM estar completamente carregado
document.addEventListener('DOMContentLoaded', main);
