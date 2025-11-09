// js/modules/dashboard.js
import { getAguaMovimentacoes, getGasMovimentacoes, getEstoqueAgua, getEstoqueGas, getMateriais, isEstoqueInicialDefinido, getCurrentDashboardMaterialFilter, setCurrentDashboardMaterialFilter, initialMaterialFilter } from "../utils/cache.js";
// CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
import { DOM_ELEMENTS, showAlert, switchTab } from "../utils/dom-helpers.js";
import { formatTimestamp } from "../utils/formatters.js";

let dashboardAguaChartInstance, dashboardGasChartInstance;
let dashboardRefreshInterval = null;
// Estado de paginação da lista de Materiais
let materiaisPagerState = { page: 1, pageSize: 20, total: 0, pages: 1, data: [] };
let materiaisAutoPagerInterval = null;
// Estado de paginação da grade da Visão Geral (Materiais do Almoxarifado)
let geralPagerState = { page: 1, pageSize: 5, pages: 1, maxItems: 0 };
let geralAutoPagerInterval = null;
// Filtros globais e busca da Visão Geral (agrupamento)
let geralFilterStatus = 'todos'; // 'todos' | 'separacao' | 'pronto' | 'pendente'
let geralSearchQuery = '';

// =========================================================================
// FUNÇÕES DE UTILIDADE DO DASHBOARD
// =========================================================================

/**
 * Filtra movimentações dos últimos 30 dias.
 * @param {Array<Object>} movimentacoes Lista de movimentações.
 * @returns {Array<Object>} Movimentações dos últimos 30 dias.
 */
function filterLast30Days(movimentacoes) {
    const today = new Date(); 
    today.setHours(23, 59, 59, 999); 
    const thirtyDaysAgo = new Date(today); 
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30); 
    thirtyDaysAgo.setHours(0, 0, 0, 0); 
    
    const thirtyDaysAgoTimestamp = thirtyDaysAgo.getTime();
    const todayTimestamp = today.getTime();
    
    return movimentacoes.filter(m => {
        if (!m.data || typeof m.data.toDate !== 'function') return false; 
        const mTimestamp = m.data.toMillis();
        return mTimestamp >= thirtyDaysAgoTimestamp && mTimestamp <= todayTimestamp;
    });
}

/**
 * Prepara dados para os gráficos de linha dos últimos 30 dias (Água/Gás).
 * @param {Array<Object>} movimentacoes Movimentações a serem usadas.
 * @returns {Object} Dados no formato Chart.js.
 */
function getChartDataLast30Days(movimentacoes) {
    const labels = []; const entregasData = []; const retornosData = []; 
    const dataMap = new Map();
    
    const today = new Date(); today.setHours(0, 0, 0, 0);
    for (let i = 29; i >= 0; i--) { 
        const d = new Date(today); 
        d.setDate(d.getDate() - i); 
        const dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; 
        const dateLabel = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }); 
        labels.push(dateLabel); 
        dataMap.set(dateKey, { entregas: 0, retornos: 0 }); 
    }

    const movs30Dias = filterLast30Days(movimentacoes);
    
    movs30Dias.forEach(m => { 
        const mDate = m.data.toDate(); 
        mDate.setHours(0,0,0,0);
        const dateKey = `${mDate.getFullYear()}-${String(mDate.getMonth() + 1).padStart(2, '0')}-${String(mDate.getDate()).padStart(2, '0')}`; 
        if (dataMap.has(dateKey)) { 
            const dayData = dataMap.get(dateKey); 
            if (m.tipo === 'entrega') dayData.entregas += m.quantidade; 
            else if (m.tipo === 'retorno') dayData.retornos += m.quantidade; 
        } 
    });

    dataMap.forEach(value => { 
        entregasData.push(value.entregas); 
        retornosData.push(value.retornos); 
    });

    return { 
        labels, 
        datasets: [ 
            { label: 'Entregues (Cheios)', data: entregasData, backgroundColor: 'rgba(59, 130, 246, 0.7)', borderColor: 'rgba(59, 130, 246, 1)', borderWidth: 1, tension: 0.1 }, 
            { label: 'Recebidos (Vazios)', data: retornosData, backgroundColor: 'rgba(16, 185, 129, 0.7)', borderColor: 'rgba(16, 185, 129, 1)', borderWidth: 1, tension: 0.1 } 
        ] 
    };
}


// =========================================================================
// FUNÇÕES DE RENDERIZAÇÃO
// =========================================================================

/**
 * Alterna a visualização do dashboard.
 * @param {string} viewName Nome da sub-view ('geral', 'agua', 'gas', 'materiais').
 */
function switchDashboardView(viewName) {
    document.querySelectorAll('#dashboard-nav-controls .dashboard-nav-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.view === viewName);
    });
    document.querySelectorAll('.dashboard-tv-view > div[id^="dashboard-view-"]').forEach(pane => {
         pane.classList.toggle('hidden', pane.id !== `dashboard-view-${viewName}`);
    });
    
    if(viewName === 'agua') renderDashboardAguaChart();
    if(viewName === 'gas') renderDashboardGasChart();
    if(viewName === 'geral') {
        // CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
        if (DOM_ELEMENTS.dashboardMateriaisSeparacaoCountEl) renderDashboardMateriaisCounts(); 
        if (DOM_ELEMENTS.dashboardMateriaisProntosPager) DOM_ELEMENTS.dashboardMateriaisProntosPager.classList.remove('hidden');
        if (DOM_ELEMENTS.geralPagerInfo) {
            DOM_ELEMENTS.geralPagerInfo.textContent = `Página ${geralPagerState.page} de ${geralPagerState.pages} • até ${geralPagerState.pageSize} itens/coluna`;
        }
    }
    if(viewName === 'materiais') {
        renderDashboardMateriaisList();
        if (DOM_ELEMENTS.dashboardMateriaisPagerContainer) DOM_ELEMENTS.dashboardMateriaisPagerContainer.classList.remove('hidden');
    } else {
        if (DOM_ELEMENTS.dashboardMateriaisPagerContainer) DOM_ELEMENTS.dashboardMateriaisPagerContainer.classList.add('hidden');
        if (materiaisAutoPagerInterval) { clearInterval(materiaisAutoPagerInterval); materiaisAutoPagerInterval = null; }
    }

    if (viewName !== 'geral') {
        if (DOM_ELEMENTS.dashboardMateriaisProntosPager) DOM_ELEMENTS.dashboardMateriaisProntosPager.classList.add('hidden');
        if (geralAutoPagerInterval) { clearInterval(geralAutoPagerInterval); geralAutoPagerInterval = null; }
    }
}

