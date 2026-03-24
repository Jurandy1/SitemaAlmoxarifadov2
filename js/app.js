// Este é o arquivo principal que orquestra a inicialização e os módulos.

import { createIcons, icons } from "lucide";
window.lucide = {
    icons,
    createIcons: (options) => createIcons({ icons, ...(options || {}) })
};

import { initializeFirebaseServices } from "./services/firestore-service.js";
// Adicionado signInAnonUser e signInEmailPassword para o formulário de login no DOM
import { initAuthAndListeners, signOutUser, signInAnonUser, signInEmailPassword, sendResetPassword } from "./modules/auth.js"; 
import { renderDashboard, startDashboardRefresh, stopDashboardRefresh, renderDashboardAguaChart, renderDashboardGasChart } from "./modules/dashboard.js";
// CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
// NOTA: showAlert foi importado aqui. Certifique-se de que ele está corretamente exportado em control-helpers.js
// OU remova-o daqui e importe-o de utils/dom-helpers.js (melhor prática).
import { renderUIModules, renderUnidadeControls, initAllListeners, DOM_ELEMENTS, findDOMElements, updateLastUpdateTime, showAlert } from "./modules/control-helpers.js";
import { switchTab, switchSubTabView, escapeHTML } from "./utils/dom-helpers.js";
import { executeDelete } from "./utils/db-utils.js";
import { handleFinalMovimentacaoSubmit } from "./modules/movimentacao-modal-handler.js";
import { getTodayDateString } from "./utils/formatters.js";
import { initPrevisaoListeners } from "./modules/previsao.js"; 
import { getDebitosAguaResumoList, renderAguaMovimentacoesHistory } from "./modules/agua-control.js";
import { getDebitosGasResumoList } from "./modules/gas-control.js";
import { isReady } from "./modules/auth.js";
import { initSocialListeners } from "./modules/social-control.js"; // NOVO
import { initFeriadosListeners } from "./modules/feriados.js";
import { getUserRole } from "./utils/cache.js";
import { initTooltips } from "./utils/tooltip-manager.js";

// Variável de estado da UI local (para manter o dashboard na tela)
let visaoAtiva = 'inicio'; 

function initHeaderDate() {
    const dateEl = document.getElementById('header-date');
    if (!dateEl) return;
    const update = () => {
        const now = new Date();
        const opts = { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' };
        dateEl.textContent = now.toLocaleDateString('pt-BR', opts);
    };
    update();
    setInterval(update, 60000);
}

function ensureLucideIcons() {
    // Tenta usar a função global do fallback se existir
    if (typeof window.ensureLucideIcons === 'function') {
        window.ensureLucideIcons();
    } else if (typeof lucide !== 'undefined' && typeof lucide.createIcons === 'function') {
        try { lucide.createIcons(); } catch (_) {}
    }
}

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

    initHeaderDate();
    ensureLucideIcons();
    initTooltips();
    
    // 4. Configurar listener de exclusão no modal
    if (DOM_ELEMENTS.btnConfirmDelete) DOM_ELEMENTS.btnConfirmDelete.addEventListener('click', executeDelete);
    
    // 5. Configurar listener para o modal de movimentação final
    // CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
    if (DOM_ELEMENTS.btnSalvarMovimentacaoFinal) DOM_ELEMENTS.btnSalvarMovimentacaoFinal.addEventListener('click', handleFinalMovimentacaoSubmit);

    // 6. ADICIONADO: Inicializa os listeners da Previsão (globais)
    initPrevisaoListeners();
    
    // 7. ADICIONADO: Inicializa os listeners de Assistência Social (globais)
    initSocialListeners();

    initFeriadosListeners();
    
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
                            showAlert('alert-login', 'Erro ao logar: ' + (error.message || 'Verifique suas credenciais.'), 'error');
                        }
            } finally {
                // Reabilita o botão e restaura o ícone
                btn.disabled = false;
                btn.innerHTML = '<i data-lucide="log-in"></i> Entrar';
                if (typeof lucide !== 'undefined' && typeof lucide.createIcons === 'function') { lucide.createIcons(); }
            }
        });
        const btnReset = document.getElementById('btn-reset-password');
        if (btnReset) {
            btnReset.addEventListener('click', async () => {
                const email = DOM_ELEMENTS.inputLoginEmail.value;
                btnReset.disabled = true;
                try { await sendResetPassword(email); } finally { btnReset.disabled = false; }
            });
        }
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
                            showAlert('alert-login', 'Erro no acesso anônimo. Tente novamente.', 'error');
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

    // 10. Alerta de débitos recorrente (usuários logados)
    setupDebitosPopupScheduler();

    // 11. Configurar o estado inicial do dashboard (inicia o refresh ao entrar na aba)
    const inicioBtn = document.querySelector('.nav-btn[data-tab="inicio"]');
    if (inicioBtn) inicioBtn.click();

    // 12. Menu Mobile Toggle
    const sidebar = document.getElementById('main-sidebar');
    const menuBtn = document.getElementById('mobile-menu-btn');
    const overlay = document.createElement('div'); // Criar overlay dinamicamente
    overlay.className = 'fixed inset-0 bg-black/50 z-20 hidden md:hidden transition-opacity duration-300 opacity-0';
    if (sidebar) sidebar.parentNode.insertBefore(overlay, sidebar);

    if (sidebar && menuBtn) {
        const toggleMenu = () => {
            const isClosed = sidebar.classList.contains('-translate-x-full');
            if (isClosed) {
                sidebar.classList.remove('-translate-x-full');
                overlay.classList.remove('hidden');
                setTimeout(() => overlay.classList.remove('opacity-0'), 10); // Fade in
                menuBtn.setAttribute('aria-expanded', 'true');
            } else {
                sidebar.classList.add('-translate-x-full');
                overlay.classList.add('opacity-0');
                setTimeout(() => overlay.classList.add('hidden'), 300); // Wait for fade out
                menuBtn.setAttribute('aria-expanded', 'false');
            }
        };

        menuBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleMenu();
        });

        overlay.addEventListener('click', toggleMenu);

        // Fechar ao clicar em um botão de navegação (apenas mobile)
        sidebar.querySelectorAll('.nav-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                if (window.innerWidth < 768) { // md breakpoint
                     sidebar.classList.add('-translate-x-full');
                     overlay.classList.add('opacity-0');
                     setTimeout(() => overlay.classList.add('hidden'), 300);
                }
            });
        });
    }

    console.log("Setup inicial do DOM concluído.");
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

