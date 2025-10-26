// js/utils/dom-helpers.js
import { formatTimestampComTempo } from "./formatters.js";
import { getCurrentStatusFilter, setDeleteInfo } from "./cache.js";

// Variáveis de estado da UI e referências do DOM
let visaoAtiva = 'dashboard'; 
let domReady = false;
let DOM_ELEMENTS = {}; // Objeto que armazenará todas as referências do DOM

/**
 * Busca todos os elementos do DOM e armazena em DOM_ELEMENTS.
 */
function findDOMElements() {
    // Definindo o mapeamento de IDs/Classes para nomes de variáveis
    const mappings = [
        // Globais e Navegação
        ['#connectionStatus', 'connectionStatusEl'],
        ['#last-update-time', 'lastUpdateTimeEl'],
        ['.nav-btn', 'navButtons', true], // true para All
        ['main > div[id^="content-"]', 'contentPanes', true],
        // Dashboard
        ['#dashboard-nav-controls', 'dashboardNavControls'],
        ['#dashboard-materiais-prontos', 'dashboardMateriaisProntosContainer'],
        ['#btn-clear-dashboard-filter', 'btnClearDashboardFilter'],
        ['#dashboard-materiais-title', 'dashboardMateriaisTitle'],
        ['#dashboard-materiais-list', 'dashboardMateriaisListContainer'],
        ['#loading-materiais-dashboard', 'loadingMateriaisDashboard'],
        ['#dashboard-estoque-agua', 'dashboardEstoqueAguaEl'],
        ['#dashboard-estoque-gas', 'dashboardEstoqueGasEl'],
        ['#dashboard-materiais-separacao-count', 'dashboardMateriaisSeparacaoCountEl'],
        ['#dashboard-materiais-retirada-count', 'dashboardMateriaisRetiradaCountEl'],
        // Água Summary
        ['#summary-agua-pendente', 'summaryAguaPendente'],
        ['#summary-agua-entregue', 'summaryAguaEntregue'],
        ['#summary-agua-recebido', 'summaryAguaRecebido'],
        // Gás Summary
        ['#summary-gas-pendente', 'summaryGasPendente'],
        ['#summary-gas-entregue', 'summaryGasEntregue'],
        ['#summary-gas-recebido', 'summaryGasRecebido'],
        // Gestão
        ['#table-gestao-unidades', 'tableGestaoUnidades'],
        ['#alert-gestao', 'alertGestao'],
        ['#textarea-bulk-unidades', 'textareaBulkUnidades'],
        ['#btn-bulk-add-unidades', 'btnBulkAddUnidades'],
        ['#filtro-unidade-nome', 'filtroUnidadeNome'],
        ['#filtro-unidade-tipo', 'filtroUnidadeTipo'],
        // Modais e Exclusão
        ['#confirm-delete-modal', 'confirmDeleteModal'],
        ['#btn-cancel-delete', 'btnCancelDelete'],
        ['#btn-confirm-delete', 'btnConfirmDelete'],
        ['#delete-details', 'deleteDetailsEl'],
        ['#delete-warning-unidade', 'deleteWarningUnidadeEl'],
        ['#delete-warning-inicial', 'deleteWarningInicialEl'],
        // Água/Gás - Estoque
        ['#estoque-agua-inicial', 'estoqueAguaInicialEl'],
        ['#estoque-agua-entradas', 'estoqueAguaEntradasEl'],
        ['#estoque-agua-saidas', 'estoqueAguaSaidasEl'],
        ['#estoque-agua-atual', 'estoqueAguaAtualEl'],
        ['#loading-estoque-agua', 'loadingEstoqueAguaEl'],
        ['#resumo-estoque-agua', 'resumoEstoqueAguaEl'],
        ['#btn-abrir-inicial-agua', 'btnAbrirInicialAgua'],
        ['#form-inicial-agua-container', 'formInicialAguaContainer'],
        ['#form-inicial-agua', 'formInicialAgua'],
        ['#input-inicial-qtd-agua', 'inputInicialQtdAgua'],
        ['#input-inicial-responsavel-agua', 'inputInicialResponsavelAgua'],
        ['#btn-submit-inicial-agua', 'btnSubmitInicialAgua'],
        ['#alert-inicial-agua', 'alertInicialAgua'],
        ['#estoque-gas-inicial', 'estoqueGasInicialEl'],
        ['#estoque-gas-entradas', 'estoqueGasEntradasEl'],
        ['#estoque-gas-saidas', 'estoqueGasSaidasEl'],
        ['#estoque-gas-atual', 'estoqueGasAtualEl'],
        ['#loading-estoque-gas', 'loadingEstoqueGasEl'],
        ['#resumo-estoque-gas', 'resumoEstoqueGasEl'],
        ['#btn-abrir-inicial-gas', 'btnAbrirInicialGas'],
        ['#form-inicial-gas-container', 'formInicialGasContainer'],
        ['#form-inicial-gas', 'formInicialGas'],
        ['#input-inicial-qtd-gas', 'inputInicialQtdGas'],
        ['#input-inicial-responsavel-gas', 'inputInicialResponsavelGas'],
        ['#btn-submit-inicial-gas', 'btnSubmitInicialGas'],
        ['#alert-inicial-gas', 'alertInicialGas'],
        // Água/Gás - Movimentação
        ['#form-agua', 'formAgua'],
        ['#select-unidade-agua', 'selectUnidadeAgua'],
        ['#select-tipo-agua', 'selectTipoAgua'],
        ['#input-data-agua', 'inputDataAgua'],
        ['#input-responsavel-agua', 'inputResponsavelAgua'],
        ['#btn-submit-agua', 'btnSubmitAgua'],
        ['#alert-agua', 'alertAgua'],
        ['#table-status-agua', 'tableStatusAgua'],
        ['#alert-agua-lista', 'alertAguaLista'],
        ['#input-qtd-entregue-agua', 'inputQtdEntregueAgua'],
        ['#input-qtd-retorno-agua', 'inputQtdRetornoAgua'],
        ['#form-group-qtd-entregue-agua', 'formGroupQtdEntregueAgua'],
        ['#form-group-qtd-retorno-agua', 'formGroupQtdRetornoAgua'],
        ['#unidade-saldo-alerta-agua', 'unidadeSaldoAlertaAgua'],
        ['#form-entrada-agua', 'formEntradaAgua'],
        ['#input-data-entrada-agua', 'inputDataEntradaAgua'],
        ['#btn-submit-entrada-agua', 'btnSubmitEntradaAgua'],
        ['#input-responsavel-entrada-agua', 'inputResponsavelEntradaAgua'],
        ['#input-qtd-entrada-agua', 'inputQtdEntradaAgua'],
        ['#input-nf-entrada-agua', 'inputNfEntradaAgua'],
        ['#table-historico-agua-all', 'tableHistoricoAguaAll'],
        // Gás - Movimentação
        ['#form-gas', 'formGas'],
        ['#select-unidade-gas', 'selectUnidadeGas'],
        ['#select-tipo-gas', 'selectTipoGas'],
        ['#input-data-gas', 'inputDataGas'],
        ['#input-responsavel-gas', 'inputResponsavelGas'],
        ['#btn-submit-gas', 'btnSubmitGas'],
        ['#alert-gas', 'alertGas'],
        ['#table-status-gas', 'tableStatusGas'],
        ['#alert-gas-lista', 'alertGasLista'],
        ['#input-qtd-entregue-gas', 'inputQtdEntregueGas'],
        ['#input-qtd-retorno-gas', 'inputQtdRetornoGas'],
        ['#form-group-qtd-entregue-gas', 'formGroupQtdEntregueGas'],
        ['#form-group-qtd-retorno-gas', 'formGroupQtdRetornoGas'],
        ['#unidade-saldo-alerta-gas', 'unidadeSaldoAlertaGas'],
        ['#form-entrada-gas', 'formEntradaGas'],
        ['#input-data-entrada-gas', 'inputDataEntradaGas'],
        ['#btn-submit-entrada-gas', 'btnSubmitEntradaGas'],
        ['#input-responsavel-entrada-gas', 'inputResponsavelEntradaGas'],
        ['#input-qtd-entrada-gas', 'inputQtdEntradaGas'],
        ['#input-nf-entrada-gas', 'inputNfEntradaGas'],
        ['#table-historico-gas-all', 'tableHistoricoGasAll'],
        // Previsão - Água
        ['#config-previsao-agua', 'configPrevisaoAguaEl'],
        ['#select-previsao-unidade-agua-v2', 'selectPrevisaoUnidadeAguaEl'],
        ['#select-previsao-tipo-agua', 'selectPrevisaoTipoAguaEl'],
        ['#dias-previsao-agua', 'inputDiasPrevisaoAgua'],
        ['#margem-seguranca-agua', 'inputMargemSegurancaAgua'],
        ['#select-exclusao-agua', 'selectExclusaoAguaEl'],
        ['#btn-adicionar-exclusao-agua', 'btnAddExclusaoAgua'],
        ['#lista-exclusoes-agua', 'listaExclusoesAguaEl'],
        ['#btn-calcular-previsao-agua-v2', 'btnCalcularPrevisaoAguaEl'],
        ['#resultado-previsao-agua-v2', 'resultadoPrevisaoAguaContainer'],
        ['#alertas-previsao-agua', 'alertasPrevisaoAguaEl'],
        ['#resultado-content-agua', 'resultadoContentAguaEl'],
        ['#grafico-previsao-agua', 'graficoPrevisaoAguaEl'],
        // Previsão - Gás
        ['#config-previsao-gas', 'configPrevisaoGasEl'],
        ['#select-previsao-unidade-gas-v2', 'selectPrevisaoUnidadeGasEl'],
        ['#select-previsao-tipo-gas', 'selectPrevisaoTipoGasEl'],
        ['#dias-previsao-gas', 'inputDiasPrevisaoGas'],
        ['#margem-seguranca-gas', 'inputMargemSegurancaGas'],
        ['#select-exclusao-gas', 'selectExclusaoGasEl'],
        ['#btn-adicionar-exclusao-gas', 'btnAddExclusaoGas'],
        ['#lista-exclusoes-gas', 'listaExclusoesGasEl'],
        ['#btn-calcular-previsao-gas-v2', 'btnCalcularPrevisaoGasEl'],
        ['#resultado-previsao-gas-v2', 'resultadoPrevisaoGasContainer'],
        ['#alertas-previsao-gas', 'alertasPrevisaoGasEl'],
        ['#resultado-content-gas', 'resultadoContentGasEl'],
        ['#grafico-previsao-gas', 'graficoPrevisaoGasEl'],
        // Materiais
        ['#form-materiais', 'formMateriais'],
        ['#select-unidade-materiais', 'selectUnidadeMateriais'],
        ['#select-tipo-materiais', 'selectTipoMateriais'],
        ['#input-data-separacao', 'inputDataSeparacao'],
        ['#textarea-itens-materiais', 'textareaItensMateriais'],
        ['#input-responsavel-materiais', 'inputResponsavelMateriais'],
        ['#input-arquivo-materiais', 'inputArquivoMateriais'],
        ['#btn-submit-materiais', 'btnSubmitMateriais'],
        ['#alert-materiais', 'alertMateriais'],
        ['#table-para-separar', 'tableParaSeparar'],
        ['#table-em-separacao', 'tableEmSeparacao'],
        ['#table-pronto-entrega', 'tableProntoEntrega'],
        ['#table-historico-entregues', 'tableHistoricoEntregues'],
        ['#summary-materiais-requisitado', 'summaryMateriaisRequisitado'],
        ['#summary-materiais-separacao', 'summaryMateriaisSeparacao'],
        ['#summary-materiais-retirada', 'summaryMateriaisRetirada'],
        // Modais de Fluxo (Água/Gás/Materiais)
        ['#almoxarifado-responsavel-modal', 'almoxarifadoResponsavelModal'],
        ['#input-almox-responsavel-nome', 'inputAlmoxResponsavelNome'],
        ['#btn-salvar-movimentacao-final', 'btnSalvarMovimentacaoFinal'],
        ['#alert-almox-responsavel', 'alertAlmoxResponsavel'],
        ['#separador-modal', 'separadorModal'],
        ['#input-separador-nome', 'inputSeparadorNome'],
        ['#btn-salvar-separador', 'btnSalvarSeparador'],
        ['#separador-material-id', 'separadorMaterialIdEl'],
        ['#alert-separador', 'alertSeparador'],
        ['#finalizar-entrega-modal', 'finalizarEntregaModal'],
        ['#input-entrega-responsavel-almox', 'inputEntregaResponsavelAlmox'],
        ['#input-entrega-responsavel-unidade', 'inputEntregaResponsavelUnidade'],
        ['#btn-confirmar-finalizacao-entrega', 'btnConfirmarFinalizacaoEntrega'],
        ['#finalizar-entrega-material-id', 'finalizarEntregaMaterialIdEl'],
        ['#alert-finalizar-entrega', 'alertFinalizarEntrega'],
        // Relatório
        ['#relatorio-tipo', 'relatorioTipo'],
        ['#relatorio-data-inicio', 'relatorioDataInicio'],
        ['#relatorio-data-fim', 'relatorioDataFim'],
        ['#btn-gerar-pdf', 'btnGerarPdf'],
        ['#alert-relatorio', 'alertRelatorio'],
    ]; // Linha 209
    // O erro estava aqui. A linha original terminava com um comentário de bloco não encerrado.
    // Eu removi o comentário problemático.

    mappings.forEach(([selector, varName, isAll]) => {
        if (isAll) {
            DOM_ELEMENTS[varName] = document.querySelectorAll(selector);
        } else {
            DOM_ELEMENTS[varName] = document.querySelector(selector);
        }
    });

    // Marca o DOM como pronto
    domReady = true;
    console.log("DOM Elements carregados.");
}