/**
 * Renderiza o gráfico do dashboard para Água.
 */
export function renderDashboardAguaChart() {
    const ctx = document.getElementById('dashboardAguaChart')?.getContext('2d'); 
    if (!ctx) return; 
    const data = getChartDataLast30Days(getAguaMovimentacoes()); 
    if (dashboardAguaChartInstance) { 
        dashboardAguaChartInstance.data = data; 
        dashboardAguaChartInstance.update(); 
    } else if (typeof Chart !== 'undefined') { 
        dashboardAguaChartInstance = new Chart(ctx, { type: 'line', data: data, options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } }, plugins: { legend: { position: 'top' } } } }); 
    }
}

/**
 * Renderiza o gráfico do dashboard para Gás.
 */
export function renderDashboardGasChart() {
    const ctx = document.getElementById('dashboardGasChart')?.getContext('2d'); 
    if (!ctx) return; 
    const data = getChartDataLast30Days(getGasMovimentacoes()); 
    if (dashboardGasChartInstance) { 
        dashboardGasChartInstance.data = data; 
        dashboardGasChartInstance.update(); 
    } else if (typeof Chart !== 'undefined') { 
        dashboardGasChartInstance = new Chart(ctx, { type: 'line', data: data, options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } }, plugins: { legend: { position: 'top' } } } }); 
    }
}

/**
 * Renderiza o resumo do dashboard para Água.
 */
function renderDashboardAguaSummary() {
    const movs = getAguaMovimentacoes();
    const estoqueAgua = getEstoqueAgua();

    const estoqueInicial = estoqueAgua.filter(e => e.tipo === 'inicial').reduce((sum, e) => sum + e.quantidade, 0);
    const totalEntradas = estoqueAgua.filter(e => e.tipo === 'entrada').reduce((sum, e) => sum + e.quantidade, 0);
    const totalSaidas = movs.filter(m => m.tipo === 'entrega').reduce((sum, m) => sum + m.quantidade, 0);
    const estoqueAtual = estoqueInicial + totalEntradas - totalSaidas;

    const totalEntregueGeral = movs.filter(m => m.tipo === 'entrega').reduce((sum, m) => sum + m.quantidade, 0);
    const totalRecebidoGeral = movs.filter(m => m.tipo === 'retorno').reduce((sum, m) => sum + m.quantidade, 0);
    
    const movs30Dias = filterLast30Days(movs);
    const totalEntregue30d = movs30Dias.filter(m => m.tipo === 'entrega').reduce((sum, m) => sum + m.quantidade, 0);
    const totalRecebido30d = movs30Dias.filter(m => m.tipo === 'retorno').reduce((sum, m) => sum + m.quantidade, 0);

    // CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
    if (DOM_ELEMENTS.summaryAguaPendente) DOM_ELEMENTS.summaryAguaPendente.textContent = totalEntregueGeral - totalRecebidoGeral; 
    if (DOM_ELEMENTS.summaryAguaEntregue) DOM_ELEMENTS.summaryAguaEntregue.textContent = totalEntregue30d;
    if (DOM_ELEMENTS.summaryAguaRecebido) DOM_ELEMENTS.summaryAguaRecebido.textContent = totalRecebido30d;
    
    // Atualiza o KPI de Estoque de Água na visão geral
    if (DOM_ELEMENTS.dashboardEstoqueAguaEl) DOM_ELEMENTS.dashboardEstoqueAguaEl.textContent = estoqueAtual;
}

/**
 * Renderiza o resumo do dashboard para Gás.
 */
function renderDashboardGasSummary() {
    const movs = getGasMovimentacoes();
    const estoqueGas = getEstoqueGas();

    const estoqueInicial = estoqueGas.filter(e => e.tipo === 'inicial').reduce((sum, e) => sum + e.quantidade, 0);
    const totalEntradas = estoqueGas.filter(e => e.tipo === 'entrada').reduce((sum, e) => sum + e.quantidade, 0);
    const totalSaidas = movs.filter(m => m.tipo === 'entrega').reduce((sum, m) => sum + m.quantidade, 0);
    const estoqueAtual = estoqueInicial + totalEntradas - totalSaidas;
    
    const totalEntregueGeral = movs.filter(m => m.tipo === 'entrega').reduce((sum, m) => sum + m.quantidade, 0);
    const totalRecebidoGeral = movs.filter(m => m.tipo === 'retorno').reduce((sum, m) => sum + m.quantidade, 0);
    
    const movs30Dias = filterLast30Days(movs);
    const totalEntregue30d = movs30Dias.filter(m => m.tipo === 'entrega').reduce((sum, m) => sum + m.quantidade, 0);
    const totalRecebido30d = movs30Dias.filter(m => m.tipo === 'retorno').reduce((sum, m) => sum + m.quantidade, 0);

    // CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
    if (DOM_ELEMENTS.summaryGasPendente) DOM_ELEMENTS.summaryGasPendente.textContent = totalEntregueGeral - totalRecebidoGeral; 
    if (DOM_ELEMENTS.summaryGasEntregue) DOM_ELEMENTS.summaryGasEntregue.textContent = totalEntregue30d;
    if (DOM_ELEMENTS.summaryGasRecebido) DOM_ELEMENTS.summaryGasRecebido.textContent = totalRecebido30d;

    // Atualiza o KPI de Estoque de Gás na visão geral
    if (DOM_ELEMENTS.dashboardEstoqueGasEl) DOM_ELEMENTS.dashboardEstoqueGasEl.textContent = estoqueAtual;
}

