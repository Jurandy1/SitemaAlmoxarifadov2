// js/modules/control-helpers.js
import { getUnidades } from "../utils/cache.js";
// CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
import {
    DOM_ELEMENTS,
    switchTab,
    findDOMElements,
    showAlert,
    switchSubTabView,
    filterTable,
    updateLastUpdateTime,
    handleSaldoFilterUI,
    openConfirmDeleteModal
} from "../utils/dom-helpers.js";

import { onAguaTabChange, initAguaListeners } from "./agua-control.js";
import { onGasTabChange, initGasListeners } from "./gas-control.js";
import { onMateriaisTabChange, initMateriaisListeners } from "./materiais.js";
import { onGestaoTabChange, initGestaoListeners } from "./gestao.js";
import { onRelatorioTabChange, initRelatoriosListeners } from "./relatorios.js";
import { onUsuariosTabChange, initUsuariosListeners } from "./usuarios.js"; // ADICIONADO
import { onSocialTabChange, initSocialListeners } from "./social-control.js"; // NOVO MÓDULO
import { setupAnaliseUnidadeControls } from "./previsao.js"; // IMPORTADO
import {
    initDashboardListeners,
    renderDashboard,
    startDashboardRefresh,
    stopDashboardRefresh
} from "./dashboard.js";
import { getTodayDateString } from "../utils/formatters.js";

// ======================================================================
// FUNÇÕES DE CONTROLE GERAL
// ======================================================================

/**
 * Renderiza todos os módulos da UI que estão ativos.
 */
function renderUIModules() {
    renderUnidadeControls();
    
    // Configura o filtro de análise de consumo (Novo)
    setupAnaliseUnidadeControls('agua');
    setupAnaliseUnidadeControls('gas');

    // CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
    if (DOM_ELEMENTS.contentPanes) {
        DOM_ELEMENTS.contentPanes.forEach(pane => {
            // Verifica se o painel não está 'hidden', pois só precisa renderizar o que está visível
            if (!pane.classList.contains("hidden")) {
                const tabName = pane.id.replace("content-", "");
                console.log(`renderUIModules calling for tab: ${tabName}`);
                switch (tabName) {
                    case "dashboard":
                        renderDashboard();
                        break;
                    case "agua":
                        onAguaTabChange(); // Chama a orquestração da tab Água
                        break;
                    case "gas":
                        onGasTabChange(); // Chama a orquestração da tab Gás
                        break;
                    case "materiais":
                        onMateriaisTabChange();
                        break;
                    case "social": // NOVO MÓDULO SOCIAL
                        onSocialTabChange();
                        break;
                    case "gestao":
                        onGestaoTabChange();
                        break;
                    case "relatorio":
                        onRelatorioTabChange();
                        break;
                    case "usuarios":
                        onUsuariosTabChange();
                        break;
                }
            }
        });
    }
}

/**
 * Renderiza os controles de unidade (selects) em todas as abas.
 */
function renderUnidadeControls() {
    const unidades = getUnidades();
    const selectsToPopulate = [
        // CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
        { el: DOM_ELEMENTS.selectUnidadeAgua, service: "atendeAgua", includeAll: false, includeSelecione: true },
        { el: DOM_ELEMENTS.selectUnidadeGas, service: "atendeGas", includeAll: false, includeSelecione: true },
        { el: DOM_ELEMENTS.selectUnidadeMateriais, service: "atendeMateriais", includeAll: false, includeSelecione: true },
        { el: document.getElementById("select-previsao-unidade-agua-v2"), service: "atendeAgua", useIdAsValue: true },
        { el: document.getElementById("select-previsao-unidade-gas-v2"), service: "atendeGas", useIdAsValue: true },
        { el: document.getElementById("select-exclusao-agua"), service: "atendeAgua", useIdAsValue: true },
        { el: document.getElementById("select-exclusao-gas"), service: "atendeGas", useIdAsValue: true },
        
        // Novos selects de filtro por tipo/unidade para Previsão (agora populados por setupAnaliseUnidadeControls)
    ];

    selectsToPopulate.forEach(({ el, service, includeAll, includeSelecione, filterType, useIdAsValue }) => {
        if (!el) return;

        let unidadesFiltradas = unidades.filter(u => {
            const atendeServico = service ? (u[service] ?? true) : true;
            let tipoUnidadeNormalizado = (u.tipo || "").toUpperCase();
            if (tipoUnidadeNormalizado === "SEMCAS") tipoUnidadeNormalizado = "SEDE";
            const tipoCorreto = !filterType || tipoUnidadeNormalizado === (filterType || "").toUpperCase();
            return atendeServico && tipoCorreto;
        });

        const grupos = unidadesFiltradas.reduce((acc, unidade) => {
            let tipo = (unidade.tipo || "Sem Tipo").toUpperCase();
            if (tipo === "SEMCAS") tipo = "SEDE";
            if (!acc[tipo]) acc[tipo] = [];
            acc[tipo].push(unidade);
            return acc;
        }, {});

        const tiposOrdenados = Object.keys(grupos).sort();

        let html = "";
        if (includeSelecione) html += "<option value=''>-- Selecione --</option>";
        if (includeAll) html += "<option value='todas'>Todas as Unidades</option>";

        tiposOrdenados.forEach(tipo => {
            html += `<optgroup label="${tipo}">`;
            grupos[tipo]
                .sort((a, b) => a.nome.localeCompare(b.nome))
                .forEach(unidade => {
                    const optionValue = useIdAsValue ? unidade.id : `${unidade.id}|${unidade.nome}|${unidade.tipo}`;
                    html += `<option value="${optionValue}">${unidade.nome}</option>`;
                });
            html += `</optgroup>`;
        });
        el.innerHTML = html;
    });

    // População para os selects de TIPO na Previsão (Mantida, mas a nova lógica de análise usa uma função diferente)
    const selectTipoAgua = document.getElementById("select-previsao-tipo-agua");
    const selectTipoGas = document.getElementById("select-previsao-tipo-gas");

    if (selectTipoAgua || selectTipoGas) {
        const uniqueTypes = [...new Set(unidades.map(u => {
            let tipo = (u.tipo || "Sem Tipo").toUpperCase();
            return tipo === "SEMCAS" ? "SEDE" : tipo;
        }))].sort();

        let html = "<option value=''>-- Selecione o Tipo --</option>";
        uniqueTypes.forEach(tipo => {
            html += `<option value="${tipo}">${tipo}</option>`;
        });

        if (selectTipoAgua) selectTipoAgua.innerHTML = html;
        if (selectTipoGas) selectTipoGas.innerHTML = html;
    }
}