/**
 * Exibe um alerta na interface.
 * @param {string} elementId ID do elemento onde o alerta será exibido.
 * @param {string} message Mensagem a ser exibida.
 * @param {string} type Tipo de alerta ('info', 'success', 'warning', 'error').
 * @param {number} duration Duração em milissegundos.
 */
function showAlert(elementId, message, type = 'info', duration = 5000) {
    if (!domReady) return;

    const el = document.getElementById(elementId);
    if (!el) { console.warn(`Elemento de alerta não encontrado: ${elementId}, Mensagem: ${message}`); return; }
    
    el.className = `alert alert-${type}`; 
    el.innerHTML = message.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>'); // Suporte a markdown negrito
    el.style.display = 'block';
    
    if (el.timeoutId) clearTimeout(el.timeoutId);
    el.timeoutId = setTimeout(() => {
        el.style.display = 'none';
        el.timeoutId = null;
    }, duration);
}

/**
 * Alterna a visualização da aba principal.
 * @param {string} tabName Nome da aba (e.g., 'dashboard', 'agua').
 */
function switchTab(tabName) {
    if (!domReady) return;
    console.log(`Switching to tab: ${tabName}`);

    DOM_ELEMENTS.navButtons.forEach(btn => btn.classList.remove('active'));
    const activeBtn = document.querySelector(`.nav-btn[data-tab="${tabName}"]`);
    if (activeBtn) activeBtn.classList.add('active');
    
    DOM_ELEMENTS.contentPanes.forEach(pane => pane.classList.add('hidden'));
    const activePane = document.getElementById(`content-${tabName}`);
    if(activePane) activePane.classList.remove('hidden');
    
    visaoAtiva = tabName; 
    
    // Atualiza ícones Lucide
    if (typeof lucide !== 'undefined' && typeof lucide.createIcons === 'function') { lucide.createIcons(); }
}