/**
 * Renderiza a lista de materiais pendentes para a sub-view 'materiais' do dashboard.
 */
function renderDashboardMateriaisList() {
    // CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
    if (!DOM_ELEMENTS.dashboardMateriaisListContainer || !DOM_ELEMENTS.loadingMateriaisDashboard) return; 
    
    DOM_ELEMENTS.loadingMateriaisDashboard.style.display = 'none'; 
     
    const pendentes = getMateriais()
        .filter(m => m.status === 'requisitado' || m.status === 'separacao' || m.status === 'retirada')
        .sort((a,b) => { 
            const statusOrder = { 'requisitado': 1, 'separacao': 2, 'retirada': 3 }; 
            const statusCompare = (statusOrder[a.status] || 9) - (statusOrder[b.status] || 9);
            if (statusCompare !== 0) return statusCompare;
            const tsA = (a.status === 'requisitado')
                ? (a.registradoEm?.toMillis() || 0)
                : (a.status === 'separacao')
                    ? (a.dataSeparacao?.toMillis() || a.registradoEm?.toMillis() || 0)
                    : (a.dataRetirada?.toMillis() || a.dataSeparacao?.toMillis() || 0);
            const tsB = (b.status === 'requisitado')
                ? (b.registradoEm?.toMillis() || 0)
                : (b.status === 'separacao')
                    ? (b.dataSeparacao?.toMillis() || b.registradoEm?.toMillis() || 0)
                    : (b.dataRetirada?.toMillis() || b.dataSeparacao?.toMillis() || 0);
            return tsA - tsB; 
        }); 

    // Atualiza estado de paginação
    materiaisPagerState.total = pendentes.length;
    materiaisPagerState.pages = Math.max(1, Math.ceil(materiaisPagerState.total / materiaisPagerState.pageSize));
    if (materiaisPagerState.page > materiaisPagerState.pages) materiaisPagerState.page = materiaisPagerState.pages;
    materiaisPagerState.data = pendentes;

    if (pendentes.length === 0) { 
        DOM_ELEMENTS.dashboardMateriaisListContainer.innerHTML = '<p class="text-sm text-slate-500 text-center py-4">Nenhum material pendente.</p>'; 
        atualizarPagerUI();
        return; 
    }
    const inicio = (materiaisPagerState.page - 1) * materiaisPagerState.pageSize;
    const fim = inicio + materiaisPagerState.pageSize;
    const paginaItems = pendentes.slice(inicio, fim);
    
    const html = paginaItems.map(m => {
        const isSeparacao = m.status === 'separacao';
        const isRetirada = m.status === 'retirada';
        
        let badgeClass = 'badge-purple';
        let badgeText = 'Requisitado';
        let bgColor = 'bg-purple-50'; 
        let borderColor = 'border-purple-300';
        
        if (isSeparacao) {
            badgeClass = 'badge-yellow';
            badgeText = 'Em Separação';
            bgColor = 'bg-yellow-50';
            borderColor = 'border-yellow-300';
        } else if (isRetirada) {
            badgeClass = 'badge-green';
            badgeText = 'Disponível';
            bgColor = 'bg-green-50';
            borderColor = 'border-green-300';
        }

        const separador = m.responsavelSeparador ? `<p class=\"text-xs text-slate-700 mt-1\"><strong>Separador:</strong> ${m.responsavelSeparador}</p>` : '';
        return ` 
            <div class="dashboard-list-item p-3 ${bgColor} rounded-lg border ${borderColor}"> 
                <div class="flex justify-between items-center gap-2"> 
                    <span class="font-medium text-slate-700 text-sm break-words" title="${m.unidadeNome || ''}">${m.unidadeNome || 'Unidade Desc.'}</span> 
                    <span class="badge ${badgeClass} flex-shrink-0">${badgeText} (${formatTimestamp(m.dataSeparacao || m.registradoEm)})</span> 
                </div> 
                <p class="text-xs text-slate-600 capitalize mt-1">${m.tipoMaterial || 'N/D'}</p> 
                ${separador}
                ${m.itens ? `<p class="text-xs text-gray-500 mt-1 truncate" title="${m.itens}">Obs: ${m.itens}</p>` : ''} 
            </div> `
    }).join('');

    DOM_ELEMENTS.dashboardMateriaisListContainer.innerHTML = html;
    atualizarPagerUI();
    // Auto-avançar páginas no Modo TV da sub-view Materiais
    const materiaisPane = document.getElementById('dashboard-view-materiais');
    if (materiaisPane && materiaisPane.classList.contains('tv-mode') && materiaisPagerState.pages > 1) {
        iniciarAutoPagerTV();
    } else {
        pararAutoPagerTV();
    }
}

/**
 * Renderiza os contadores de materiais para a visão geral e sub-views.
 */
