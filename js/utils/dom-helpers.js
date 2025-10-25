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
    ];

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
// ... (rest of file)