/**
 * Inicializa todos os listeners de navegação e de módulo.
 */
function initAllListeners() {
    // CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
    DOM_ELEMENTS.navButtons.forEach(button => button.addEventListener("click", () => {
        stopDashboardRefresh();
        switchTab(button.dataset.tab); // This logs "Switching to tab: ..."

        // Chama a função de orquestração correta ao trocar de aba
        switch (button.dataset.tab) {
            case "dashboard":
                console.log("Calling initDashboardListeners, startDashboardRefresh, renderDashboard...");
                startDashboardRefresh();
                renderDashboard();
                break;
            case "agua":
                console.log("Calling onAguaTabChange...");
                onAguaTabChange();
                break;
            case "gas":
                console.log("Calling onGasTabChange...");
                onGasTabChange();
                break;
            case "materiais":
                console.log("Calling onMateriaisTabChange...");
                onMateriaisTabChange();
                break;
            case "social": // NOVO MÓDULO
                console.log("Calling onSocialTabChange...");
                onSocialTabChange();
                break;
            case "gestao":
                console.log("Calling onGestaoTabChange...");
                onGestaoTabChange();
                break;
            case "relatorio":
                console.log("Calling onRelatorioTabChange...");
                onRelatorioTabChange();
                break;
            case "usuarios":
                console.log("Calling onUsuariosTabChange...");
                onUsuariosTabChange();
                break;
        }
    }));

    // Listener delegado para remoção em todas as abas
    document.querySelector("main").addEventListener("click", (e) => {
        const removeBtn = e.target.closest("button.btn-remove[data-id]");
        if (removeBtn) {
             // Determina o alertId com base no tipo
             let alertId = 'alert-gestao'; // Default para gestão
             const type = removeBtn.dataset.type;
             // Lógica de alerta para movimentações de unidade
             if (type === 'agua') alertId = 'alert-historico-agua'; 
             else if (type === 'gas') alertId = 'alert-historico-gas'; 
             // Lógica de alerta para entradas de estoque (NOVO PONTO 1)
             else if (type === 'entrada-agua') alertId = 'alert-historico-estoque-agua'; 
             else if (type === 'entrada-gas') alertId = 'alert-historico-estoque-gas'; 
             // Lógica de alerta para materiais (usa o ID da subview)
             else if (type === 'materiais') {
                const subview = removeBtn.closest('[id^="subview-"]');
                if (subview) {
                    // Pega a parte do meio da ID da subview (ex: subview-para-separar -> para)
                    alertId = `alert-${subview.id.split('-')[1]}`;
                }
             }
             // Lógica de alerta para unidade
             else if (type === 'unidade') alertId = 'alert-gestao'; 
             // Lógica de alerta para Social (Cesta/Enxoval)
             else if (type === 'cesta' || type === 'enxoval') alertId = `${type}-relatorio`; 

             console.log(`openConfirmDeleteModal called with type: ${type}, alertId: ${alertId}`);

             openConfirmDeleteModal(
                removeBtn.dataset.id,
                type,
                removeBtn.dataset.details,
                alertId // Passa o ID do alerta correto
             );
        }
    });

    // CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
    if (DOM_ELEMENTS.btnCancelDelete)
        DOM_ELEMENTS.btnCancelDelete.addEventListener("click", () => {
             // CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
             if(DOM_ELEMENTS.confirmDeleteModal) DOM_ELEMENTS.confirmDeleteModal.style.display = "none";
         });

    // Inicialização de listeners específicos de módulo (executados apenas uma vez)
    console.log("Initializing listeners for all modules...");
    initDashboardListeners();
    initAguaListeners();
    initGasListeners();
    initMateriaisListeners();
    initGestaoListeners();
    initRelatoriosListeners();
    initUsuariosListeners(); // Inicializa listeners de Usuários
    initSocialListeners(); // NOVO: Inicializa listeners de Assistência Social
}

// ================================================================
// EXPORTAÇÕES
// ================================================================
export {
    renderUIModules,
    renderUnidadeControls,
    initAllListeners,
    // Exportações de utilidades do DOM usadas pelo app.js
    DOM_ELEMENTS,
    findDOMElements,
    updateLastUpdateTime,
    showAlert 
};