function renderDashboardMateriaisCounts() {
    // CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
    if (!DOM_ELEMENTS.summaryMateriaisRequisitado) return;
    
    const materiais = getMateriais();

    const requisitadoCount = materiais.filter(m => m.status === 'requisitado').length;
    const separacaoCount = materiais.filter(m => m.status === 'separacao').length;
    const retiradaCount = materiais.filter(m => m.status === 'retirada').length;
    
    // CORREÇÃO SOLICITADA 1: O card "Em Separação" deve somar requisitado e separacao.
    const emSeparacaoDashboard = requisitadoCount + separacaoCount;

    // Atualiza os cards do Dashboard (topo)
    if (DOM_ELEMENTS.dashboardMateriaisSeparacaoCountEl) DOM_ELEMENTS.dashboardMateriaisSeparacaoCountEl.textContent = emSeparacaoDashboard;
    if (DOM_ELEMENTS.dashboardMateriaisRetiradaCountEl) DOM_ELEMENTS.dashboardMateriaisRetiradaCountEl.textContent = retiradaCount;
    
    // Atualiza os summaries da subview de lançamento de materiais (estes devem ser separados)
    if (DOM_ELEMENTS.summaryMateriaisRequisitado) DOM_ELEMENTS.summaryMateriaisRequisitado.textContent = requisitadoCount;
    // CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
    if (DOM_ELEMENTS.summaryMateriaisSeparacao) DOM_ELEMENTS.summaryMateriaisSeparacao.textContent = separacaoCount;
    if (DOM_ELEMENTS.summaryMateriaisRetirada) DOM_ELEMENTS.summaryMateriaisRetirada.textContent = retiradaCount;
}

/**
 * Renderiza o painel de materiais por coluna (visão geral).
 * @param {string|null} filterStatus Status para filtrar ('requisitado', 'separacao', 'retirada' ou null/default).
 */