let __debitosIntervalId = null;
let __debitosBootstrapId = null;
let __debitosHasShown = false;
    function setupDebitosPopupScheduler() {
        if (__debitosIntervalId) clearInterval(__debitosIntervalId);
        const showNow = () => {
            try {
                if (!isReady()) return;
                const role = getUserRole();
                if (!role || role === 'unauthenticated' || role === 'anon') return;
                const waterMsgs = getDebitosAguaResumoList();
                const gasMsgs = getDebitosGasResumoList();
                const msgs = [...waterMsgs, ...gasMsgs];
                const modal = DOM_ELEMENTS.alertaDebitosModal;
                const content = DOM_ELEMENTS.alertaDebitosContent;
            const btnClose = DOM_ELEMENTS.btnFecharAlertaDebitos;
            if (!modal || !content || !btnClose) return;
            if (msgs.length === 0) return; // Sem débitos
            content.innerHTML = msgs.map(m => `
                <div class="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-xl">
                    <div class="mt-1 text-red-600">
                        <i data-lucide="alert-triangle"></i>
                    </div>
                    <div class="flex-1">
                        <div class="text-base md:text-lg font-semibold text-gray-800">${escapeHTML(m)}</div>
                    </div>
                </div>
            `).join('');
            modal.classList.remove('hidden');
            btnClose.onclick = () => { modal.classList.add('hidden'); };
            if (typeof lucide !== 'undefined' && typeof lucide.createIcons === 'function') { lucide.createIcons(); }
            // Ligações dos botões para ver o dia da dívida (água)
            content.querySelectorAll('.btn-ver-dia-divida').forEach(btn => {
                btn.addEventListener('click', () => {
                    const unidadeId = btn.getAttribute('data-unidade-id');
                    const dateStr = btn.getAttribute('data-date');
                    if (!unidadeId || !dateStr) return;
                    switchTab('agua');
                    switchSubTabView('agua', 'historico-agua');
                    const unidadeEl = document.getElementById('filtro-unidade-agua');
                    const dataIniEl = document.getElementById('filtro-data-inicio-agua');
                    const dataFimEl = document.getElementById('filtro-data-fim-agua');
                    const origemEl = document.getElementById('filtro-origem-agua');
                    if (unidadeEl) unidadeEl.value = unidadeId;
                    if (dataIniEl) dataIniEl.value = dateStr;
                    if (dataFimEl) dataFimEl.value = dateStr;
                    if (origemEl) origemEl.value = '';
                    renderAguaMovimentacoesHistory();
                    modal.classList.add('hidden');
                });
            });
            __debitosHasShown = true;
        } catch (e) { console.error('Erro ao mostrar alerta de débitos:', e); }
    };
    showNow();
    if (__debitosBootstrapId) { clearInterval(__debitosBootstrapId); __debitosBootstrapId = null; }
    __debitosBootstrapId = setInterval(() => {
        if (isReady() && !__debitosHasShown) {
            showNow();
            __debitosHasShown = true;
            clearInterval(__debitosBootstrapId);
            __debitosBootstrapId = null;
        }
    }, 3000);
    // Repete a cada 10 minutos
    __debitosIntervalId = setInterval(showNow, 10 * 60 * 1000);
}

// Inicia a aplicação após o DOM estar completamente carregado
document.addEventListener('DOMContentLoaded', main);
