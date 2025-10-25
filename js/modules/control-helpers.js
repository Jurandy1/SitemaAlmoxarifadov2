// js/modules/control-helpers.js
import { getUnidades } from "../utils/cache.js";
// CORREÇÃO: Importa explicitamente todas as funções e objetos necessários do dom-helpers
import { DOM_ELEMENTS, switchTab, findDOMElements, showAlert, switchSubTabView, filterTable, updateLastUpdateTime, handleSaldoFilterUI, openConfirmDeleteModal } from "../utils/dom-helpers.js";
import { onAguaTabChange, initAguaListeners } from "./agua-control.js";
import { onGasTabChange, initGasListeners } from "./gas-control.js";
import { onMateriaisTabChange, initMateriaisListeners } from "./materiais.js";
import { onGestaoTabChange, initGestaoListeners } from "./gestao.js";
import { onRelatorioTabChange, initRelatoriosListeners } from "./relatorios.js";
import { initDashboardListeners, renderDashboard, startDashboardRefresh, stopDashboardRefresh } from "./dashboard.js";
import { getTodayDateString } from "../utils/formatters.js";

// =========================================================================
// FUNÇÕES DE CONTROLE GERAL
// =========================================================================

/**
 * Função principal para orquestrar as renderizações dos módulos após os dados serem carregados.
 */
// CORREÇÃO: Removido 'export' daqui para evitar duplicata
function renderUIModules() {
    renderUnidadeControls();
    
    // Renderiza a UI da aba ativa
    if (DOM_ELEMENTS.contentPanes) {
         DOM_ELEMENTS.contentPanes.forEach(pane => {
            if (!pane.classList.contains('hidden')) {
                const tabName = pane.id.replace('content-', '');
                switch (tabName) {
                    case 'dashboard':
                        // O dashboard é renderizado pelo listener, mas garante o refresh
                        renderDashboard(); 
                        break;
                    case 'agua':
                        onAguaTabChange();
                        break;
                    case 'gas':
                        onGasTabChange();
                        break;
                    case 'materiais':
                        onMateriaisTabChange();
                        break;
                    case 'gestao':
                        onGestaoTabChange();
                        break;
                    case 'relatorio':
                        onRelatorioTabChange();
                        break;
                }
            }
         });
    }
}

/**
 * Popula os selects de unidade em todos os módulos.
 */
export function renderUnidadeControls() {
    const unidades = getUnidades();
    
    // Lista de selects que precisam ser preenchidos
    const selectsToPopulate = [
        { el: DOM_ELEMENTS.selectUnidadeAgua, service: 'atendeAgua', includeAll: false, includeSelecione: true, filterType: null },
        { el: DOM_ELEMENTS.selectUnidadeGas, service: 'atendeGas', includeAll: false, includeSelecione: true, filterType: null },
        { el: DOM_ELEMENTS.selectUnidadeMateriais, service: 'atendeMateriais', includeAll: false, includeSelecione: true, filterType: null },
        { el: document.getElementById('select-previsao-unidade-agua-v2'), service: 'atendeAgua', includeAll: false, includeSelecione: false, filterType: null, useIdAsValue: true },
        { el: document.getElementById('select-previsao-unidade-gas-v2'), service: 'atendeGas', includeAll: false, includeSelecione: false, filterType: null, useIdAsValue: true },
        { el: document.getElementById('select-exclusao-agua'), service: 'atendeAgua', includeAll: false, includeSelecione: false, filterType: null, useIdAsValue: true },
        { el: document.getElementById('select-exclusao-gas'), service: 'atendeGas', includeAll: false, includeSelecione: false, filterType: null, useIdAsValue: true },
    ];
    
    selectsToPopulate.forEach(({ el, service, includeAll, includeSelecione, filterType, useIdAsValue }) => {
        if (!el) return;

        let unidadesFiltradas = unidades.filter(u => {
            const atendeServico = service ? (u[service] ?? true) : true;
            let tipoUnidadeNormalizado = (u.tipo || '').toUpperCase();
            if (tipoUnidadeNormalizado === 'SEMCAS') tipoUnidadeNormalizado = 'SEDE';
            const tipoCorreto = !filterType || tipoUnidadeNormalizado === (filterType || '').toUpperCase();
            return atendeServico && tipoCorreto;
        });

        const grupos = unidadesFiltradas.reduce((acc, unidade) => { 
            let tipo = (unidade.tipo || 'Sem Tipo').toUpperCase(); 
            if (tipo === 'SEMCAS') tipo = 'SEDE';
            if (!acc[tipo]) acc[tipo] = []; 
            acc[tipo].push(unidade); 
            return acc; 
        }, {});
        const tiposOrdenados = Object.keys(grupos).sort();
        
        let html = '';
        if (includeSelecione) {
            html += '<option value="">-- Selecione --</option>';
        }
        if (includeAll) {
             html += '<option value="todas">Todas as Unidades</option>';
        }

        tiposOrdenados.forEach(tipo => {
            html += `<optgroup label="${tipo}">`;
            grupos[tipo].sort((a,b) => a.nome.localeCompare(b.nome)).forEach(unidade => { 
                const optionValue = useIdAsValue ? unidade.id : `${unidade.id}|${unidade.nome}|${unidade.tipo}`;
                html += `<option value="${optionValue}">${unidade.nome}</option>`; 
            });
            html += `</optgroup>`;
        });
        el.innerHTML = html;
    });

    // Popula selects de tipo (apenas para previsão)
    const selectTipoAgua = document.getElementById(`select-previsao-tipo-agua`);
    const selectTipoGas = document.getElementById(`select-previsao-tipo-gas`);
    
    if (selectTipoAgua || selectTipoGas) {
        const uniqueTypes = [...new Set(unidades.map(u => {
            let tipo = (u.tipo || 'Sem Tipo').toUpperCase();
            return tipo === 'SEMCAS' ? 'SEDE' : tipo;
        }))].sort();

        let html = '<option value="">-- Selecione o Tipo --</option>';
        uniqueTypes.forEach(tipo => {
            html += `<option value="${tipo}">${tipo}</option>`;
        });
        if (selectTipoAgua) selectTipoAgua.innerHTML = html;
        if (selectTipoGas) selectTipoGas.innerHTML = html;
    }
}