export function renderDashboardMateriaisProntos(filterStatus = null) {
    // CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
    const container = DOM_ELEMENTS.dashboardMateriaisProntosContainer;
    const titleEl = DOM_ELEMENTS.dashboardMateriaisTitle; 
    const clearButton = DOM_ELEMENTS.btnClearDashboardFilter; 

    if (!container) return; 
    
    const COLUNAS_DOM = ['CT', 'SEDE', 'CRAS', 'CREAS', 'ABRIGO'];
    const colunaDOMElements = Array.from(container.querySelectorAll('.materiais-prontos-col'));
    const materiais = getMateriais();
    
    // --- Lógica de filtragem ---
    let pendentes = materiais.filter(m => m.status === 'requisitado' || m.status === 'separacao' || m.status === 'retirada');
    
    // Se o filtro for 'separacao', inclui 'requisitado' e 'separacao' (Como no Card KPI)
    if (filterStatus === 'separacao') {
         pendentes = pendentes.filter(m => m.status === 'separacao' || m.status === 'requisitado');
    } else if (filterStatus) {
         pendentes = pendentes.filter(m => m.status === filterStatus);
    }

    if (clearButton) clearButton.classList.toggle('hidden', !filterStatus); 
    if (titleEl) {
        if (filterStatus === 'separacao') {
             titleEl.textContent = 'Materiais em Separação e Requisitados';
        } else if (filterStatus === 'retirada') {
            titleEl.textContent = 'Materiais Disponíveis p/ Retirada';
        } else {
             titleEl.textContent = 'Materiais do Almoxarifado';
        }
    }

    // --- NOVO: filtros globais e busca da Visão Geral ---
    if (geralFilterStatus === 'separacao') {
        pendentes = pendentes.filter(m => m.status === 'separacao');
    } else if (geralFilterStatus === 'pronto') {
        pendentes = pendentes.filter(m => m.status === 'retirada');
    } else if (geralFilterStatus === 'pendente') {
        pendentes = pendentes.filter(m => m.status === 'requisitado');
    }

    const q = (geralSearchQuery || '').trim().toLowerCase();
    if (q) {
        pendentes = pendentes.filter(m => {
            const u = (m.unidadeNome || '').toLowerCase();
            const item = (m.tipoMaterial || '').toLowerCase();
            const obs = (m.itens || '').toLowerCase();
            return u.includes(q) || item.includes(q) || obs.includes(q);
        });
    }

    // --- NOVO: agrupamento por tipo de unidade com acordeão ---
    const grupos = pendentes.reduce((acc, m) => {
        let tipoUnidade = (m.tipoUnidade || 'OUTROS').toUpperCase();
        if (tipoUnidade === 'SEMCAS') tipoUnidade = 'SEDE';
        if (!acc[tipoUnidade]) acc[tipoUnidade] = [];
        acc[tipoUnidade].push(m);
        return acc;
    }, {});

    const ordemPrioridade = ['CRAS','CREAS','SEDE','CT','CONSELHO','POP','ABRIGO'];
    const tiposOrdenados = Object.keys(grupos).sort((a,b) => {
        const ia = ordemPrioridade.indexOf(a);
        const ib = ordemPrioridade.indexOf(b);
        if (ia !== -1 && ib !== -1) return ia - ib;
        if (ia !== -1) return -1;
        if (ib !== -1) return 1;
        return a.localeCompare(b);
    });

    // Atualiza paginação para Modo TV da Visão Geral com base no maior grupo
    const maxItensPorGrupo = tiposOrdenados.reduce((max, t) => Math.max(max, (grupos[t] || []).length), 0);
    geralPagerState.maxItems = maxItensPorGrupo;
    geralPagerState.pages = Math.max(1, Math.ceil(maxItensPorGrupo / geralPagerState.pageSize));
    if (geralPagerState.page > geralPagerState.pages) geralPagerState.page = geralPagerState.pages;

    const inicio = (geralPagerState.page - 1) * geralPagerState.pageSize;
    const fim = inicio + geralPagerState.pageSize;

    const sectionsHtml = tiposOrdenados.map(tipo => {
        const lista = grupos[tipo] || [];
        const prontos = lista.filter(m => m.status === 'retirada').length;
        const separacao = lista.filter(m => m.status === 'separacao').length;
        const pendente = lista.filter(m => m.status === 'requisitado').length;
        const total = lista.length;

        const materiaisOrdenados = lista
            .sort((a,b) => {
                const statusOrder = { 'requisitado': 1, 'separacao': 2, 'retirada': 3 };
                const statusCompare = (statusOrder[a.status] || 9) - (statusOrder[b.status] || 9);
                if (statusCompare !== 0) return statusCompare;
                const tsA = (a.status === 'requisitado') ? (a.registradoEm?.toMillis() || 0)
                    : (a.status === 'separacao') ? (a.dataSeparacao?.toMillis() || a.registradoEm?.toMillis() || 0)
                    : (a.dataRetirada?.toMillis() || a.dataSeparacao?.toMillis() || 0);
                const tsB = (b.status === 'requisitado') ? (b.registradoEm?.toMillis() || 0)
                    : (b.status === 'separacao') ? (b.dataSeparacao?.toMillis() || b.registradoEm?.toMillis() || 0)
                    : (b.dataRetirada?.toMillis() || b.dataSeparacao?.toMillis() || 0);
                return tsA - tsB;
            });

        const paginaItens = materiaisOrdenados.slice(inicio, fim);
        const cardsHtml = paginaItens.map(m => {
            const unidade = m.unidadeNome || 'Unidade';
            const item = m.tipoMaterial || 'Item';
            const status = m.status;
            const borderCls = status === 'retirada' ? 'border-green-500' : status === 'separacao' ? 'border-yellow-400' : 'border-purple-500';
            const statusText = status === 'retirada' ? '✅ Pronto' : status === 'separacao' ? '⚙️ Em separação' : '📝 Pendente';
            const statusCls = status === 'retirada' ? 'status-green' : status === 'separacao' ? 'status-yellow' : 'status-purple';
            const separadorInfo = m.responsavelSeparador ? `<p class=\"text-[11px] text-yellow-700 mt-1\">Separador: ${m.responsavelSeparador}</p>` : '';
            return `
                <div class=\"compact-card ${borderCls}\">\n
                    <h3 class=\"compact-title\">${unidade}</h3>
                    <p class=\"compact-sub\">${item}</p>
                    ${separadorInfo}
                    <p class=\"compact-status ${statusCls}\">${statusText}</p>
                </div>`;
        }).join('');

        return `
        <section class=\"accordion-section\">
          <button class=\"accordion-header\" data-grupo=\"${tipo}\"> 
            <span>${tipo} <span class=\"text-gray-500\">(${total})</span></span>
            <span class=\"accordion-counts\">🟢 Prontos: ${prontos} | ⚙️ Em separação: ${separacao} | ⏳ Pendentes: ${pendente}</span>
          </button>
          <div id=\"grupo-${tipo}\" class=\"accordion-content\">
            <div class=\"grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3\">${cardsHtml || '<p class=\"text-sm text-slate-500\">Sem registros.</p>'}</div>
          </div>
        </section>`;
    }).join('');

    container.innerHTML = sectionsHtml || '<p class=\"text-sm text-slate-500\">Nenhum material encontrado.</p>';
    if (typeof lucide !== 'undefined' && typeof lucide.createIcons === 'function') { lucide.createIcons(); }
    // Atualiza UI do pager e auto-avançar no modo TV
    atualizarGeralPagerUI();
    const geralPane = document.getElementById('dashboard-view-geral');
    if (geralPane && geralPane.classList.contains('tv-mode') && geralPagerState.pages > 1) {
        iniciarAutoPagerGeralTV();
    } else {
        pararAutoPagerGeralTV();
    }
    return; // impede a execução do layout antigo
    
    // Agrupamento
    const gruposPendentes = pendentes.reduce((acc, m) => {
        let tipoUnidade = (m.tipoUnidade || 'OUTROS').toUpperCase();
        if (tipoUnidade === 'SEMCAS') tipoUnidade = 'SEDE';
        if (!acc[tipoUnidade]) acc[tipoUnidade] = [];
        acc[tipoUnidade].push(m);
        return acc;
    }, {});

    const tiposComDados = Object.keys(gruposPendentes).filter(tipo => gruposPendentes[tipo].length > 0).sort();
    const tiposNaoFixosComDados = tiposComDados.filter(tipo => !COLUNAS_DOM.includes(tipo)).sort();
    const tiposSubstitutos = [...tiposNaoFixosComDados];
    
    let totalPendentesVisiveis = 0;
    const mapeamentoColunas = []; 

    // Mapeamento de colunas fixas para tipos (com substituição)
    for (let i = 0; i < COLUNAS_DOM.length; i++) {
        const tipoFixo = COLUNAS_DOM[i];
        const fixoTemDados = gruposPendentes[tipoFixo] && gruposPendentes[tipoFixo].length > 0;
        
        if (fixoTemDados) {
            mapeamentoColunas.push(tipoFixo);
            totalPendentesVisiveis += gruposPendentes[tipoFixo].length;
        } else {
            if (tiposSubstitutos.length > 0) {
                const tipoSubstituto = tiposSubstitutos.shift(); 
                mapeamentoColunas.push(tipoSubstituto);
                totalPendentesVisiveis += gruposPendentes[tipoSubstituto].length;
            } else {
                mapeamentoColunas.push(null); 
            }
        }
    }
    
    // Atualiza páginas com base na maior coluna e renderiza o DOM
    const contagensPorTipo = mapeamentoColunas.map(tipo => (tipo ? (gruposPendentes[tipo]?.length || 0) : 0));
    const maxItens = contagensPorTipo.reduce((max,v) => Math.max(max,v), 0);
    geralPagerState.maxItems = maxItens;
    geralPagerState.pages = Math.max(1, Math.ceil(maxItens / geralPagerState.pageSize));
    if (geralPagerState.page > geralPagerState.pages) geralPagerState.page = geralPagerState.pages;

    colunaDOMElements.forEach((colunaDiv, index) => {
        const tipoExibido = mapeamentoColunas[index];
        const ulDestino = colunaDiv.querySelector('ul');
        const h4Cabecalho = colunaDiv.querySelector('h4');
        
        ulDestino.innerHTML = ''; 
        colunaDiv.classList.add('hidden'); 

        if (h4Cabecalho) h4Cabecalho.textContent = COLUNAS_DOM[index];

        if (tipoExibido) {
            colunaDiv.classList.remove('hidden'); 
            if (h4Cabecalho) h4Cabecalho.textContent = tipoExibido; 

            const materiaisDaColuna = gruposPendentes[tipoExibido] || [];
            
            if (materiaisDaColuna.length > 0) {
                 const materiaisOrdenados = materiaisDaColuna.sort((a,b) => {
                    const statusOrder = { 'requisitado': 1, 'separacao': 2, 'retirada': 3 };
                    const statusCompare = (statusOrder[a.status] || 9) - (statusOrder[b.status] || 9);
                    if (statusCompare !== 0) return statusCompare;
                    const tsA = (a.status === 'requisitado')
                        ? (a.registradoEm?.toMillis() || 0)
                        : (a.status === 'separacao')
                            ? (a.dataSeparacao?.toMillis() || a.registradoEm?.toMillis() || 0)
                            : (a.dataRetirada?.toMillis() || a.dataSeparacao?.toMillis() || 0);
                    const tsB = (b.status === 'requisitado')
                        ? (b.registradoEm?.toMillis() || 0)
                        : (b.status === 'separacao')
                            ? (b.dataSeparacao?.toMillis() || b.registradoEm?.toMillis() || 0)
                            : (b.dataRetirada?.toMillis() || b.dataSeparacao?.toMillis() || 0);
                    return tsA - tsB;
                 });

                 const inicio = (geralPagerState.page - 1) * geralPagerState.pageSize;
                 const fim = inicio + geralPagerState.pageSize;
                 const paginaItens = materiaisOrdenados.slice(inicio, fim);
                 paginaItens.forEach(m => {
                    const tiposMateriais = m.tipoMaterial || 'N/D';
                    
                    let liClass = '';
                    let spanClass = 'status-indicator';
                    let spanText = '';
                    let separadorInfo = ''; // NOVO: Variável para a informação do separador

                    if (m.status === 'requisitado') {
                        liClass = 'item-requisitado';
                        spanClass += ' requisitado'; 
                        spanText = '📝 Requisitado';
                    } else if (m.status === 'separacao') {
                        spanClass += ' separando'; 
                        spanText = '⏳ Separando...';
                        // NOVO: Adiciona o nome do separador APENAS no status 'separacao'
                        if (m.responsavelSeparador) {
                            separadorInfo = `<p class="text-xs text-yellow-700 mt-1 font-semibold">Separador: ${m.responsavelSeparador}</p>`;
                        }
                    } else if (m.status === 'retirada') {
                        liClass = 'item-retirada';
                        spanClass += ' pronto'; 
                        spanText = '✅ Pronto';
                    }

                    const li = document.createElement('li');
                    li.className = liClass;
                    li.innerHTML = `
                        <strong class="text-sm text-gray-800">${m.unidadeNome}</strong>
                        <p class="text-xs text-gray-500 capitalize">(${tiposMateriais})</p>
                        ${separadorInfo}
                        <div><span class="${spanClass}">${spanText}</span></div>
                    `;
                 ulDestino.appendChild(li);
                 });
            } else {
                 ulDestino.innerHTML = `<li class="text-sm text-slate-500 text-center py-4">Nenhum material pendente para ${tipoExibido}.</li>`;
            }
        }
    });

    if (totalPendentesVisiveis === 0) {
        const placeholder = `<li class="text-sm text-slate-500 text-center py-4">Nenhum material ${filterStatus ? `com status "${filterStatus}"` : 'pendente'} encontrado.</li>`;
        const primeiraColunaDiv = colunaDOMElements[0];
        if (primeiraColunaDiv) {
            const ulDestino = primeiraColunaDiv.querySelector('ul');
            if (ulDestino) ulDestino.innerHTML = placeholder;
            primeiraColunaDiv.classList.remove('hidden');
            const h4 = primeiraColunaDiv.querySelector('h4');
            if (h4) h4.textContent = COLUNAS_DOM[0];
        }
    }
    
    if (typeof lucide !== 'undefined' && typeof lucide.createIcons === 'function') { lucide.createIcons(); }
}

