// js/modules/control-helpers.js// js/modules/control-helpers.js
import { getUnidades } from "../utils/cache.js";
// CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
import {
    DOM_ELEMENTS,
    switchTab,
    findDOMElements,
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
import { onUsuariosTabChange, initUsuariosListeners } from "./usuarios.js"; 
import { onSocialTabChange, initSocialListeners } from "./social-control.js"; 
import { setupAnaliseUnidadeControls } from "./previsao.js"; 
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
    // Otimização: Renderizar controles de unidade é pesado e reseta formulários.
    // O ideal seria chamar isso apenas quando a lista de unidades mudar, 
    // mas como salvaguarda, vamos manter aqui com preservação de valor (ver renderUnidadeControls).
    renderUnidadeControls();
    
    // Configura o filtro de análise de consumo
    // OBS: setupAnaliseUnidadeControls deve ser inteligente para não recriar listeners desnecessariamente
    setupAnaliseUnidadeControls('agua');
    setupAnaliseUnidadeControls('gas');

    if (DOM_ELEMENTS.contentPanes) {
        DOM_ELEMENTS.contentPanes.forEach(pane => {
            if (!pane.classList.contains("hidden")) {
                const tabName = pane.id.replace("content-", "");
                // console.log(`renderUIModules calling for tab: ${tabName}`); // Log reduzido
                switch (tabName) {
                    case "dashboard":
                        renderDashboard();
                        break;
                    case "agua":
                        onAguaTabChange(); 
                        break;
                    case "gas":
                        onGasTabChange(); 
                        break;
                    case "materiais":
                        onMateriaisTabChange();
                        break;
                    case "social": 
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
 * CORREÇÃO APLICADA: Preserva o valor selecionado para evitar reset durante updates em tempo real.
 */
function renderUnidadeControls() {
    const unidades = getUnidades();
    const selectsToPopulate = [
        { el: DOM_ELEMENTS.selectUnidadeAgua, service: "atendeAgua", includeAll: false, includeSelecione: true },
        { el: DOM_ELEMENTS.selectUnidadeGas, service: "atendeGas", includeAll: false, includeSelecione: true },
        { el: DOM_ELEMENTS.selectUnidadeMateriais, service: "atendeMateriais", includeAll: false, includeSelecione: true },
        { el: document.getElementById("select-previsao-unidade-agua-v2"), service: "atendeAgua", useIdAsValue: true },
        { el: document.getElementById("select-previsao-unidade-gas-v2"), service: "atendeGas", useIdAsValue: true },
        { el: document.getElementById("select-exclusao-agua"), service: "atendeAgua", useIdAsValue: true },
        { el: document.getElementById("select-exclusao-gas"), service: "atendeGas", useIdAsValue: true },
        
        // Novos selects sociais
        { el: document.getElementById("cesta-select-unidade"), service: null, useIdAsValue: false, includeSelecione: true, filterType: null, customFormat: "TIPO: NOME" },
        { el: document.getElementById("enxoval-select-unidade"), service: null, useIdAsValue: false, includeSelecione: true, filterType: null, customFormat: "TIPO: NOME" }
    ];

    selectsToPopulate.forEach(({ el, service, includeAll, includeSelecione, filterType, useIdAsValue, customFormat }) => {
        if (!el) return;

        // 1. Salva o valor atual selecionado pelo usuário
        const currentValue = el.value;

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
                    let optionValue;
                    if (useIdAsValue) {
                        optionValue = unidade.id;
                    } else if (customFormat === "TIPO: NOME") {
                        optionValue = `${tipo}: ${unidade.nome}`;
                    } else {
                        optionValue = `${unidade.id}|${unidade.nome}|${unidade.tipo}`;
                    }
                    
                    html += `<option value="${optionValue}">${unidade.nome}</option>`;
                });
            html += `</optgroup>`;
        });
        
        // Só atualiza o HTML se ele mudou (evita reflows desnecessários)
        if (el.innerHTML !== html) {
            el.innerHTML = html;
            // 2. Restaura o valor selecionado se ele ainda existir nas novas opções
            if (currentValue) {
                el.value = currentValue;
                // Se o valor antigo não existir mais (ex: unidade removida), volta para o default
                if (el.value !== currentValue) {
                    el.value = ""; 
                }
            }
        }
    });

    // População para os selects de TIPO na Previsão
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

        const updateSelect = (sel) => {
            if (sel) {
                const currentVal = sel.value;
                if (sel.innerHTML !== html) {
                    sel.innerHTML = html;
                    if (currentVal) sel.value = currentVal;
                }
            }
        }
        updateSelect(selectTipoAgua);
        updateSelect(selectTipoGas);
    }
}

/**
 * Inicializa todos os listeners de navegação e de módulo.
 */
function initAllListeners() {
    // CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
    DOM_ELEMENTS.navButtons.forEach(button => button.addEventListener("click", () => {
        stopDashboardRefresh();
        switchTab(button.dataset.tab); 

        switch (button.dataset.tab) {
            case "dashboard":
                startDashboardRefresh();
                renderDashboard();
                break;
            case "agua":
                onAguaTabChange();
                break;
            case "gas":
                onGasTabChange();
                break;
            case "materiais":
                onMateriaisTabChange();
                break;
            case "social": 
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
    }));

    document.querySelector("main").addEventListener("click", (e) => {
        const removeBtn = e.target.closest("button.btn-remove[data-id]");
        if (removeBtn) {
             let alertId = 'alert-gestao'; 
             const type = removeBtn.dataset.type;
             if (type === 'agua') alertId = 'alert-historico-agua'; 
             else if (type === 'gas') alertId = 'alert-historico-gas'; 
             else if (type === 'entrada-agua') alertId = 'alert-historico-estoque-agua'; 
             else if (type === 'entrada-gas') alertId = 'alert-historico-estoque-gas'; 
             else if (type === 'materiais') {
                const subview = removeBtn.closest('[id^="subview-"]');
                if (subview) {
                    alertId = `alert-${subview.id.split('-')[1]}`;
                }
             }
             else if (type === 'unidade') alertId = 'alert-gestao'; 
             // Lógica específica para estoque social
             else if (type === 'estoque-cesta') alertId = 'alert-cesta-estoque';
             else if (type === 'estoque-enxoval') alertId = 'alert-enxoval-estoque';
             // Lógica para movimentação social
             else if (type === 'mov-cesta') alertId = 'cesta-relatorio'; // Alerta está na aba relatório?
             else if (type === 'mov-enxoval') alertId = 'enxoval-relatorio';

             openConfirmDeleteModal(
                removeBtn.dataset.id,
                type,
                removeBtn.dataset.details,
                alertId 
             );
        }
    });

    if (DOM_ELEMENTS.btnCancelDelete)
        DOM_ELEMENTS.btnCancelDelete.addEventListener("click", () => {
             if(DOM_ELEMENTS.confirmDeleteModal) DOM_ELEMENTS.confirmDeleteModal.style.display = "none";
         });

    console.log("Initializing listeners for all modules...");
    initDashboardListeners();
    initAguaListeners();
    initGasListeners();
    initMateriaisListeners();
    initGestaoListeners();
    initRelatoriosListeners();
    initUsuariosListeners(); 
    initSocialListeners(); 
}

export {
    renderUIModules,
    renderUnidadeControls,
    initAllListeners,
    DOM_ELEMENTS,
    findDOMElements,
    updateLastUpdateTime,
    showAlert 
};
