// js/utils/dom-helpers.js
import { formatTimestampComTempo } from "./formatters.js";
import { getCurrentStatusFilter, setDeleteInfo, getUserRole } from "./cache.js";
import { auth } from "../services/firestore-service.js"; // Importar auth para pegar o email

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

        // NOVO: Permissões/Login
        ['#auth-modal', 'authModal'],
        ['#btn-login-anonimo', 'btnLoginAnonimo'],
        ['#form-login', 'formLogin'],
        ['#input-login-email', 'inputLoginEmail'],
        ['#input-login-password', 'inputLoginPassword'],
        ['#alert-login', 'alertLogin'],
        ['#btn-submit-login', 'btnSubmitLogin'], 
        ['#btn-logout', 'btnLogout'],
        ['#user-email-display', 'userEmailDisplayEl'],
        ['#user-role-display', 'userRoleDisplayEl'],
        ['#app-content-wrapper', 'appContentWrapper'], 

        // Dashboard
        ['#dashboard-nav-controls', 'dashboardNavControls'],
        ['#dashboard-materiais-prontos', 'dashboardMateriaisProntosContainer'],
        ['#btn-clear-dashboard-filter', 'btnClearDashboardFilter'],
        ['#dashboard-materiais-title', 'dashboardMateriaisTitle'],
        ['#dashboard-materiais-list', 'dashboardMateriaisListContainer'],
        ['#loading-materiais-dashboard', 'loadingMateriaisDashboard'],
        ['#dashboard-materiais-pager', 'dashboardMateriaisPagerContainer'],
        ['#btn-materiais-prev-page', 'btnMateriaisPrevPage'],
        ['#btn-materiais-next-page', 'btnMateriaisNextPage'],
        ['#materiais-pager-info', 'materiaisPagerInfo'],
        ['#materiais-page-size-select', 'materiaisPageSizeSelect'],
        ['#dashboard-estoque-agua', 'dashboardEstoqueAguaEl'],
        ['#dashboard-estoque-gas', 'dashboardEstoqueGasEl'],
        ['#dashboard-materiais-separacao-count', 'dashboardMateriaisSeparacaoCountEl'],
        ['#dashboard-materiais-retirada-count', 'dashboardMateriaisRetiradaCountEl'],
        ['#dashboard-materiais-prontos-pager', 'dashboardMateriaisProntosPager'],
        ['#btn-geral-prev-page', 'btnGeralPrevPage'],
        ['#btn-geral-next-page', 'btnGeralNextPage'],
        ['#geral-pager-info', 'geralPagerInfo'],
        ['#geral-page-size-select', 'geralPageSizeSelect'],
        ['#dashboard-materiais-prontos-controls', 'dashboardMateriaisProntosControls'],
        ['#btn-filter-todos', 'btnFilterTodos'],
        ['#btn-filter-separacao', 'btnFilterSeparacao'],
        ['#btn-filter-pronto', 'btnFilterPronto'],
        ['#btn-filter-pendente', 'btnFilterPendente'],
        ['#input-busca-materiais-geral', 'inputBuscaMateriaisGeral'],
        // Água Summary
        ['#summary-agua-pendente', 'summaryAguaPendente'],
        ['#summary-agua-entregue', 'summaryAguaEntregue'],
        ['#summary-agua-recebido', 'summaryAguaRecebido'],
        // Água – Resumo de Débitos
        ['#table-debito-agua-resumo', 'tableDebitoAguaResumo'],
        ['#filtro-debito-agua', 'filtroDebitoAgua'],
        ['#btn-debito-agua', 'btnDebitoAgua'],
        ['#btn-credito-agua', 'btnCreditoAgua'],
        ['#btn-ver-status-agua', 'btnVerStatusAgua'],
        ['#btn-inner-agua-resumo', 'btnInnerAguaResumo'],
        ['#btn-inner-agua-lancamento', 'btnInnerAguaLancamento'],
        ['#inner-agua-resumo', 'innerAguaResumo'],
        ['#inner-agua-lancamento', 'innerAguaLancamento'],
        // Gás Summary
        ['#summary-gas-pendente', 'summaryGasPendente'],
        ['#summary-gas-entregue', 'summaryGasEntregue'],
        ['#summary-gas-recebido', 'summaryGasRecebido'],
        // Gás – Resumo de Débitos
        ['#table-debito-gas-resumo', 'tableDebitoGasResumo'],
        ['#filtro-debito-gas', 'filtroDebitoGas'],
        ['#btn-debito-gas', 'btnDebitoGas'],
        ['#btn-credito-gas', 'btnCreditoGas'],
        ['#btn-ver-status-gas', 'btnVerStatusGas'],
        ['#btn-inner-gas-resumo', 'btnInnerGasResumo'],
        ['#btn-inner-gas-lancamento', 'btnInnerGasLancamento'],
        ['#inner-gas-resumo', 'innerGasResumo'],
        ['#inner-gas-lancamento', 'innerGasLancamento'],
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
        // NOVO PONTO 1: Histórico de Entradas
        ['#subview-historico-estoque-agua', 'subviewHistoricoEstoqueAgua'],
        ['#table-historico-estoque-agua', 'tableHistoricoEstoqueAgua'],
        ['#filtro-historico-estoque-agua', 'filtroHistoricoEstoqueAgua'],
        ['#alert-historico-estoque-agua', 'alertHistoricoEstoqueAgua'],
        
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
        // NOVO PONTO 1: Histórico de Entradas
        ['#subview-historico-estoque-gas', 'subviewHistoricoEstoqueGas'],
        ['#table-historico-estoque-gas', 'tableHistoricoEstoqueGas'],
        ['#filtro-historico-estoque-gas', 'filtroHistoricoEstoqueGas'],
        ['#alert-historico-estoque-gas', 'alertHistoricoEstoqueGas'],

        // CORRIGIDO/ADICIONADO: Análise de Consumo - Água
        ['#select-modo-agrupamento-agua', 'selectModoAgrupamentoAgua'],
        ['#analise-agrupamento-tipo-container-agua', 'analiseAgrupamentoTipoContainerAgua'],
        ['#analise-agrupamento-unidade-container-agua', 'analiseAgrupamentoUnidadeContainerAgua'],
        ['#analise-agrupamento-tipo-agua', 'analiseAgrupamentoTipoAgua'],
        ['#analise-agrupamento-unidade-agua', 'analiseAgrupamentoUnidadeAgua'],
        ['#analise-granularidade-agua', 'analiseGranularidadeAgua'],
        ['#btn-analisar-consumo-agua', 'btnAnalisarConsumoAgua'],
        ['#alert-analise-consumo-agua', 'alertAnaliseConsumoAgua'],
        
        // CORRIGIDO/ADICIONADO: Análise de Consumo - Gás
        ['#select-modo-agrupamento-gas', 'selectModoAgrupamentoGas'],
        ['#analise-agrupamento-tipo-container-gas', 'analiseAgrupamentoTipoContainerGas'],
        ['#analise-agrupamento-unidade-container-gas', 'analiseAgrupamentoUnidadeContainerGas'],
        ['#analise-agrupamento-tipo-gas', 'analiseAgrupamentoTipoGas'],
        ['#analise-agrupamento-unidade-gas', 'analiseAgrupamentoUnidadeGas'],
        ['#analise-granularidade-gas', 'analiseGranularidadeGas'],
        ['#btn-analisar-consumo-gas', 'btnAnalisarConsumoGas'],
        ['#alert-analise-consumo-gas', 'alertAnaliseConsumoGas'],
        
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
        // Alertas das subviews
        ['#alert-para-separar', 'alertParaSeparar'],
        ['#alert-em-separacao', 'alertEmSeparacao'],
        ['#alert-pronto-entrega', 'alertProntoEntrega'],
        ['#alert-historico-entregues', 'alertHistoricoEntregues'],
        // Tabelas das subviews
        ['#table-para-separar', 'tableParaSeparar'],
        ['#table-em-separacao', 'tableEmSeparacao'],
        ['#table-pronto-entrega', 'tableProntoEntrega'],
        ['#table-historico-entregues', 'tableHistoricoEntregues'],
        // Summaries
        ['#summary-materiais-requisitado', 'summaryMateriaisRequisitado'],
        ['#summary-materiais-separacao', 'summaryMateriaisSeparacao'],
        ['#summary-materiais-retirada', 'summaryMateriaisRetirada'],
        // Botões e subviews de Materiais
        ['#sub-nav-materiais', 'subNavMateriais'],
        ['#subview-lancar-materiais', 'subviewLancarMateriais'],
        ['#subview-para-separar', 'subviewParaSeparar'],
        ['#subview-em-separacao', 'subviewEmSeparacao'],
        ['#subview-pronto-entrega', 'subviewProntoEntrega'],
        ['#subview-historico-entregues', 'subviewHistoricoEntregues'],
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
        // Parâmetros de custo do relatório (opcional)
        ['#relatorio-custo-galao', 'relatorioCustoGalao'],
        ['#relatorio-litros-por-galao', 'relatorioLitrosPorGalao'],
        ['#relatorio-custo-industrial-energia', 'relatorioCustoIndustrialEnergia'],
        ['#relatorio-custo-industrial-filtro', 'relatorioCustoIndustrialFiltro'],
        ['#relatorio-custo-filtro-rede', 'relatorioCustoFiltroRede'],
        ['#relatorio-limite-baixo-litros', 'relatorioLimiteBaixoLitros'],
        ['#relatorio-limite-alto-litros', 'relatorioLimiteAltoLitros'],

        // ADICIONADO: Gestão de Usuários
        ['#alert-usuarios', 'alertUsuarios'],
        ['#filtro-usuarios', 'filtroUsuarios'],
        ['#table-usuarios', 'tableUsuarios'],
        // Novos elementos para adicionar usuário
        ['#form-add-user', 'formAddUser'],
        ['#input-add-user-email', 'inputAddUserEmail'],
        ['#input-add-user-password', 'inputAddUserPassword'],
        ['#select-add-user-role', 'selectAddUserRole'],
        ['#btn-submit-add-user', 'btnSubmitAddUser'],
        ['#alert-add-user', 'alertAddUser'],

        // NOVOS ELEMENTOS: ASSISTÊNCIA SOCIAL (content-social)
        ['#sub-nav-social-main', 'subNavSocialMain'],
        ['#social-module-container', 'socialModuleContainer'],
        ['#social-submodule-cesta-basica', 'socialSubmoduleCestaBasica'],
        ['#social-submodule-enxoval', 'socialSubmoduleEnxoval'],
        ['#social-submodule-importar-dados', 'socialSubmoduleImportarDados'],
        // CESTA BÁSICA
        ['#sub-nav-cesta', 'subNavCesta'],
        ['#form-cesta-lancamento', 'formCestaLancamento'],
        ['#cesta-data', 'cestaData'],
        ['#cesta-destinatario', 'cestaDestinatario'],
        ['#cesta-quantidade', 'cestaQuantidade'],
        ['#cesta-unidade', 'cestaUnidade'],
        ['#cesta-categoria', 'cestaCategoria'],
        ['#cesta-observacoes', 'cestaObservacoes'],
        ['#cesta-custo', 'cestaCusto'],
        ['#cesta-responsavel', 'cestaResponsavel'],
        ['#cesta-fornecedor', 'cestaFornecedor'],
        ['#btn-submit-cesta-lancamento', 'btnSubmitCestaLancamento'],
        ['#alert-cesta-lancamento', 'alertCestaLancamento'],
        ['#cesta-estoque-resumo', 'cestaEstoqueResumo'],
        
        // NOVOS ELEMENTOS CESTA - ESTOQUE
        ['#form-cesta-entrada', 'formCestaEntrada'],
        ['#cesta-entrada-quantidade', 'cestaEntradaQuantidade'],
        ['#cesta-entrada-data', 'cestaEntradaData'],
        ['#cesta-entrada-responsavel', 'cestaEntradaResponsavel'],
        ['#cesta-entrada-nf', 'cestaEntradaNf'],
        ['#btn-submit-cesta-entrada', 'btnSubmitCestaEntrada'],
        ['#alert-cesta-estoque', 'alertCestaEstoque'],
        ['#table-cesta-estoque-history', 'tableCestaEstoqueHistory'],
        ['#table-cesta-historico', 'tableCestaHistorico'], // Histórico de Movimentações (Saída)
        // NOVOS ELEMENTOS CESTA - RELATÓRIO (CORREÇÃO 1)
        ['#cesta-relatorio-output', 'cestaRelatorioOutput'],
        ['#btn-cesta-gerar-relatorio', 'btnCestaGerarRelatorio'],
        ['#cesta-rel-data-inicio', 'cestaRelDataInicio'],
        ['#cesta-rel-data-fim', 'cestaRelDataFim'],
        ['#cesta-rel-categoria', 'cestaRelCategoria'],
        ['#cesta-relatorio-resumo-texto', 'cestaRelatorioResumoTexto'],


        // ENXOVAL
        ['#sub-nav-enxoval', 'subNavEnxoval'],
        ['#form-enxoval-lancamento', 'formEnxovalLancamento'],
        ['#enxoval-data', 'enxovalData'],
        ['#enxoval-destinatario', 'enxovalDestinatario'],
        ['#enxoval-quantidade', 'enxovalQuantidade'],
        ['#enxoval-categoria', 'enxovalCategoria'],
        ['#enxoval-observacoes', 'enxovalObservacoes'],
        ['#enxoval-memo', 'enxovalMemo'],
        ['#enxoval-responsavel', 'enxovalResponsavel'],
        ['#btn-submit-enxoval-lancamento', 'btnSubmitEnxovalLancamento'],
        ['#alert-enxoval-lancamento', 'alertEnxovalLancamento'],
        ['#enxoval-estoque-resumo', 'enxovalEstoqueResumo'],
        
        // NOVOS ELEMENTOS ENXOVAL - ESTOQUE
        ['#form-enxoval-entrada', 'formEnxovalEntrada'],
        ['#enxoval-entrada-quantidade', 'enxovalEntradaQuantidade'],
        ['#enxoval-entrada-data', 'enxovalEntradaData'],
        ['#enxoval-entrada-responsavel', 'enxovalEntradaResponsavel'],
        ['#enxoval-entrada-nf', 'enxovalEntradaNf'],
        ['#btn-submit-enxoval-entrada', 'btnSubmitEnxovalEntrada'],
        ['#alert-enxoval-estoque', 'alertEnxovalEstoque'],
        ['#table-enxoval-estoque-history', 'tableEnxovalEstoqueHistory'],
        ['#table-enxoval-historico', 'tableEnxovalHistorico'], // Histórico de Movimentações (Saída)
        // NOVOS ELEMENTOS ENXOVAL - RELATÓRIO (CORREÇÃO 1)
        ['#enxoval-relatorio-output', 'enxovalRelatorioOutput'],
        ['#btn-enxoval-gerar-relatorio', 'btnEnxovalGerarRelatorio'],
        ['#enxoval-rel-data-inicio', 'enxovalRelDataInicio'],
        ['#enxoval-rel-data-fim', 'enxovalRelDataFim'],
        ['#enxoval-rel-categoria', 'enxovalRelCategoria'],
        ['#enxoval-relatorio-resumo-texto', 'enxovalRelatorioResumoTexto'],


        // IMPORTAÇÃO
        ['#textarea-social-import', 'textareaSocialImport'],
        ['#btn-social-import-data', 'btnSocialImportData'],
        ['#alert-social-import', 'alertSocialImport'],
    ];

    mappings.forEach(([selector, varName, isAll]) => {
        try {
            if (isAll) {
                DOM_ELEMENTS[varName] = document.querySelectorAll(selector);
            } else {
                DOM_ELEMENTS[varName] = document.querySelector(selector);
            }
        } catch (e) {
            console.error(`Error finding DOM element for selector: ${selector}`, e);
        }
    });

    // Marca o DOM como pronto
    domReady = true;
    console.log("DOM Elements loaded.");
}