/**
 * Atualiza o filtro de materiais do dashboard.
 * @param {string|null} status Novo status de filtro.
 */
export function filterDashboardMateriais(status) {
    setCurrentDashboardMaterialFilter(status);
    renderDashboardMateriaisProntos(status);
}

/**
 * Função principal para renderizar todos os elementos do dashboard.
 */
export function renderDashboard() {
    renderDashboardAguaSummary();
    renderDashboardGasSummary();
    renderDashboardMateriaisCounts();
    renderDashboardMateriaisProntos(getCurrentDashboardMaterialFilter());
    renderDashboardMateriaisList();
}

/**
 * Inicia o auto-refresh do dashboard.
 */
export function startDashboardRefresh() {
    stopDashboardRefresh(); 
    console.log("Iniciando auto-refresh do Dashboard (2 min)");
    dashboardRefreshInterval = setInterval(() => {
        console.log("Atualizando dados do Dashboard (auto-refresh)...");
        renderDashboard(); 
        if (typeof lucide !== 'undefined' && typeof lucide.createIcons === 'function') { lucide.createIcons(); }
    }, 120000);
}

/**
 * Para o auto-refresh do dashboard.
 */
export function stopDashboardRefresh() {
    if (dashboardRefreshInterval) {
        console.log("Parando auto-refresh do Dashboard");
        clearInterval(dashboardRefreshInterval);
        dashboardRefreshInterval = null;
    }
}


// =========================================================================
// INICIALIZAÇÃO DE LISTENERS DO DOM
// =========================================================================

