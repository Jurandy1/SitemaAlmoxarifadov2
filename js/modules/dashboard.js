// js/modules/dashboard.js
import { getAguaMovimentacoes, getGasMovimentacoes, getEstoqueAgua, getEstoqueGas, getMateriais, isEstoqueInicialDefinido, getCurrentDashboardMaterialFilter, setCurrentDashboardMaterialFilter, initialMaterialFilter } from "../utils/cache.js";
import { DOM_ELEMENTS, showAlert, switchTab } from "../utils/dom-helpers.js";
import { formatTimestamp } from "../utils/formatters.js";

let dashboardAguaChartInstance, dashboardGasChartInstance;
let dashboardRefreshInterval = null;

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
    }
    if(viewName === 'materiais') renderDashboardMateriaisList();
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
    if (!DOM_ELEMENTS.dashboardMateriaisListContainer || !DOM_ELEMENTS.loadingMateriaisDashboard) return; 
    
    DOM_ELEMENTS.loadingMateriaisDashboard.style.display = 'none'; 
     
    const pendentes = getMateriais()
        .filter(m => m.status === 'requisitado' || m.status === 'separacao' || m.status === 'retirada')
        .sort((a,b) => { 
            const statusOrder = { 'requisitado': 1, 'separacao': 2, 'retirada': 3 }; 
            const statusCompare = (statusOrder[a.status] || 9) - (statusOrder[b.status] || 9);
            if (statusCompare !== 0) return statusCompare;
            return (a.dataSeparacao?.toMillis() || 0) - (b.dataSeparacao?.toMillis() || 0); 
        }); 
    
    if (pendentes.length === 0) { 
        DOM_ELEMENTS.dashboardMateriaisListContainer.innerHTML = '<p class="text-sm text-slate-500 text-center py-4">Nenhum material pendente.</p>'; 
        return; 
    }
    
    const html = pendentes.map(m => {
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

        return ` 
            <div class="p-3 ${bgColor} rounded-lg border ${borderColor}"> 
                <div class="flex justify-between items-center gap-2"> 
                    <span class="font-medium text-slate-700 text-sm truncate" title="${m.unidadeNome || ''}">${m.unidadeNome || 'Unidade Desc.'}</span> 
                    <span class="badge ${badgeClass} flex-shrink-0">${badgeText} (${formatTimestamp(m.dataSeparacao)})</span> 
                </div> 
                <p class="text-xs text-slate-600 capitalize mt-1">${m.tipoMaterial || 'N/D'}</p> 
                ${m.itens ? `<p class="text-xs text-gray-500 mt-1 truncate" title="${m.itens}">Obs: ${m.itens}</p>` : ''} 
            </div> `
    }).join('');

    DOM_ELEMENTS.dashboardMateriaisListContainer.innerHTML = html;
}

/**
 * Renderiza os contadores de materiais para a visão geral e sub-views.
 */
function renderDashboardMateriaisCounts() {
    if (!DOM_ELEMENTS.summaryMateriaisRequisitado) return;
    
    const materiais = getMateriais();

    const requisitadoCount = materiais.filter(m => m.status === 'requisitado').length;
    const separacaoCount = materiais.filter(m => m.status === 'separacao').length;
    const retiradaCount = materiais.filter(m => m.status === 'retirada').length;
    
    // Atualiza os cards do Dashboard (topo)
    if (DOM_ELEMENTS.dashboardMateriaisSeparacaoCountEl) DOM_ELEMENTS.dashboardMateriaisSeparacaoCountEl.textContent = requisitadoCount + separacaoCount;
    if (DOM_ELEMENTS.dashboardMateriaisRetiradaCountEl) DOM_ELEMENTS.dashboardMateriaisRetiradaCountEl.textContent = retiradaCount;
    
    // Atualiza os summaries da subview de lançamento de materiais
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
    const container = DOM_ELEMENTS.dashboardMateriaisProntosContainer;
    const titleEl = DOM_ELEMENTS.dashboardMateriaisTitle; 
    const clearButton = DOM_ELEMENTS.btnClearDashboardFilter; 

    if (!container) return; 
    
    const COLUNAS_DOM = ['CT', 'SEDE', 'CRAS', 'CREAS', 'ABRIGO'];
    const colunaDOMElements = Array.from(container.querySelectorAll('.materiais-prontos-col'));
    const materiais = getMateriais();
    
    // --- Lógica de filtragem ---
    let pendentes = materiais.filter(m => m.status === 'requisitado' || m.status === 'separacao' || m.status === 'retirada');
    
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
    
    // Agrupamento
    const gruposPendentes = pendentes.reduce((acc, m) => {
        let tipoUnidade = (m.tipoUnidade || 'OUTROS').toUpperCase();
        if (tipoUnidade === 'SEMCAS') tipoUnidade = 'SEDE';
        if (!acc[tipoUnidade]) acc[tipoUnidade] = [];
        acc[tipoUnidade].push(m);
        return acc;
    }, {});

    const tiposComDados = Object.keys(gruposPendentes).filter(tipo => gruposPendentes[tipo].length > 0).sort();
    const tiposNaoFixosComDados = tiposComDados.filter(tipo => !COLUNAS_DOM.includes(tipo));
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
    
    // Renderiza o DOM
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
                    return (a.dataSeparacao?.toMillis() || 0) - (b.dataSeparacao?.toMillis() || 0);
                 });

                 materiaisOrdenados.forEach(m => {
                    const tiposMateriais = m.tipoMaterial || 'N/D';
                    
                    let liClass = '';
                    let spanClass = 'status-indicator';
                    let spanText = '';

                    if (m.status === 'requisitado') {
                        liClass = 'item-requisitado';
                        spanClass += ' requisitado'; 
                        spanText = '📝 Requisitado';
                    } else if (m.status === 'separacao') {
                        spanClass += ' separando'; 
                        spanText = '⏳ Separando...';
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
    
    // Adiciona listeners para os cards de KPI (Em Separação e Retirada)
    const cardSeparacao = document.getElementById('dashboard-card-separacao');
    const cardRetirada = document.getElementById('dashboard-card-retirada');

    if (cardSeparacao) cardSeparacao.addEventListener('click', () => filterDashboardMateriais('separacao'));
    if (cardRetirada) cardRetirada.addEventListener('click', () => filterDashboardMateriais('retirada'));
}
