// js/app.js
// Este é o arquivo principal que orquestra a inicialização e os módulos.

import { initializeFirebaseServices } from "./services/firestore-service.js";
import { initAuthAndListeners } from "./modules/auth.js";
import { renderDashboard, startDashboardRefresh, stopDashboardRefresh, renderDashboardAguaChart, renderDashboardGasChart } from "./modules/dashboard.js";
import { renderUIModules, renderUnidadeControls, initAllListeners, DOM_ELEMENTS, findDOMElements, updateLastUpdateTime } from "./modules/control-helpers.js";
import { executeDelete } from "./utils/db-utils.js";
import { handleFinalMovimentacaoSubmit } from "./modules/movimentacao-modal-handler.js";
import { getTodayDateString } from "./utils/formatters.js";

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
    [DOM_ELEMENTS.inputDataAgua, DOM_ELEMENTS.inputDataGas, DOM_ELEMENTS.inputDataSeparacao, DOM_ELEMENTS.inputDataEntradaAgua, DOM_ELEMENTS.inputDataEntradaGas].forEach(input => {
        if(input) input.value = todayStr;
    });

    // 3. Adicionar listeners globais e específicos de módulo
    initAllListeners();
    
    // 4. Configurar listener de exclusão no modal
    if (DOM_ELEMENTS.btnConfirmDelete) DOM_ELEMENTS.btnConfirmDelete.addEventListener('click', executeDelete);
    
    // 5. Configurar listener para o modal de movimentação final
    // CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
    if (DOM_ELEMENTS.btnSalvarMovimentacaoFinal) DOM_ELEMENTS.btnSalvarMovimentacaoFinal.addEventListener('click', handleFinalMovimentacaoSubmit);

    console.log("Setup inicial do DOM concluído.");
    
    // 6. Configurar o estado inicial do dashboard (inicia o refresh ao entrar na aba)
    document.querySelector('.nav-btn[data-tab="dashboard"]').click();
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
        renderDashboard,        // Callback para renderizar o Dashboard
        renderUnidadeControls,  // Callback para renderizar selects/controles
        renderUIModules         // Callback para renderizar módulos (Água, Gás, etc.)
    );

}

// Inicia a aplicação após o DOM estar completamente carregado
document.addEventListener('DOMContentLoaded', main);