/**
 * Exibe um alerta na interface.
 */
function showAlert(elementId, message, type = 'info', duration = 5000) {
    if (!domReady) {
        console.warn(`DOM not ready, alert skipped: ${elementId}, Msg: ${message}`);
        return;
    }

    const el = document.getElementById(elementId);
    if (!el) { console.warn(`Alert element not found: ${elementId}, Message: ${message}`); return; }

    el.className = `alert alert-${type}`;
    el.innerHTML = message.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>'); // Suporte a markdown negrito
    el.style.display = 'block';

    if (el.timeoutId) clearTimeout(el.timeoutId);
    
    if (type !== 'error') {
        el.timeoutId = setTimeout(() => {
            el.style.display = 'none';
            el.timeoutId = null;
        }, duration);
    } else {
        if (!el.querySelector('.close-alert-btn')) {
            const closeButton = document.createElement('button');
            closeButton.innerHTML = '&times;';
            closeButton.className = 'close-alert-btn';
            closeButton.style.cssText = 'float: right; font-size: 1.2rem; line-height: 1; border: none; background: none; cursor: pointer; margin-left: 10px;';
            closeButton.onclick = () => { el.style.display = 'none'; };
            el.insertBefore(closeButton, el.firstChild);
        }
    }
}

/**
 * Alterna a visualização da aba principal.
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

    if (typeof lucide !== 'undefined' && typeof lucide.createIcons === 'function') {
        setTimeout(() => lucide.createIcons(), 50);
    }
}

/**
 * Alterna a visualização da sub-aba (dentro de Água, Gás, Materiais).
 */