/**
 * Alterna a visualização da sub-aba (dentro de Água, Gás, Materiais).
 * @param {string} tabPrefix Prefixo da aba principal (e.g., 'agua').
 * @param {string} subViewName Nome da sub-view (e.g., 'movimentacao-agua').
 */
function switchSubTabView(tabPrefix, subViewName) {
    if (!domReady) return; 
    document.querySelectorAll(`#sub-nav-${tabPrefix} .sub-nav-btn`).forEach(btn => {
        btn.classList.toggle('active', btn.dataset.subview === subViewName);
    });
    document.querySelectorAll(`#content-${tabPrefix} > div[id^="subview-"]`).forEach(pane => {
         pane.classList.toggle('hidden', pane.id !== `subview-${subViewName}`);
    });
    if (typeof lucide !== 'undefined' && typeof lucide.createIcons === 'function') { lucide.createIcons(); } 
}

/**
 * Filtra uma tabela HTML.
 * @param {HTMLInputElement} inputEl Elemento de input do filtro.
 * @param {string} tableBodyId ID do <tbody> da tabela.
 */
function filterTable(inputEl, tableBodyId) {
    const searchTerm = inputEl.value; // Removido normalizeString para otimização, usando normalizeString dentro do loop
    const tableBody = document.getElementById(tableBodyId);
    if (!tableBody) return;
    const rows = tableBody.querySelectorAll('tr');
    
    rows.forEach(row => {
        if (row.querySelectorAll('td').length > 1 && !row.classList.contains('editing-row') && !row.classList.contains('obs-row') && !row.classList.contains('separador-row')) { 
            const rowText = row.textContent.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
            const isMatch = rowText.includes(searchTerm.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""));
            row.style.display = isMatch ? '' : 'none';
            
            // Lógica para esconder/mostrar linhas associadas (obs e separador)
            let nextRow = row.nextElementSibling;
            while(nextRow && (nextRow.classList.contains('obs-row') || nextRow.classList.contains('separador-row'))) {
                nextRow.style.display = isMatch ? '' : 'none';
                nextRow = nextRow.nextElementSibling;
            }
        }
    });
}