export function initDashboardListeners() {
    // CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
    if (DOM_ELEMENTS.dashboardNavControls) {
        DOM_ELEMENTS.dashboardNavControls.addEventListener('click', (e) => { 
            const btn = e.target.closest('button.dashboard-nav-btn[data-view]'); 
            if (btn) switchDashboardView(btn.dataset.view); 
        });
    }

    if (DOM_ELEMENTS.btnClearDashboardFilter) {
        DOM_ELEMENTS.btnClearDashboardFilter.addEventListener('click', () => {
             filterDashboardMateriais(null);
        });
    }
    // Botão para alternar para a sub-view de Materiais (Lista)
    const btnVerLista = document.getElementById('btn-dashboard-ver-lista');
    if (btnVerLista) {
        btnVerLista.addEventListener('click', () => switchDashboardView('materiais'));
    }
    // Botão para ativar/desativar Modo TV na visão geral
    const btnTvMode = document.getElementById('btn-tv-mode');
    if (btnTvMode) {
        btnTvMode.addEventListener('click', () => {
            const geralPane = document.getElementById('dashboard-view-geral');
            if (geralPane) {
                geralPane.classList.toggle('tv-mode');
                // Expandir largura para TVs/monitores grandes
                const mainEl = document.querySelector('main');
                if (mainEl) mainEl.classList.toggle('tv-wide');
                // Re-render para aplicar auto-pager se necessário
                renderDashboardMateriaisProntos(getCurrentDashboardMaterialFilter());
            }
        });
    }
    // Botão para alternar de volta para a Grade na sub-view Materiais
    const btnVerGrade = document.getElementById('btn-dashboard-ver-grade');
    if (btnVerGrade) {
        btnVerGrade.addEventListener('click', () => switchDashboardView('geral'));
    }
    // Botão Modo TV na sub-view Materiais
    const btnMateriaisTvMode = document.getElementById('btn-dashboard-materiais-tvmode');
    if (btnMateriaisTvMode) {
        btnMateriaisTvMode.addEventListener('click', () => {
            const materiaisPane = document.getElementById('dashboard-view-materiais');
            if (materiaisPane) {
                materiaisPane.classList.toggle('tv-mode');
                // Expandir largura para TVs/monitores grandes
                const mainEl = document.querySelector('main');
                if (mainEl) mainEl.classList.toggle('tv-wide');
                // Reinicia render para aplicar auto-pager se necessário
                renderDashboardMateriaisList();
            }
        });
    }
    // Listeners da paginação
    if (DOM_ELEMENTS.btnMateriaisPrevPage) {
        DOM_ELEMENTS.btnMateriaisPrevPage.addEventListener('click', () => {
            if (materiaisPagerState.page > 1) {
                materiaisPagerState.page -= 1;
                renderDashboardMateriaisList();
            }
        });
    }
    if (DOM_ELEMENTS.btnMateriaisNextPage) {
        DOM_ELEMENTS.btnMateriaisNextPage.addEventListener('click', () => {
            if (materiaisPagerState.page < materiaisPagerState.pages) {
                materiaisPagerState.page += 1;
                renderDashboardMateriaisList();
            }
        });
    }
    if (DOM_ELEMENTS.materiaisPageSizeSelect) {
        DOM_ELEMENTS.materiaisPageSizeSelect.addEventListener('change', (e) => {
            const val = parseInt(e.target.value, 10);
            if (!isNaN(val) && val > 0) {
                materiaisPagerState.pageSize = val;
                materiaisPagerState.page = 1;
                renderDashboardMateriaisList();
            }
        });
    }
    
    // Adiciona listeners para os cards de KPI (Em Separação e Retirada)
    const cardSeparacao = document.getElementById('dashboard-card-separacao');
    const cardRetirada = document.getElementById('dashboard-card-retirada');

    // MANTIDO: O card "Em Separação" aciona o filtro 'separacao', que agora inclui 'requisitado' e 'separacao'
    if (cardSeparacao) cardSeparacao.addEventListener('click', () => filterDashboardMateriais('separacao')); 
    if (cardRetirada) cardRetirada.addEventListener('click', () => filterDashboardMateriais('retirada'));

    // Filtros globais (Visão Geral agrupada)
    if (DOM_ELEMENTS.btnFilterTodos) DOM_ELEMENTS.btnFilterTodos.addEventListener('click', () => {
        geralFilterStatus = 'todos';
        marcarFiltroAtivo('todos');
        renderDashboardMateriaisProntos(getCurrentDashboardMaterialFilter());
    });
    if (DOM_ELEMENTS.btnFilterSeparacao) DOM_ELEMENTS.btnFilterSeparacao.addEventListener('click', () => {
        geralFilterStatus = 'separacao';
        marcarFiltroAtivo('separacao');
        renderDashboardMateriaisProntos(getCurrentDashboardMaterialFilter());
    });
    if (DOM_ELEMENTS.btnFilterPronto) DOM_ELEMENTS.btnFilterPronto.addEventListener('click', () => {
        geralFilterStatus = 'pronto';
        marcarFiltroAtivo('pronto');
        renderDashboardMateriaisProntos(getCurrentDashboardMaterialFilter());
    });
    if (DOM_ELEMENTS.btnFilterPendente) DOM_ELEMENTS.btnFilterPendente.addEventListener('click', () => {
        geralFilterStatus = 'pendente';
        marcarFiltroAtivo('pendente');
        renderDashboardMateriaisProntos(getCurrentDashboardMaterialFilter());
    });
    if (DOM_ELEMENTS.inputBuscaMateriaisGeral) DOM_ELEMENTS.inputBuscaMateriaisGeral.addEventListener('input', (e) => {
        geralSearchQuery = e.target.value || '';
        renderDashboardMateriaisProntos(getCurrentDashboardMaterialFilter());
    });

    // Delegação para recolher/expandir grupos
    if (DOM_ELEMENTS.dashboardMateriaisProntosContainer) {
        DOM_ELEMENTS.dashboardMateriaisProntosContainer.addEventListener('click', (e) => {
            const btn = e.target.closest('button.accordion-header[data-grupo]');
            if (!btn) return;
            const tipo = btn.dataset.grupo;
            const content = document.getElementById(`grupo-${tipo}`);
            if (content) content.classList.toggle('collapsed');
        });
    }

    // Listeners do pager da Visão Geral
    if (DOM_ELEMENTS.btnGeralPrevPage) {
        DOM_ELEMENTS.btnGeralPrevPage.addEventListener('click', () => {
            if (geralPagerState.page > 1) {
                geralPagerState.page -= 1;
                renderDashboardMateriaisProntos(getCurrentDashboardMaterialFilter());
            }
        });
    }
    if (DOM_ELEMENTS.btnGeralNextPage) {
        DOM_ELEMENTS.btnGeralNextPage.addEventListener('click', () => {
            if (geralPagerState.page < geralPagerState.pages) {
                geralPagerState.page += 1;
                renderDashboardMateriaisProntos(getCurrentDashboardMaterialFilter());
            }
        });
    }
    if (DOM_ELEMENTS.geralPageSizeSelect) {
        DOM_ELEMENTS.geralPageSizeSelect.addEventListener('change', (e) => {
            const val = parseInt(e.target.value, 10);
            if (!isNaN(val) && val > 0) {
                geralPagerState.pageSize = val;
                geralPagerState.page = 1;
                renderDashboardMateriaisProntos(getCurrentDashboardMaterialFilter());
            }
        });
    }

    // Atualiza ícones Lucide caso necessário
    if (typeof lucide !== 'undefined' && typeof lucide.createIcons === 'function') { lucide.createIcons(); }
    // Atualiza UI do pager geral
    atualizarGeralPagerUI();
    // Auto-avança páginas no Modo TV da visão geral
    const geralPane = document.getElementById('dashboard-view-geral');
    if (geralPane && geralPane.classList.contains('tv-mode') && geralPagerState.pages > 1) {
        iniciarAutoPagerGeralTV();
    } else {
        pararAutoPagerGeralTV();
    }
}