function switchSubTabView(tabPrefix, subViewName) {
    if (!domReady) return;

    const navContainer = document.getElementById(`sub-nav-${tabPrefix}`);
    const contentContainer = document.getElementById(`content-${tabPrefix}`);

    if (!navContainer && !contentContainer) { // Adicionado verificação para tab social
        const mainSubContainer = document.getElementById(`social-submodule-${tabPrefix}`);
        if(mainSubContainer) {
            mainSubContainer.querySelectorAll(`div[id^="subview-${tabPrefix}"]`).forEach(pane => {
                pane.classList.toggle('hidden', pane.id !== `subview-${subViewName}`);
            });
            return;
        }
    }

    if (!navContainer || !contentContainer) {
        console.warn(`Containers not found for sub-tab switch: ${tabPrefix}`);
        return;
    }

    navContainer.querySelectorAll('.sub-nav-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.subview === subViewName);
    });

    contentContainer.querySelectorAll(`div[id^="subview-"]`).forEach(pane => {
         pane.classList.toggle('hidden', pane.id !== `subview-${subViewName}`);
    });

    if (typeof lucide !== 'undefined' && typeof lucide.createIcons === 'function') {
         setTimeout(() => lucide.createIcons(), 50);
    }
}

/**
 * Filtra uma tabela HTML.
 */