/**
 * Atualiza o horário de última atualização na UI.
 */
function updateLastUpdateTime() {
     if (!domReady || !DOM_ELEMENTS.lastUpdateTimeEl) return; 
    const now = new Date();
    const formattedDate = now.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    DOM_ELEMENTS.lastUpdateTimeEl.textContent = `Atualizado: ${formattedDate}`;
}


/**
 * Altera o status visual do filtro de saldo.
 * @param {string} itemType 'agua' ou 'gas'.
 * @param {Event} e Evento de clique.
 * @param {Function} renderCallback Função de renderização (e.g., renderAguaStatus).
 */
function handleSaldoFilterUI(itemType, e, renderCallback) {
    const button = e.target.closest('button.btn-saldo-filter');
    if (!button) return;

    const newFilter = button.dataset.filter;
    const currentFilter = getCurrentStatusFilter(itemType);

    // Se clicar no mesmo, não faz nada
    if (newFilter === currentFilter) return;

    // Remove 'active' de todos e aplica os estilos base novamente
    document.querySelectorAll(`#filtro-saldo-${itemType}-controls button`).forEach(btn => {
        btn.classList.remove('active', 'bg-blue-600', 'text-white', 'font-semibold');
        // Garante que os estilos de cor corretos são aplicados quando inativo
        if (btn.dataset.filter === 'devendo') {
            btn.classList.add('btn-warning', 'border', 'border-red-400', 'bg-red-50', 'text-red-700', 'hover:bg-red-100');
        } else if (btn.dataset.filter === 'credito') {
            btn.classList.add('btn-info', 'border', 'border-blue-400', 'bg-blue-50', 'text-blue-700', 'hover:bg-blue-100');
        } else {
             btn.classList.add('btn-secondary');
        }
    });

    // Aplica 'active' no botão clicado
    button.classList.add('active');
    
    // Remove os estilos inativos específicos para aplicar os estilos ativos
    if (button.dataset.filter === 'devendo') {
        button.classList.remove('border-red-400', 'bg-red-50', 'text-red-700', 'hover:bg-red-100');
    } else if (button.dataset.filter === 'credito') {
        button.classList.remove('border-blue-400', 'bg-blue-50', 'text-blue-700', 'hover:bg-blue-100');
    } else if (button.dataset.filter === 'all' || button.dataset.filter === 'zero') {
         button.classList.remove('btn-secondary');
    }

    // Chama o callback de renderização do módulo principal
    renderCallback(newFilter);
}

