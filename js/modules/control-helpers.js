// js/modules/control-helpers.js
import { getUnidades } from "../utils/cache.js";
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
                }
            }
        });
    }
}

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
    DOM_ELEMENTS.navButtons.forEach(button => button.addEventListener("click", () => {
        stopDashboardRefresh(); 
        switchTab(button.dataset.tab); // This logs "Switching to tab: ..."

        switch (button.dataset.tab) {
            case "dashboard":
                console.log("Calling initDashboardListeners, startDashboardRefresh, renderDashboard..."); // Add log
                initDashboardListeners();
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
        }
    }));

    document.querySelector("main").addEventListener("click", (e) => {
        const removeBtn = e.target.closest("button.btn-remove[data-id]");
        // Debugging: Log the button dataset if found
        // if (removeBtn) {
        //     console.log("Remove button clicked, dataset:", removeBtn.dataset);
        // }
        if (removeBtn) {
             // Determine alert ID based on type
             let alertId = 'alert-gestao'; // Default
             if (removeBtn.dataset.type === 'agua') alertId = 'alert-agua';
             else if (removeBtn.dataset.type === 'gas') alertId = 'alert-gas';
             else if (removeBtn.dataset.type === 'materiais') alertId = 'alert-materiais'; // Added case
             // Add cases for 'unidade' if needed, though default might be okay

             console.log(`openConfirmDeleteModal called with type: ${removeBtn.dataset.type}, alertId: ${alertId}`); // Log added

             openConfirmDeleteModal(
                removeBtn.dataset.id,
                removeBtn.dataset.type,
                removeBtn.dataset.details,
                alertId // Use the determined alert ID
                // Pass collectionRef and isInicial if applicable (modified openConfirmDeleteModal in dom-helpers needed)
             );
        }
    });

    if (DOM_ELEMENTS.btnCancelDelete) 
        DOM_ELEMENTS.btnCancelDelete.addEventListener("click", () => DOM_ELEMENTS.confirmDeleteModal.style.display = "none");
    
    // Initial listeners setup for all modules regardless of the starting tab
    console.log("Initializing listeners for all modules..."); // Add log
    initDashboardListeners();
    initAguaListeners();
    initGasListeners();
    initMateriaisListeners();
    initGestaoListeners();
    initRelatoriosListeners();
}

// ================================================================
// EXPORTAÇÕES CORRETAS
// ================================================================
export { 
    renderUIModules, 
    renderUnidadeControls, 
    initAllListeners, 
    DOM_ELEMENTS, 
    findDOMElements, 
    updateLastUpdateTime, 
    showAlert // Importado de dom-helpers e re-exportado para uso no app.js
};