function filterTable(inputEl, tableBodyId) {
    const searchTerm = inputEl.value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const tableBody = document.getElementById(tableBodyId);
    if (!tableBody) return;
    const rows = tableBody.querySelectorAll('tr');

    rows.forEach(row => {
        if (row.querySelectorAll('td').length > 1 && !row.classList.contains('editing-row') && !row.classList.contains('obs-row') && !row.classList.contains('separador-row')) {
            const rowText = row.textContent.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
            const isMatch = rowText.includes(searchTerm);
            row.style.display = isMatch ? '' : 'none';

            let nextRow = row.nextElementSibling;
            while(nextRow && (nextRow.classList.contains('obs-row') || nextRow.classList.contains('separador-row'))) {
                nextRow.style.display = isMatch ? '' : 'none';
                nextRow = nextRow.nextElementSibling;
            }
        } else if (row.querySelectorAll('th').length > 0) {
             row.style.display = '';
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
    DOM_ELEMENTS.lastUpdateTimeEl.classList.remove('hidden');
}


/**
 * Altera o status visual do filtro de saldo.
 */
function handleSaldoFilterUI(itemType, e, renderCallback) {
    const button = e.target.closest('button.btn-saldo-filter');
    if (!button) return;

    const newFilter = button.dataset.filter;
    const currentFilter = getCurrentStatusFilter(itemType);

    if (newFilter === currentFilter) return;

    document.querySelectorAll(`#filtro-saldo-${itemType}-controls button`).forEach(btn => {
        btn.classList.remove('active', 'bg-blue-600', 'text-white', 'font-semibold', 'bg-red-700', 'border-red-800', 'bg-blue-800', 'border-blue-800');
        if (btn.dataset.filter === 'devendo') {
            btn.className = 'btn-warning btn-saldo-filter border border-red-400 bg-red-50 text-red-700 hover:bg-red-100';
        } else if (btn.dataset.filter === 'credito') {
            btn.className = 'btn-info btn-saldo-filter border border-blue-400 bg-blue-50 text-blue-700 hover:bg-blue-100';
        } else {
             btn.className = 'btn-secondary btn-saldo-filter';
        }
    });

    button.classList.add('active');

    if (button.dataset.filter === 'devendo') {
        button.className = 'btn-warning btn-saldo-filter active bg-red-700 text-white border-red-800';
    } else if (button.dataset.filter === 'credito') {
        button.className = 'btn-info btn-saldo-filter active bg-blue-800 text-white border-blue-800';
    } else {
        button.className = 'btn-secondary btn-saldo-filter active bg-gray-600 text-white border-gray-600';
    }

    renderCallback(newFilter);
}

/**
 * Abre o modal para confirmação de exclusão.
 */
async function openConfirmDeleteModal(id, type, details = null, alertElementId = 'alert-gestao') {
    if (!id || !type) return;

    const role = getUserRole();
    if (role !== 'admin') {
         showAlert(alertElementId || 'alert-gestao', 'Permissão negada. Apenas Administradores podem excluir dados.', 'error');
         return;
    }

    if (!domReady || !DOM_ELEMENTS.confirmDeleteModal || !DOM_ELEMENTS.deleteDetailsEl || !DOM_ELEMENTS.deleteWarningUnidadeEl || !DOM_ELEMENTS.deleteWarningInicialEl) {
        console.error("Elementos do modal de exclusão não encontrados no DOM.");
        showAlert(alertElementId || 'alert-gestao', 'Erro interno: Modal de exclusão não encontrado.', 'error');
        return;
    }

    let detailsText = details ? `${details} (ID: ${id.substring(0,6)}...)` : `ID: ${id.substring(0,6)}...`;
    // Determina se é um lançamento de estoque inicial (se for tipo entrada-agua/gas E o detalhe incluir 'inicial')
    const isInicial = (type === 'entrada-agua' || type === 'entrada-gas') && details && details.toLowerCase().includes('inicial');

    setDeleteInfo({ id, type, alertElementId, details, isInicial });

    DOM_ELEMENTS.deleteDetailsEl.textContent = `Detalhes: ${detailsText}`;
    // Mostra o alerta de unidade apenas para exclusão de unidade
    DOM_ELEMENTS.deleteWarningUnidadeEl.style.display = (type === 'unidade') ? 'block' : 'none';
    // Mostra o alerta de inicial apenas se for um lançamento inicial de estoque
    DOM_ELEMENTS.deleteWarningInicialEl.style.display = isInicial ? 'block' : 'none';
    
    DOM_ELEMENTS.confirmDeleteModal.style.display = 'flex';

    if (DOM_ELEMENTS.btnConfirmDelete) DOM_ELEMENTS.btnConfirmDelete.disabled = false;
    if (DOM_ELEMENTS.btnCancelDelete) DOM_ELEMENTS.btnCancelDelete.disabled = false;

    if(DOM_ELEMENTS.btnConfirmDelete) DOM_ELEMENTS.btnConfirmDelete.focus();
}

/**
 * Aplica as permissões de UI com base no role do usuário.
 */
function renderPermissionsUI() {
    if (!domReady) return;
    const role = getUserRole();
    console.log(`Applying permissions for role: ${role}`);

    const isAnon = role === 'anon';
    const isEditor = role === 'editor';
    const isAdmin = role === 'admin';

    if (DOM_ELEMENTS.appContentWrapper) {
         DOM_ELEMENTS.appContentWrapper.classList.toggle('hidden', role === 'unauthenticated');
    }

    DOM_ELEMENTS.navButtons.forEach(btn => {
        const tab = btn.dataset.tab;
        let isVisible = true;
        if (isAnon && tab !== 'dashboard') {
            isVisible = false;
        }
        if ((isAnon || isEditor) && (tab === 'gestao' || tab === 'usuarios')) {
            isVisible = false;
        }
        btn.classList.toggle('hidden', !isVisible);
    });

    DOM_ELEMENTS.contentPanes.forEach(pane => {
        const tabName = pane.id.replace('content-', '');
        let isDisabled = false;
        if (isAnon && tabName !== 'dashboard') {
             isDisabled = true;
        }
        if (!isAdmin && (tabName === 'gestao' || tabName === 'usuarios')) {
             isDisabled = true;
        }
         pane.classList.toggle('disabled-by-role', isDisabled);
    });

    if (DOM_ELEMENTS.btnConfirmDelete) {
        DOM_ELEMENTS.btnConfirmDelete.classList.toggle('hidden', !isAdmin);
    }

    const formsToDisableForAnon = [
         DOM_ELEMENTS.formAgua, DOM_ELEMENTS.formGas,
         DOM_ELEMENTS.formCestaLancamento, DOM_ELEMENTS.formEnxovalLancamento
    ];

    // Saída (Unidades): Deve ser desabilitado SÓ para ANÔNIMO. Editor e Admin podem usar.
    formsToDisableForAnon.forEach(form => {
        if (form) {
            form.classList.toggle('disabled-by-role', isAnon);
            form.querySelectorAll('input, select, button[type="submit"], textarea').forEach(el => el.disabled = isAnon);
        }
    });

    const estoqueElementsToDisable = [
        // Formulários em si (Entrada/Inicial)
        DOM_ELEMENTS.formEntradaAgua, DOM_ELEMENTS.formEntradaGas,
        DOM_ELEMENTS.formInicialAgua, DOM_ELEMENTS.formInicialGas,
        // Containers (para o botão 'Definir Estoque Inicial')
        DOM_ELEMENTS.formInicialAguaContainer, DOM_ELEMENTS.formInicialGasContainer,
        DOM_ELEMENTS.btnAbrirInicialAgua, DOM_ELEMENTS.btnAbrirInicialGas,
        // Social
        DOM_ELEMENTS.formCestaEntrada, DOM_ELEMENTS.formEnxovalEntrada,
    ];

    // Entrada (Estoque) e Inicial: Deve ser desabilitado para ANÔNIMO E EDITOR (Admin-Only)
    estoqueElementsToDisable.forEach(el => {
        if (el) {
             const shouldDisable = !isAdmin; // Admin-Only
             if (el.tagName === 'DIV' || el.tagName === 'FORM') {
                 el.classList.toggle('disabled-by-role', shouldDisable);
             } else {
                 el.disabled = shouldDisable;
             }
             // Desabilita os filhos se for container/form
             if (el.tagName === 'DIV' || el.tagName === 'FORM') {
                el.querySelectorAll('input, select, button').forEach(child => child.disabled = shouldDisable);
             }
        }
    });

    const lancarMateriaisView = DOM_ELEMENTS.subviewLancarMateriais;
    if (lancarMateriaisView) {
        const canRegister = isAdmin;
        lancarMateriaisView.classList.toggle('disabled-by-role', !canRegister);
        // Oculta completamente para quem não pode registrar (Editor/Anon)
        lancarMateriaisView.classList.toggle('hidden', !canRegister);
        lancarMateriaisView.querySelectorAll('input, select, textarea, button[type="submit"]').forEach(el => el.disabled = !canRegister);
    }
    
    // Define a variável 'navContainer' e verifica se ela existe antes de usá-la.
    const navContainer = DOM_ELEMENTS.subNavMateriais; 
    if (navContainer) {
        const btnSubtabRegistrar = navContainer.querySelector('.sub-nav-btn[data-subview="lancar-materiais"]');
        if (btnSubtabRegistrar) {
            btnSubtabRegistrar.classList.toggle('hidden', !isAdmin);
        }
    }
    
    // NOVO: Desabilitar o novo formulário de Adicionar Usuário para não-Admin
    if (DOM_ELEMENTS.formAddUser) {
        DOM_ELEMENTS.formAddUser.classList.toggle('disabled-by-role', !isAdmin);
        DOM_ELEMENTS.formAddUser.querySelectorAll('input, select, button').forEach(el => el.disabled = !isAdmin);
    }
    
    const gestaoPane = document.getElementById('content-gestao');
    if (gestaoPane) {
        gestaoPane.classList.toggle('disabled-by-role', !isAdmin);
    }

    const usuariosPane = document.getElementById('content-usuarios');
    if (usuariosPane) {
        usuariosPane.classList.toggle('disabled-by-role', !isAdmin);
    }
    
    // Importação Social é Admin/Editor
    const socialImportPane = DOM_ELEMENTS.socialSubmoduleImportarDados;
     if (socialImportPane) {
        const canImport = isAdmin || isEditor;
        socialImportPane.classList.toggle('disabled-by-role', !canImport);
        socialImportPane.querySelectorAll('input, select, textarea, button').forEach(el => el.disabled = !canImport);
    }

    const user = auth.currentUser;
    const email = user?.email || (user?.isAnonymous ? 'Anônimo' : 'N/A');
    const roleText = {
        'anon': 'Anônimo',
        'editor': 'Editor',
        'admin': 'Admin',
        'unauthenticated': 'Desconectado'
    }[role] || 'Desconhecido';

    if (DOM_ELEMENTS.userEmailDisplayEl) DOM_ELEMENTS.userEmailDisplayEl.textContent = email;
    if (DOM_ELEMENTS.userRoleDisplayEl) {
        DOM_ELEMENTS.userRoleDisplayEl.textContent = roleText;
        DOM_ELEMENTS.userRoleDisplayEl.className = `user-role-display text-xs font-semibold px-2 py-0.5 rounded-full ${role === 'admin' ? 'bg-red-200 text-red-800' : (role === 'editor' ? 'bg-blue-200 text-blue-800' : 'bg-gray-200 text-gray-800')}`;
    }
    if (DOM_ELEMENTS.btnLogout) DOM_ELEMENTS.btnLogout.classList.toggle('hidden', role === 'unauthenticated');

    const currentTab = document.querySelector('.nav-btn.active')?.dataset.tab;
    if (currentTab) {
        let shouldRedirect = false;
        if (isAnon && currentTab !== 'dashboard') shouldRedirect = true;
        if (!isAdmin && (currentTab === 'gestao' || currentTab === 'usuarios')) shouldRedirect = true;

        if (shouldRedirect) {
            switchTab('dashboard');
            showAlert('connectionStatus', 'Acesso negado para esta seção.', 'warning', 10000);
        }
    }

     if (typeof lucide !== 'undefined' && typeof lucide.createIcons === 'function') {
        setTimeout(() => lucide.createIcons(), 50);
     }
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
    openConfirmDeleteModal,
    renderPermissionsUI
};