/**
 * Abre o modal para confirmação de exclusão.
 */
async function openConfirmDeleteModal(id, type, details = null, alertElementId = 'alert-gestao', isInicial = false) {
    if (!id || !type || !domReady) return; 

    // O alertElementId deve ser passado no lugar de collectionRef.
    let collectionRef = null; // Não precisamos disso no modal, apenas no db-utils

    let detailsText = details ? `${details} (ID: ${id.substring(0,6)}...)` : `ID: ${id.substring(0,6)}...`;
    
    // Define a informação de exclusão no cache
    setDeleteInfo({ id, type, collectionRef, alertElementId, details, isInicial }); 
    
    // Prepara o modal
    DOM_ELEMENTS.deleteDetailsEl.textContent = `Detalhes: ${detailsText}`;
    DOM_ELEMENTS.deleteWarningUnidadeEl.style.display = (type === 'unidade') ? 'block' : 'none'; 
    DOM_ELEMENTS.deleteWarningInicialEl.style.display = isInicial ? 'block' : 'none'; 
    DOM_ELEMENTS.confirmDeleteModal.style.display = 'flex'; 
}


export {
    DOM_ELEMENTS,
    findDOMElements,
    showAlert,
    switchTab,
    switchSubTabView,
    filterTable,
    updateLastUpdateTime,
    handleSaldoFilterUI,
    openConfirmDeleteModal
};
