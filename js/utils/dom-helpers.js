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
        // ['#form-signup', 'formSignup'], // Removido signup
        ['#input-login-email', 'inputLoginEmail'],
        ['#input-login-password', 'inputLoginPassword'],
        ['#alert-login', 'alertLogin'],
        ['#btn-submit-login', 'btnSubmitLogin'], // Adicionado botão de submit login
        ['#btn-logout', 'btnLogout'],
        ['#user-email-display', 'userEmailDisplayEl'],
        ['#user-role-display', 'userRoleDisplayEl'],
        ['#app-content-wrapper', 'appContentWrapper'], // Novo wrapper do conteúdo principal

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
        // Materiais
        ['#form-materiais', 'formMateriais'],
        ['#select-unidade-materiais', 'selectUnidadeMateriais'],
        ['#select-tipo-materiais', 'selectTipoMateriais'],
        ['#input-data-separacao', 'inputDataSeparacao'],
        ['#textarea-itens-materiais', 'textareaItensMateriais'],
        ['#input-responsavel-materiais', 'inputResponsavelMateriais'],
        ['#input-arquivo-materiais', 'inputArquivoMateriais'],
        ['#btn-submit-materiais', 'btnSubmitMateriais'],
        ['#alert-materiais', 'alertMateriais'], // Alerta do form de lançamento
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

        // ADICIONADO: Gestão de Usuários
        ['#alert-usuarios', 'alertUsuarios'],
        ['#filtro-usuarios', 'filtroUsuarios'],
        ['#table-usuarios', 'tableUsuarios'],
    ];

    mappings.forEach(([selector, varName, isAll]) => {
        try {
            if (isAll) {
                DOM_ELEMENTS[varName] = document.querySelectorAll(selector);
            } else {
                DOM_ELEMENTS[varName] = document.querySelector(selector);
            }
            // Log para debug, comentar em produção
            // if (!DOM_ELEMENTS[varName] || (isAll && DOM_ELEMENTS[varName].length === 0)) {
            //     console.warn(`DOM Element not found or empty for selector: ${selector} (var: ${varName})`);
            // }
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
    // Não esconder alertas de erro automaticamente
    if (type !== 'error') {
        el.timeoutId = setTimeout(() => {
            el.style.display = 'none';
            el.timeoutId = null;
        }, duration);
    } else {
        // Adiciona um botão de fechar para erros
        const closeButton = document.createElement('button');
        closeButton.innerHTML = '&times;';
        closeButton.style.cssText = 'float: right; font-size: 1.2rem; line-height: 1; border: none; background: none; cursor: pointer; margin-left: 10px;';
        closeButton.onclick = () => { el.style.display = 'none'; };
        // Insere o botão no início do alerta
        el.insertBefore(closeButton, el.firstChild);
    }
}

/**
 * Alterna a visualização da aba principal.
 */
function switchTab(tabName) {
    if (!domReady) return;
    console.log(`Switching to tab: ${tabName}`);

    // CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
    DOM_ELEMENTS.navButtons.forEach(btn => btn.classList.remove('active'));
    const activeBtn = document.querySelector(`.nav-btn[data-tab="${tabName}"]`);
    if (activeBtn) activeBtn.classList.add('active');

    // CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
    DOM_ELEMENTS.contentPanes.forEach(pane => pane.classList.add('hidden'));
    const activePane = document.getElementById(`content-${tabName}`);
    if(activePane) activePane.classList.remove('hidden');

    visaoAtiva = tabName;

    // Atualiza ícones Lucide
    if (typeof lucide !== 'undefined' && typeof lucide.createIcons === 'function') {
        // Delay para garantir que o DOM oculto esteja visível
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

    if (!navContainer || !contentContainer) {
        console.warn(`Containers not found for sub-tab switch: ${tabPrefix}`);
        return;
    }

    // Atualiza botões da sub-navegação
    navContainer.querySelectorAll('.sub-nav-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.subview === subViewName);
    });

    // Mostra/Esconde painéis de conteúdo da sub-view
    contentContainer.querySelectorAll(`div[id^="subview-"]`).forEach(pane => {
         pane.classList.toggle('hidden', pane.id !== `subview-${subViewName}`);
    });

    if (typeof lucide !== 'undefined' && typeof lucide.createIcons === 'function') {
         // Delay para garantir que o DOM oculto esteja visível
         setTimeout(() => lucide.createIcons(), 50);
    }
}

/**
 * Filtra uma tabela HTML.
 */
function filterTable(inputEl, tableBodyId) {
    const searchTerm = inputEl.value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""); // Normaliza o termo de busca uma vez
    const tableBody = document.getElementById(tableBodyId);
    if (!tableBody) return;
    const rows = tableBody.querySelectorAll('tr');

    rows.forEach(row => {
        // Ignora linhas de cabeçalho, linhas em edição, de observação ou separador
        if (row.querySelectorAll('td').length > 1 && !row.classList.contains('editing-row') && !row.classList.contains('obs-row') && !row.classList.contains('separador-row')) {
            const rowText = row.textContent.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
            const isMatch = rowText.includes(searchTerm);
            row.style.display = isMatch ? '' : 'none';

            // Lógica para esconder/mostrar linhas associadas (obs e separador)
            let nextRow = row.nextElementSibling;
            while(nextRow && (nextRow.classList.contains('obs-row') || nextRow.classList.contains('separador-row'))) {
                nextRow.style.display = isMatch ? '' : 'none';
                nextRow = nextRow.nextElementSibling;
            }
        } else if (row.querySelectorAll('th').length > 0) {
            // Garante que o header da tabela nunca seja ocultado
             row.style.display = '';
        }
    });
}

/**
 * Atualiza o horário de última atualização na UI.
 */
function updateLastUpdateTime() {
     // CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
     if (!domReady || !DOM_ELEMENTS.lastUpdateTimeEl) return;
    const now = new Date();
    const formattedDate = now.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    DOM_ELEMENTS.lastUpdateTimeEl.textContent = `Atualizado: ${formattedDate}`;
    // Mostra o elemento se estiver oculto
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

    // Se clicar no mesmo, não faz nada
    if (newFilter === currentFilter) return;

    // Remove 'active' de todos e aplica os estilos base novamente
    document.querySelectorAll(`#filtro-saldo-${itemType}-controls button`).forEach(btn => {
        btn.classList.remove('active', 'bg-blue-600', 'text-white', 'font-semibold', 'bg-red-700', 'border-red-800', 'bg-blue-800', 'border-blue-800'); // Limpa estilos ativos
        // Garante que os estilos de cor corretos são aplicados quando inativo
        if (btn.dataset.filter === 'devendo') {
            btn.className = 'btn-warning btn-saldo-filter border border-red-400 bg-red-50 text-red-700 hover:bg-red-100';
        } else if (btn.dataset.filter === 'credito') {
            btn.className = 'btn-info btn-saldo-filter border border-blue-400 bg-blue-50 text-blue-700 hover:bg-blue-100';
        } else {
             btn.className = 'btn-secondary btn-saldo-filter';
        }
    });

    // Aplica 'active' no botão clicado
    button.classList.add('active');

    // Define estilos ativos específicos
    if (button.dataset.filter === 'devendo') {
        button.className = 'btn-warning btn-saldo-filter active bg-red-700 text-white border-red-800'; // Vermelho forte ativo
    } else if (button.dataset.filter === 'credito') {
        button.className = 'btn-info btn-saldo-filter active bg-blue-800 text-white border-blue-800'; // Azul forte ativo
    } else { // 'all' ou 'zero'
        button.className = 'btn-secondary btn-saldo-filter active bg-gray-600 text-white border-gray-600'; // Cinza escuro ativo
    }


    // Chama o callback de renderização do módulo principal
    renderCallback(newFilter);
}

/**
 * Abre o modal para confirmação de exclusão.
 */
async function openConfirmDeleteModal(id, type, details = null, alertElementId = 'alert-gestao') {
    // CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS (verificação movida para depois da checagem de permissão)
    if (!id || !type) return;

    // NOVO: Checagem de permissão antes de abrir o modal
    const role = getUserRole();
    if (role !== 'admin') {
         showAlert(alertElementId || 'alert-gestao', 'Permissão negada. Apenas Administradores podem excluir dados.', 'error');
         return;
    }

    // Verifica se os elementos do modal existem
    // CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
    if (!domReady || !DOM_ELEMENTS.confirmDeleteModal || !DOM_ELEMENTS.deleteDetailsEl || !DOM_ELEMENTS.deleteWarningUnidadeEl || !DOM_ELEMENTS.deleteWarningInicialEl) {
        console.error("Elementos do modal de exclusão não encontrados no DOM.");
        showAlert(alertElementId || 'alert-gestao', 'Erro interno: Modal de exclusão não encontrado.', 'error');
        return;
    }


    let detailsText = details ? `${details} (ID: ${id.substring(0,6)}...)` : `ID: ${id.substring(0,6)}...`;
    const isInicial = details && details.toLowerCase().includes('inicial'); // Heurística para detectar estoque inicial

    // Define a informação de exclusão no cache
    setDeleteInfo({ id, type, alertElementId, details, isInicial });

    // Prepara o modal
    // CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
    DOM_ELEMENTS.deleteDetailsEl.textContent = `Detalhes: ${detailsText}`;
    DOM_ELEMENTS.deleteWarningUnidadeEl.style.display = (type === 'unidade') ? 'block' : 'none';
    DOM_ELEMENTS.deleteWarningInicialEl.style.display = isInicial ? 'block' : 'none';
    DOM_ELEMENTS.confirmDeleteModal.style.display = 'flex';
    // Reativa os botões caso tenham sido desativados por um erro anterior
    // CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
    if (DOM_ELEMENTS.btnConfirmDelete) DOM_ELEMENTS.btnConfirmDelete.disabled = false;
    if (DOM_ELEMENTS.btnCancelDelete) DOM_ELEMENTS.btnCancelDelete.disabled = false;

    // Foca o botão de confirmação
    // CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
    if(DOM_ELEMENTS.btnConfirmDelete) DOM_ELEMENTS.btnConfirmDelete.focus();
}

/**
 * Aplica as permissões de UI com base no role do usuário.
 */
function renderPermissionsUI() {
    if (!domReady) return;
    const role = getUserRole();
    console.log(`Applying permissions for role: ${role}`);

    // Mapeamento de permissões:
    const isAnon = role === 'anon';
    const isEditor = role === 'editor';
    const isAdmin = role === 'admin';
    const isAuthenticated = isEditor || isAdmin; // Usuário logado com email/senha ou token

    // 1. Visibilidade do Conteúdo Principal (se não for ambiente Canvas, o modal de auth lida)
    // Este wrapper garante que nada apareça enquanto não houver usuário (Anonimo/Email)
    // CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
    if (DOM_ELEMENTS.appContentWrapper) {
         DOM_ELEMENTS.appContentWrapper.classList.toggle('hidden', role === 'unauthenticated');
    }

    // 2. Visibilidade das Abas de Navegação
    // CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
    DOM_ELEMENTS.navButtons.forEach(btn => {
        const tab = btn.dataset.tab;
        let isVisible = true;
        if (isAnon && tab !== 'dashboard') {
            isVisible = false; // Anonimo só vê dashboard
        }
        // MODIFICADO: Agrupado 'gestao' e 'usuarios'
        if ((isAnon || isEditor) && (tab === 'gestao' || tab === 'usuarios')) {
            isVisible = false; // Apenas Admin vê Gestão de Unidades e Usuários
        }
        btn.classList.toggle('hidden', !isVisible);
    });

    // NOVO (Correção do Bug): Reforço de Permissão no Conteúdo Principal (Impede interações em abas restritas)
    // CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
    DOM_ELEMENTS.contentPanes.forEach(pane => {
        const tabName = pane.id.replace('content-', '');
        let isDisabled = false;
        if (isAnon && tabName !== 'dashboard') {
             isDisabled = true; // Anon desabilita tudo menos dashboard
        }
        if (!isAdmin && (tabName === 'gestao' || tabName === 'usuarios')) {
             isDisabled = true; // Não-admin desabilita gestão e usuários
        }
         pane.classList.toggle('disabled-by-role', isDisabled);
    });

    // 3. Permissões de Exclusão (Admin Only) - Botões dinâmicos
    // O botão de confirmação do modal de exclusão é ocultado para não-admins
    // CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
    if (DOM_ELEMENTS.btnConfirmDelete) {
        DOM_ELEMENTS.btnConfirmDelete.classList.toggle('hidden', !isAdmin);
    }
    // A remoção de botões ".btn-remove" nas tabelas é feita pela renderização dos módulos.

    // 4. Permissões de Lançamento
    // 4.1. Lançamentos de Água/Gás e Estoque: Anonimo não pode. Estoque é Admin-Only.
    // CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
    const formsToDisableForAnon = [
         DOM_ELEMENTS.formAgua, DOM_ELEMENTS.formGas // Movimentação (Editor/Admin)
    ];

    formsToDisableForAnon.forEach(form => {
        if (form) {
            form.classList.toggle('disabled-by-role', isAnon);
            // Desabilita todos os inputs/buttons dentro
            form.querySelectorAll('input, select, button[type="submit"]').forEach(el => el.disabled = isAnon);
        }
    });

    // Estoque é Admin-Only
    // CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
    const estoqueElementsToDisable = [
        DOM_ELEMENTS.formEntradaAgua, DOM_ELEMENTS.formEntradaGas,
        DOM_ELEMENTS.formInicialAgua, DOM_ELEMENTS.formInicialGas,
        DOM_ELEMENTS.formInicialAguaContainer, DOM_ELEMENTS.formInicialGasContainer,
        // Adiciona botões de abrir estoque inicial
        DOM_ELEMENTS.btnAbrirInicialAgua, DOM_ELEMENTS.btnAbrirInicialGas
    ];

    estoqueElementsToDisable.forEach(el => { // Agora itera sobre 'el'
        if (el) {
             const shouldDisable = !isAdmin;
             // Se for container, aplica a classe, senão, desabilita diretamente
             if (el.tagName === 'DIV' || el.tagName === 'FORM') {
                 el.classList.toggle('disabled-by-role', shouldDisable);
             } else { // Assume que é input/button/select
                 el.disabled = shouldDisable;
             }
             // Desabilita filhos se for container/form
             if (el.tagName === 'DIV' || el.tagName === 'FORM') {
                el.querySelectorAll('input, select, button').forEach(child => child.disabled = shouldDisable);
             }
        }
    });

    // 4.2. Registrar Nova Requisição (Materiais) - ADMIN-ONLY
    // CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
    const lancarMateriaisView = DOM_ELEMENTS.subviewLancarMateriais; // Usando a subview correta
    if (lancarMateriaisView) {
        const canRegister = isAdmin;
        lancarMateriaisView.classList.toggle('disabled-by-role', !canRegister);
        // Desabilita todos os inputs/buttons dentro do formulário
        lancarMateriaisView.querySelectorAll('input, select, textarea, button[type="submit"]').forEach(el => el.disabled = !canRegister);
    }

    // Oculta o botão 'Registrar Requisição' da sub-nav se não for Admin
    // CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
    const navContainer = document.getElementById('sub-nav-materiais'); // Define navContainer
    if (navContainer) {
        const btnSubtabRegistrar = navContainer.querySelector('.sub-nav-btn[data-subview="lancar-materiais"]'); // Seleciona o botão correto
        if (btnSubtabRegistrar) {
            btnSubtabRegistrar.classList.toggle('hidden', !isAdmin);
        }
    }


    // 5. Permissões de Gestão (Unidades) - ADMIN ONLY
    // A gestão de unidades (adição, edição, exclusão, toggles) é restrita ao Admin.
    const gestaoPane = document.getElementById('content-gestao');
    if (gestaoPane) {
        gestaoPane.classList.toggle('disabled-by-role', !isAdmin);
    }

    // Container da coluna "Adicionar em Lote" (Esconde para não-Admin)
    // CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
    if (DOM_ELEMENTS.textareaBulkUnidades) {
        const bulkAddContainer = DOM_ELEMENTS.textareaBulkUnidades.closest('.lg\\:col-span-1');
        if (bulkAddContainer) {
            bulkAddContainer.classList.toggle('hidden', !isAdmin);
        }
    }


    // 6. ADICIONADO: Permissões de Gestão (Usuários) - ADMIN ONLY
    const usuariosPane = document.getElementById('content-usuarios');
    if (usuariosPane) {
        // Desabilita todo o painel se não for admin
        usuariosPane.classList.toggle('disabled-by-role', !isAdmin);
    }

    // 7. RE-NUMERADO: Exibir status do usuário
    const user = auth.currentUser;
    const email = user?.email || (user?.isAnonymous ? 'Anônimo' : 'N/A');
    const roleText = {
        'anon': 'Anônimo',
        'editor': 'Editor',
        'admin': 'Admin',
        'unauthenticated': 'Desconectado'
    }[role] || 'Desconhecido';

    // CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
    if (DOM_ELEMENTS.userEmailDisplayEl) DOM_ELEMENTS.userEmailDisplayEl.textContent = email;
    // CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
    if (DOM_ELEMENTS.userRoleDisplayEl) {
        DOM_ELEMENTS.userRoleDisplayEl.textContent = roleText;
        // Atualiza a classe de cor do badge
        DOM_ELEMENTS.userRoleDisplayEl.className = `user-role-display text-xs font-semibold px-2 py-0.5 rounded-full ${role === 'admin' ? 'bg-red-200 text-red-800' : (role === 'editor' ? 'bg-blue-200 text-blue-800' : 'bg-gray-200 text-gray-800')}`;
    }
    // CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
    if (DOM_ELEMENTS.btnLogout) DOM_ELEMENTS.btnLogout.classList.toggle('hidden', role === 'unauthenticated');

    // Se estiver em uma aba que não tem permissão, força o Dashboard
    const currentTab = document.querySelector('.nav-btn.active')?.dataset.tab;
    if (currentTab) {
        let shouldRedirect = false;
        if (isAnon && currentTab !== 'dashboard') shouldRedirect = true;
        if (!isAdmin && (currentTab === 'gestao' || currentTab === 'usuarios')) shouldRedirect = true;

        if (shouldRedirect) {
            switchTab('dashboard');
            showAlert('connectionStatus', 'Acesso negado para esta seção.', 'warning', 10000); // Alerta no header
        }
    }

    // Garante que ícones sejam renderizados após aplicar permissões
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