// =====================
// Helpers: Pager Materiais
// =====================
function atualizarPagerUI() {
    if (!DOM_ELEMENTS.dashboardMateriaisPagerContainer || !DOM_ELEMENTS.materiaisPagerInfo) return;
    const total = materiaisPagerState.total;
    const page = materiaisPagerState.page;
    const pages = materiaisPagerState.pages;
    const pageSize = materiaisPagerState.pageSize;
    const showing = Math.min(pageSize, Math.max(0, total - (page - 1) * pageSize));
    DOM_ELEMENTS.materiaisPagerInfo.textContent = `Página ${page} de ${pages} • ${showing} itens de ${total}`;
    if (DOM_ELEMENTS.btnMateriaisPrevPage) DOM_ELEMENTS.btnMateriaisPrevPage.disabled = page <= 1;
    if (DOM_ELEMENTS.btnMateriaisNextPage) DOM_ELEMENTS.btnMateriaisNextPage.disabled = page >= pages;
}

function iniciarAutoPagerTV() {
    pararAutoPagerTV();
    materiaisAutoPagerInterval = setInterval(() => {
        if (materiaisPagerState.pages <= 1) return;
        materiaisPagerState.page = materiaisPagerState.page >= materiaisPagerState.pages ? 1 : materiaisPagerState.page + 1;
        renderDashboardMateriaisList();
    }, 10000); // troca a página a cada 10s
}

function pararAutoPagerTV() {
    if (materiaisAutoPagerInterval) {
        clearInterval(materiaisAutoPagerInterval);
        materiaisAutoPagerInterval = null;
    }
}

// =====================
// Helpers: Pager Visão Geral
// =====================
function atualizarGeralPagerUI() {
    if (!DOM_ELEMENTS.dashboardMateriaisProntosPager || !DOM_ELEMENTS.geralPagerInfo) return;
    const page = geralPagerState.page;
    const pages = geralPagerState.pages;
    const pageSize = geralPagerState.pageSize;
    DOM_ELEMENTS.geralPagerInfo.textContent = `Página ${page} de ${pages} • até ${pageSize} itens/coluna`;
    if (DOM_ELEMENTS.btnGeralPrevPage) DOM_ELEMENTS.btnGeralPrevPage.disabled = page <= 1;
    if (DOM_ELEMENTS.btnGeralNextPage) DOM_ELEMENTS.btnGeralNextPage.disabled = page >= pages;
}

function iniciarAutoPagerGeralTV() {
    pararAutoPagerGeralTV();
    geralAutoPagerInterval = setInterval(() => {
        if (geralPagerState.pages <= 1) return;
        geralPagerState.page = geralPagerState.page >= geralPagerState.pages ? 1 : geralPagerState.page + 1;
        renderDashboardMateriaisProntos(getCurrentDashboardMaterialFilter());
    }, 10000);
}

function pararAutoPagerGeralTV() {
    if (geralAutoPagerInterval) {
        clearInterval(geralAutoPagerInterval);
        geralAutoPagerInterval = null;
    }
}

// Helper para destacar o filtro ativo na UI (Visão Geral)
function marcarFiltroAtivo(chave) {
    const map = {
        todos: DOM_ELEMENTS.btnFilterTodos,
        separacao: DOM_ELEMENTS.btnFilterSeparacao,
        pronto: DOM_ELEMENTS.btnFilterPronto,
        pendente: DOM_ELEMENTS.btnFilterPendente,
    };
    Object.values(map).forEach(el => { if (el) el.classList?.remove('active'); });
    const el = map[chave];
    if (el) el.classList?.add('active');
}