/**
 * Função que orquestra todos os listeners do DOM.
 */
export function initAllListeners() {
    // Listeners Globais
    DOM_ELEMENTS.navButtons.forEach(button => button.addEventListener('click', () => {
        stopDashboardRefresh(); // Para o refresh se mudar de aba
        switchTab(button.dataset.tab);
        // Lógica de inicialização de cada módulo (para garantir o estado inicial)
        switch (button.dataset.tab) {
            case 'dashboard':
                initDashboardListeners(); // Garante listeners de filtro
                startDashboardRefresh();
                renderDashboard();
                break;
            case 'agua':
                onAguaTabChange();
                break;
            case 'gas':
                onGasTabChange();
                break;
            case 'materiais':
                onMateriaisTabChange();
                break;
            case 'gestao':
                onGestaoTabChange();
                break;
            case 'relatorio':
                onRelatorioTabChange();
                break;
        }
    }));
    
    // Listeners de Exclusão (Centralizados via DOM_HELPERS)
    document.querySelector('main').addEventListener('click', (e) => {
         const removeBtn = e.target.closest('button.btn-remove[data-id]');
         if (removeBtn) {
             openConfirmDeleteModal(
                 removeBtn.dataset.id, 
                 removeBtn.dataset.type, 
                 removeBtn.dataset.details, 
                 // Necessário forçar o alerta para o painel correto em caso de movimentação
                 removeBtn.dataset.type === 'agua' ? 'alert-agua' : (removeBtn.dataset.type === 'gas' ? 'alert-gas' : 'alert-gestao')
            );
         }
    });
    if (DOM_ELEMENTS.btnCancelDelete) DOM_ELEMENTS.btnCancelDelete.addEventListener('click', () => DOM_ELEMENTS.confirmDeleteModal.style.display = 'none');
    
    // Inicialização de Listeners Específicos de Módulos
    initDashboardListeners();
    initAguaListeners();
    initGasListeners();
    initMateriaisListeners();
    initGestaoListeners();
    initRelatoriosListeners();
}

// CORREÇÃO ESSENCIAL: Exporta DOM_ELEMENTS e findDOMElements para o app.js
// E mantém a exportação ÚNICA de renderUIModules
export { 
    renderUIModules, 
    renderUnidadeControls, 
    initAllListeners, 
    DOM_ELEMENTS, 
    findDOMElements, 
    updateLastUpdateTime 
};
