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
// ADICIONADO
import { onUsuariosTabChange, initUsuariosListeners } from "./usuarios.js";
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

function renderUIModules() {
    renderUnidadeControls();

    // CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
    if (DOM_ELEMENTS.contentPanes) {
        DOM_ELEMENTS.contentPanes.forEach(pane => {
            if (!pane.classList.contains("hidden")) {
                const tabName = pane.id.replace("content-", "");
                console.log(`renderUIModules calling for tab: ${tabName}`); // Log added
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
                    case "gestao":
                        onGestaoTabChange();
                        break;
                    case "relatorio":
                        onRelatorioTabChange();
                        break;
                    // ADICIONADO
                    case "usuarios":
                        onUsuariosTabChange();
                        break;
                }
            }
        });
    }
}

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

function initAllListeners() {
    // CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
    DOM_ELEMENTS.navButtons.forEach(button => button.addEventListener("click", () => {
        stopDashboardRefresh();
        switchTab(button.dataset.tab); // This logs "Switching to tab: ..."

        switch (button.dataset.tab) {
            case "dashboard":
                console.log("Calling initDashboardListeners, startDashboardRefresh, renderDashboard..."); // Add log
                // Não precisa iniciar listeners aqui, eles são iniciados uma vez abaixo
                startDashboardRefresh();
                renderDashboard();
                break;
            case "agua":
                console.log("Calling onAguaTabChange..."); // Add log
                onAguaTabChange();
                break;
            case "gas":
                console.log("Calling onGasTabChange..."); // Add log
                onGasTabChange();
                break;
            case "materiais":
                console.log("Calling onMateriaisTabChange..."); // Add log
                onMateriaisTabChange();
                break;
            case "gestao":
                console.log("Calling onGestaoTabChange..."); // Add log
                onGestaoTabChange();
                break;
            case "relatorio":
                console.log("Calling onRelatorioTabChange..."); // Add log
                onRelatorioTabChange();
                break;
            // ADICIONADO
            case "usuarios":
                console.log("Calling onUsuariosTabChange..."); // Add log
                onUsuariosTabChange();
                break;
        }
    }));

    document.querySelector("main").addEventListener("click", (e) => {
        const removeBtn = e.target.closest("button.btn-remove[data-id]");
        if (removeBtn) {
             // Determina o alertId com base no tipo
             let alertId = 'alert-gestao'; // Default para gestão
             const type = removeBtn.dataset.type;
             if (type === 'agua') alertId = 'alert-agua-lista'; // Alerta na lista de histórico/status
             else if (type === 'gas') alertId = 'alert-gas-lista'; // Alerta na lista de histórico/status
             else if (type === 'materiais') alertId = `alert-${removeBtn.closest('[id^="subview-"]').id.split('-')[1]}`; // Tenta pegar da subview (para-separar, etc.)
             else if (type === 'unidade') alertId = 'alert-gestao'; // Mantém gestão
             else if (type === 'entrada-agua') alertId = 'alert-agua'; // Alerta na aba principal
             else if (type === 'entrada-gas') alertId = 'alert-gas'; // Alerta na aba principal

             console.log(`openConfirmDeleteModal called with type: ${type}, alertId: ${alertId}`);

             openConfirmDeleteModal(
                removeBtn.dataset.id,
                type,
                removeBtn.dataset.details,
                alertId // Passa o ID do alerta correto
                // 'collectionRef' e 'isInicial' serão tratados dentro de openConfirmDeleteModal/getDeleteInfo
             );
        }
    });

    // CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
    if (DOM_ELEMENTS.btnCancelDelete)
        DOM_ELEMENTS.btnCancelDelete.addEventListener("click", () => {
             // CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
             if(DOM_ELEMENTS.confirmDeleteModal) DOM_ELEMENTS.confirmDeleteModal.style.display = "none";
         });

    // Initial listeners setup for all modules regardless of the starting tab
    console.log("Initializing listeners for all modules..."); // Add log
    initDashboardListeners();
    initAguaListeners();
    initGasListeners();
    initMateriaisListeners();
    initGestaoListeners();
    initRelatoriosListeners();
    // ADICIONADO
    initUsuariosListeners();
}

// ================================================================
// EXPORTAÇÕES CORRETAS
// ================================================================
export {
    renderUIModules,
    renderUnidadeControls,
    initAllListeners,
    // CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS (não precisa exportar, é usado internamente nos módulos)
    // DOM_ELEMENTS,
    findDOMElements, // Necessário para app.js
    updateLastUpdateTime, // Necessário para app.js
    showAlert // Importado de dom-helpers e re-exportado para uso no app.js
};

