// js/modules/dashboard.js
import { getAguaMovimentacoes, getGasMovimentacoes, getEstoqueAgua, getEstoqueGas, getMateriais, getEntregas, getCurrentDashboardMaterialFilter, setCurrentDashboardMaterialFilter } from "../utils/cache.js";
import { DOM_ELEMENTS } from "../utils/dom-helpers.js";
import { formatTimestamp } from "../utils/formatters.js";
import Chart from 'chart.js/auto';

let dashboardAguaChartInstance, dashboardGasChartInstance;
let dashboardRefreshInterval = null;
// Estado de paginação da lista de Materiais
let materiaisPagerState = { page: 1, pageSize: 20, total: 0, pages: 1, data: [] };
let materiaisAutoPagerInterval = null;
// Estado de paginação da grade da Visão Geral (Materiais do Almoxarifado)
let geralPagerState = { page: 1, pageSize: 5, pages: 1, maxItems: 0 };
let geralAutoPagerInterval = null;
let geralAutoScrollTimers = [];
// Filtros globais e busca da Visão Geral (agrupamento)
let geralFilterStatus = 'todos'; // 'todos' | 'separacao' | 'pronto' | 'pendente'
let geralSearchQuery = '';
let __tvFichaBound = false;

// =========================================================================
// FUNÇÕES DE UTILIDADE DO DASHBOARD
// =========================================================================

// ── Filtro: apenas documentos do novo módulo de separação (v2) ──
// Documentos antigos (v1, sem _version) ficam apenas no histórico.
function getActiveV2Materiais() {
    return (getMateriais() || []).filter(m => {
        if (m?.deleted) return false;
        if (m?._version === 2) return true;
        if (m?.origemFluxo === 'v2') return true;
        if (m?.itemsMap && typeof m.itemsMap === 'object') return true;
        return false;
    });
}

function isHistoricoImportado(m) {
    if (!m) return false;
    if (m.origem === 'importador_sql') return true;
    const obs = (m.observacao || '').toLowerCase();
    if (obs.includes('importado de sql')) return true;
    if (typeof m.referenciaAno === 'number' || typeof m.referenciaMes === 'number' || typeof m.referenciaSemana === 'number') return true;
    return false;
}

/**
 * Filtra movimentações dos últimos 30 dias.
 */
function filterLast30Days(movimentacoes) {
    if (!Array.isArray(movimentacoes)) return [];
    
    const today = new Date(); 
    today.setHours(23, 59, 59, 999); 
    const thirtyDaysAgo = new Date(today); 
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30); 
    thirtyDaysAgo.setHours(0, 0, 0, 0); 
    
    const thirtyDaysAgoTimestamp = thirtyDaysAgo.getTime();
    const todayTimestamp = today.getTime();
    
    return movimentacoes.filter(m => {
        if (isHistoricoImportado(m)) return false; // não contar histórico importado
        if (!m.data || typeof m.data.toDate !== 'function') return false; 
        const mTimestamp = m.data.toMillis();
        return mTimestamp >= thirtyDaysAgoTimestamp && mTimestamp <= todayTimestamp;
    });
}

/**
 * Prepara dados para os gráficos de linha dos últimos 30 dias (Água/Gás).
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
        try {
            const mDate = m.data.toDate(); 
            mDate.setHours(0,0,0,0);
            const dateKey = `${mDate.getFullYear()}-${String(mDate.getMonth() + 1).padStart(2, '0')}-${String(mDate.getDate()).padStart(2, '0')}`; 
            if (dataMap.has(dateKey)) { 
                const dayData = dataMap.get(dateKey); 
                if (m.tipo === 'entrega') dayData.entregas += m.quantidade; 
                else if (m.tipo === 'retorno') dayData.retornos += m.quantidade; 
            } 
        } catch (e) { console.warn('Erro ao processar data para gráfico:', e); }
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

export function renderDashboardAguaChart() {
    try {
        const ctx = document.getElementById('dashboardAguaChart')?.getContext('2d'); 
        if (!ctx) return; 
        const data = getChartDataLast30Days(getAguaMovimentacoes()); 
        if (dashboardAguaChartInstance) { 
            dashboardAguaChartInstance.data = data; 
            dashboardAguaChartInstance.update(); 
        } else if (typeof Chart !== 'undefined') { 
            dashboardAguaChartInstance = new Chart(ctx, { type: 'line', data: data, options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } }, plugins: { legend: { position: 'top' } } } }); 
        }
    } catch (e) { console.error("Erro ao renderizar gráfico Água:", e); }
}

export function renderDashboardGasChart() {
    try {
        const ctx = document.getElementById('dashboardGasChart')?.getContext('2d'); 
        if (!ctx) return; 
        const data = getChartDataLast30Days(getGasMovimentacoes()); 
        if (dashboardGasChartInstance) { 
            dashboardGasChartInstance.data = data; 
            dashboardGasChartInstance.update(); 
        } else if (typeof Chart !== 'undefined') { 
            dashboardGasChartInstance = new Chart(ctx, { type: 'line', data: data, options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } }, plugins: { legend: { position: 'top' } } } }); 
        }
    } catch (e) { console.error("Erro ao renderizar gráfico Gás:", e); }
}

function renderDashboardAguaSummary() {
    try {
        const movs = (getAguaMovimentacoes() || []).filter(m => !isHistoricoImportado(m));
        const estoqueAgua = getEstoqueAgua() || [];

        const estoqueInicial = estoqueAgua.filter(e => e.tipo === 'inicial').reduce((sum, e) => sum + (e.quantidade || 0), 0);
        const totalEntradas = estoqueAgua.filter(e => e.tipo === 'entrada').reduce((sum, e) => sum + (e.quantidade || 0), 0);
        const totalSaidas = movs.filter(m => m.tipo === 'entrega').reduce((sum, m) => sum + (m.quantidade || 0), 0);
        const estoqueAtual = Math.max(0, estoqueInicial + totalEntradas - totalSaidas);

        const totalEntregueGeral = movs.filter(m => m.tipo === 'entrega').reduce((sum, m) => sum + (m.quantidade || 0), 0);
        const totalRecebidoGeral = movs.filter(m => (m.tipo === 'retorno' || m.tipo === 'retirada')).reduce((sum, m) => sum + (m.quantidade || 0), 0);
        
        const movs30Dias = filterLast30Days(movs);
        const totalEntregue30d = movs30Dias.filter(m => m.tipo === 'entrega').reduce((sum, m) => sum + (m.quantidade || 0), 0);
        const totalRecebido30d = movs30Dias.filter(m => (m.tipo === 'retorno' || m.tipo === 'retirada')).reduce((sum, m) => sum + (m.quantidade || 0), 0);

        if (DOM_ELEMENTS.summaryAguaPendente) DOM_ELEMENTS.summaryAguaPendente.textContent = totalEntregueGeral - totalRecebidoGeral; 
        if (DOM_ELEMENTS.summaryAguaEntregue) DOM_ELEMENTS.summaryAguaEntregue.textContent = totalEntregue30d;
        if (DOM_ELEMENTS.summaryAguaRecebido) DOM_ELEMENTS.summaryAguaRecebido.textContent = totalRecebido30d;
        
        if (DOM_ELEMENTS.dashboardEstoqueAguaEl) DOM_ELEMENTS.dashboardEstoqueAguaEl.textContent = estoqueAtual;
    } catch (e) { console.error("Erro ao renderizar sumário Água:", e); }
}

function renderDashboardGasSummary() {
    try {
        const movs = (getGasMovimentacoes() || []).filter(m => !isHistoricoImportado(m));
        const estoqueGas = getEstoqueGas() || [];

        const estoqueInicial = estoqueGas.filter(e => e.tipo === 'inicial').reduce((sum, e) => sum + (e.quantidade || 0), 0);
        const totalEntradas = estoqueGas.filter(e => e.tipo === 'entrada').reduce((sum, e) => sum + (e.quantidade || 0), 0);
        const totalSaidas = movs.filter(m => m.tipo === 'entrega').reduce((sum, m) => sum + (m.quantidade || 0), 0);
        const estoqueAtual = Math.max(0, estoqueInicial + totalEntradas - totalSaidas);
        
        const totalEntregueGeral = movs.filter(m => m.tipo === 'entrega').reduce((sum, m) => sum + (m.quantidade || 0), 0);
        const totalRecebidoGeral = movs.filter(m => (m.tipo === 'retorno' || m.tipo === 'retirada')).reduce((sum, m) => sum + (m.quantidade || 0), 0);
        
        const movs30Dias = filterLast30Days(movs);
        const totalEntregue30d = movs30Dias.filter(m => m.tipo === 'entrega').reduce((sum, m) => sum + (m.quantidade || 0), 0);
        const totalRecebido30d = movs30Dias.filter(m => (m.tipo === 'retorno' || m.tipo === 'retirada')).reduce((sum, m) => sum + (m.quantidade || 0), 0);

        if (DOM_ELEMENTS.summaryGasPendente) DOM_ELEMENTS.summaryGasPendente.textContent = totalEntregueGeral - totalRecebidoGeral; 
        if (DOM_ELEMENTS.summaryGasEntregue) DOM_ELEMENTS.summaryGasEntregue.textContent = totalEntregue30d;
        if (DOM_ELEMENTS.summaryGasRecebido) DOM_ELEMENTS.summaryGasRecebido.textContent = totalRecebido30d;

        if (DOM_ELEMENTS.dashboardEstoqueGasEl) DOM_ELEMENTS.dashboardEstoqueGasEl.textContent = estoqueAtual;
    } catch (e) { console.error("Erro ao renderizar sumário Gás:", e); }
}

function renderDashboardMateriaisList() {
    if (!DOM_ELEMENTS.dashboardMateriaisListContainer || !DOM_ELEMENTS.loadingMateriaisDashboard) return; 
    
    try {
        DOM_ELEMENTS.loadingMateriaisDashboard.style.display = 'none'; 
        
        const pendentes = getActiveV2Materiais()
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
        const materiaisPane = document.getElementById('dashboard-view-materiais');
        if (materiaisPane && materiaisPane.classList.contains('tv-mode') && materiaisPagerState.pages > 1) {
            iniciarAutoPagerTV();
        } else {
            pararAutoPagerTV();
        }
    } catch(e) {
        console.error("Erro ao renderizar lista materiais:", e);
    }
}

function renderDashboardMateriaisCounts() {
    // if (!DOM_ELEMENTS.summaryMateriaisRequisitado) return; // Removido para permitir atualização parcial (Modo TV)
    
    try {
        const entregas = (getEntregas() || []).filter(m => !m.deleted && (m._version === 2 || m.origemFluxo === 'v2'));
        const materiais = entregas.length ? entregas : getActiveV2Materiais();

        const requisitadoCount = materiais.filter(m => m.status === 'requisitado').length;
        const separacaoCount = materiais.filter(m => m.status === 'separacao' || m.status === 'separando').length;
        const retiradaCount = materiais.filter(m => m.status === 'retirada' || m.status === 'pronto').length;
        
        const emSeparacaoDashboard = requisitadoCount + separacaoCount;

        if (DOM_ELEMENTS.dashboardMateriaisSeparacaoCountEl) DOM_ELEMENTS.dashboardMateriaisSeparacaoCountEl.textContent = emSeparacaoDashboard;
        if (DOM_ELEMENTS.dashboardMateriaisRetiradaCountEl) DOM_ELEMENTS.dashboardMateriaisRetiradaCountEl.textContent = retiradaCount;
        
        if (DOM_ELEMENTS.summaryMateriaisRequisitado) DOM_ELEMENTS.summaryMateriaisRequisitado.textContent = requisitadoCount;
        if (DOM_ELEMENTS.summaryMateriaisSeparacao) DOM_ELEMENTS.summaryMateriaisSeparacao.textContent = separacaoCount;
        if (DOM_ELEMENTS.summaryMateriaisRetirada) DOM_ELEMENTS.summaryMateriaisRetirada.textContent = retiradaCount;
    } catch(e) {
        console.error("Erro nos contadores de materiais:", e);
    }
}

export function renderDashboardMateriaisProntos(filterStatus = null) {
    const container = DOM_ELEMENTS.dashboardMateriaisProntosContainer;
    const titleEl = DOM_ELEMENTS.dashboardMateriaisTitle; 
    const clearButton = DOM_ELEMENTS.btnClearDashboardFilter; 
    
    // VERIFICAÇÃO DO MODO TV (NOVO LAYOUT)
    if (DOM_ELEMENTS.tvListSeparacao && DOM_ELEMENTS.tvListPronto) {
        renderTVDashboard(DOM_ELEMENTS.tvListSeparacao, DOM_ELEMENTS.tvListPronto);
        if (!container) return;
    }

    if (!container) return; 
    
    try {
        const materiais = getActiveV2Materiais();
        
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

        geralPagerState.pages = 1;
        geralPagerState.page = 1;

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
            const cardsHtml = materiaisOrdenados.map(m => {
                const unidade = m.unidadeNome || 'Unidade';
                const item = m.tipoMaterial || 'Item';
                const status = m.status;
                const borderCls = status === 'retirada' ? 'border-green-500' : status === 'separacao' ? 'border-yellow-400' : 'border-purple-500';
                const statusText = status === 'retirada' ? 'Pronto' : status === 'separacao' ? 'Em separação' : 'Pendente';
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
                <span class=\"accordion-counts\"><span class=\"text-green-600 font-semibold\">${prontos} prontos</span> · <span class=\"text-yellow-700 font-semibold\">${separacao} separação</span> · <span class=\"text-purple-700 font-semibold\">${pendente} pendentes</span></span>
              </button>
              <div id=\"grupo-${tipo}\" class=\"accordion-content\">
                <div class=\"grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3\">${cardsHtml || '<p class=\"text-sm text-slate-500\">Sem registros.</p>'}</div>
              </div>
            </section>`;
        }).join('');

        container.innerHTML = sectionsHtml || '<p class=\"text-sm text-slate-500\">Nenhum material encontrado.</p>';
        if (typeof lucide !== 'undefined' && typeof lucide.createIcons === 'function') { lucide.createIcons(); }
        
        atualizarGeralPagerUI();
        const geralPane = document.getElementById('dashboard-view-geral');
        if (geralPane && geralPane.classList.contains('tv-mode')) {
            startAutoScrollGeralTV();
        } else {
            stopAutoScrollGeralTV();
        }
    } catch(e) {
        console.error("Erro ao renderizar materiais prontos:", e);
    }
}

// FUNÇÃO ESPECÍFICA PARA O NOVO PAINEL TV
function renderTVDashboard(containerSeparacao, containerPronto) {
    try {
        const materiais = getActiveV2Materiais();
        
        // Filtra e Ordena
        // Em Preparação = Requisitado + Separação
        const emSeparacao = materiais
            .filter(m => m.status === 'requisitado' || m.status === 'separacao')
            .sort((a, b) => {
                const tsA = (a.dataSeparacao?.toMillis() || a.registradoEm?.toMillis() || 0);
                const tsB = (b.dataSeparacao?.toMillis() || b.registradoEm?.toMillis() || 0);
                return tsA - tsB; // Mais antigos primeiro
            });

        // Prontos = Retirada
        const prontos = materiais
            .filter(m => m.status === 'retirada')
            .sort((a, b) => {
                const tsA = (a.dataRetirada?.toMillis() || a.registradoEm?.toMillis() || 0);
                const tsB = (b.dataRetirada?.toMillis() || b.registradoEm?.toMillis() || 0);
                return tsB - tsA; // Mais recentes primeiro
            });

        // Atualiza contadores (Headers das Colunas)
        if (DOM_ELEMENTS.countSeparacaoHeader) DOM_ELEMENTS.countSeparacaoHeader.textContent = emSeparacao.length;
        if (DOM_ELEMENTS.countProntoHeader) DOM_ELEMENTS.countProntoHeader.textContent = prontos.length;

        // Atualiza contadores (KPIs do Topo)
        if (DOM_ELEMENTS.dashboardMateriaisSeparacaoCountEl) DOM_ELEMENTS.dashboardMateriaisSeparacaoCountEl.textContent = emSeparacao.length;
        if (DOM_ELEMENTS.dashboardMateriaisRetiradaCountEl) DOM_ELEMENTS.dashboardMateriaisRetiradaCountEl.textContent = prontos.length;

        const escapeHTML = (input) => String(input ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');

        const TYPE_MAP = {
            'CRAS': { slug: 'cras', label: 'CRAS' },
            'CREAS': { slug: 'creas', label: 'CREAS' },
            'SEDE': { slug: 'sede', label: 'Sede / SEMCAS' },
            'SEMCAS': { slug: 'sede', label: 'Sede / SEMCAS' },
            'CT': { slug: 'ct', label: 'CT — Conselho Tutelar' },
            'CONSELHO': { slug: 'ct', label: 'CT — Conselho Tutelar' },
            'ABRIGO': { slug: 'abrigo', label: 'Abrigos' },
            'POP': { slug: 'pop', label: 'Centro POP' },
        };
        const SLUG_PRIO = ['cras', 'creas', 'sede', 'ct', 'abrigo', 'pop', 'outros'];

        const normalizeTipo = (raw) => {
            const k = String(raw || 'OUTROS').toUpperCase();
            return TYPE_MAP[k] || { slug: 'outros', label: k };
        };

        const groupByTipo = (arr) => {
            const map = new Map();
            arr.forEach((m) => {
                // Fallback: se tipoUnidade está vazio (docs v2 antigos), detecta do nome
                let rawTipo = m.tipoUnidade || '';
                if (!rawTipo && m.unidadeNome) {
                    const nome = String(m.unidadeNome).toUpperCase();
                    if (nome.startsWith('CRAS')) rawTipo = 'CRAS';
                    else if (nome.startsWith('CREAS')) rawTipo = 'CREAS';
                    else if (nome.includes('CT ') || nome.startsWith('CT')) rawTipo = 'CT';
                    else if (nome.includes('CENTRO POP') || nome.includes('POP')) rawTipo = 'POP';
                    else if (nome.includes('SEDE') || nome.includes('SEMCAS') || nome.includes('GABINETE')) rawTipo = 'SEDE';
                    else if (nome.includes('ABRIGO') || nome.includes('RESIDÊNCIA') || nome.includes('LUZ E VIDA') || nome.includes('ACOLHER')) rawTipo = 'ABRIGO';
                }
                const tipo = normalizeTipo(rawTipo);
                const key = tipo.label;
                const entry = map.get(key) || { tipo, items: [] };
                entry.items.push(m);
                map.set(key, entry);
            });
            return Array.from(map.values()).sort((a, b) => {
                const pa = SLUG_PRIO.indexOf(a.tipo.slug);
                const pb = SLUG_PRIO.indexOf(b.tipo.slug);
                if (pa !== -1 && pb !== -1) return pa - pb;
                if (pa !== -1) return -1;
                if (pb !== -1) return 1;
                return a.tipo.label.localeCompare(b.tipo.label);
            });
        };

        const groupHTML = (group, panelType) => {
            const slug = escapeHTML(group.tipo.slug);
            const label = escapeHTML(group.tipo.label);
            const count = group.items.length;
            const countText = `${count} ${count === 1 ? 'item' : 'itens'}`;
            return `
                <div class="type-group">
                    <div class="type-group-hdr">
                        <span class="type-pill ${slug}">${label}</span>
                        <span class="type-count ${slug}">${countText}</span>
                        <div class="type-line"></div>
                    </div>
                    ${group.items.map(m => createTVCard(m, panelType, escapeHTML)).join('')}
                </div>
            `;
        };

        const renderCol = (container, groups, panelType) => {
            if (!container) return;
            if (!groups.length) {
                container.innerHTML = `
                    <div class="empty">
                        <div class="empty-ic">${panelType === 'rdy' ? '🕐' : '✔'}</div>
                        <div class="empty-tx">${panelType === 'rdy' ? 'Nenhum material aguardando retirada' : 'Nenhuma requisição em preparação'}</div>
                    </div>
                `;
                return;
            }
            container.innerHTML = groups.map(g => groupHTML(g, panelType)).join('');
        };

        renderCol(containerSeparacao, groupByTipo(emSeparacao), 'prep');
        renderCol(containerPronto, groupByTipo(prontos), 'rdy');

        [containerSeparacao, containerPronto].forEach((c) => {
            if (!c) return;
            c.querySelectorAll('.card[data-mat-id]').forEach((el) => {
                const id = el.getAttribute('data-mat-id');
                if (!id) return;
                el.style.cursor = 'pointer';
                el.addEventListener('click', () => openTVFichaById(id));
            });
        });

        // Inicia Auto-Scroll se necessário
        handleTVAutoScroll(containerSeparacao);
        handleTVAutoScroll(containerPronto);

    } catch (e) {
        console.error("Erro render TV Dashboard:", e);
    }
}

function createTVCard(m, panelType, escapeHTML) {
    const esc = typeof escapeHTML === 'function'
        ? escapeHTML
        : (input) => String(input ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');

    const unidade = esc(m.unidadeNome || 'Unidade');

    // v2: mostra tipos como pills; v1: mostra tipoMaterial simples
    const isV2 = m._version === 2 || m.itemsMap;
    let tipoHtml = '';
    if (isV2 && Array.isArray(m.tiposMaterial) && m.tiposMaterial.length) {
        tipoHtml = m.tiposMaterial.map(t => {
            const slug = esc(String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z]/g, ''));
            return `<span class="tv-tipo-pill ${slug}">${esc(t)}</span>`;
        }).join(' ');
    } else {
        tipoHtml = `<span class="tv-tipo-pill">${esc((m.tipoMaterial || 'material').toLowerCase())}</span>`;
    }

    // v2: mostra resumo dos itens do itemsMap; v1: mostra m.itens (texto)
    let obsHtml = '';
    if (isV2 && m.itemsMap && typeof m.itemsMap === 'object') {
        const items = Object.values(m.itemsMap);
        const totalItens = items.length;
        const atendidos = items.filter(i => i.status === 'atendido' || (Number(i.qtdAtendida) > 0 && i.status !== 'sem_estoque')).length;
        const preview = items.slice(0, 4).map(i => esc(i.material || '')).join(', ');
        const more = totalItens > 4 ? ` +${totalItens - 4}` : '';
        obsHtml = `<div class="card-obs" title="${esc(preview + more)}">📋 ${totalItens} itens${panelType === 'rdy' && atendidos ? ` · ${atendidos} atend.` : ''}${preview ? ' · ' + preview + more : ''}</div>`;
    } else if (m.itens) {
        obsHtml = `<div class="card-obs" title="${esc(m.itens)}">↳ ${esc(m.itens)}</div>`;
    }

    const separador = m.responsavelSeparador ? `<div class="card-sep">👤 ${esc(m.responsavelSeparador)}</div>` : '<span></span>';
    const time = esc(formatTimestamp(m.dataSeparacao || m.dataRetirada || m.registradoEm));
    const icon = panelType === 'rdy' ? '✓' : '◎';

    const id = esc(m.id || '');
    return `
        <div class="card" data-mat-id="${id}">
            <div class="card-ic">${icon}</div>
            <div class="card-body">
                <div class="card-unit">${unidade}</div>
                <div class="card-tipo">${tipoHtml}</div>
                ${obsHtml}
                <div class="card-footer">
                    ${separador}
                    <div class="card-time">${time}</div>
                </div>
            </div>
        </div>
    `;
}

function ensureTVFichaBindings() {
    if (__tvFichaBound) return;
    __tvFichaBound = true;

    const modal = document.getElementById('tvFichaModal');
    const closeBtn = document.getElementById('tvFichaClose');
    if (!modal) return;

    const close = () => {
        modal.classList.remove('open');
        modal.setAttribute('aria-hidden', 'true');
    };

    if (closeBtn) closeBtn.addEventListener('click', close);
    modal.addEventListener('click', (e) => {
        if (e.target === modal) close();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal.classList.contains('open')) close();
    });
}

function tvStatusLabel(raw) {
    const s = String(raw || '').toLowerCase();
    if (s === 'atendido') return { cls: 'atendido', txt: 'Atendido' };
    if (s === 'parcial') return { cls: 'parcial', txt: 'Parcial' };
    if (s === 'sem_estoque') return { cls: 'sem_estoque', txt: 'Sem estoque' };
    if (s === 'nao_atendido') return { cls: 'nao_atendido', txt: 'Não atendido' };
    if (s === 'excedido') return { cls: 'parcial', txt: 'Excedido' };
    return { cls: 'nao_atendido', txt: '—' };
}

function openTVFichaById(id) {
    ensureTVFichaBindings();
    const modal = document.getElementById('tvFichaModal');
    const titleEl = document.getElementById('tvFichaTitle');
    const bodyEl = document.getElementById('tvFichaBody');
    if (!modal || !titleEl || !bodyEl) return;

    const materiais = (getMateriais() || []).filter(m => !m.deleted);
    const m = materiais.find(x => String(x.id || '') === String(id || ''));
    if (!m) return;

    const esc = (input) => String(input ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\"/g, '&quot;')
        .replace(/'/g, '&#39;');

    const unidade = esc(m.unidadeNome || 'Unidade');
    const tipoUnidade = esc((m.tipoUnidade || 'OUTROS').toUpperCase());
    const tipos = Array.isArray(m.tiposMaterial) && m.tiposMaterial.length ? m.tiposMaterial.map(t => esc(String(t))).join(', ') : esc(m.tipoMaterial || '');
    const separador = esc(m.responsavelSeparador || '');
    const entreguePor = esc(m.responsavelEntregaAlmox || m.entreguePor || '');
    const retiradoPor = esc(m.responsavelRecebimento || '');
    const status = esc(String(m.status || '').toUpperCase());
    const quando = esc(formatTimestamp(m.dataSeparacao || m.dataRetirada || m.registradoEm));

    titleEl.textContent = `📦 ${unidade}`;

    const itemsObj = m.itemsMap && typeof m.itemsMap === 'object' ? m.itemsMap : {};
    const items = Object.values(itemsObj).filter(Boolean);

    const rows = items.slice(0, 60).map((it) => {
        const mat = esc(it.material || '');
        const un = esc(it.unidade || '');
        const sol = esc(it.qtdSolicitada ?? '');
        const ate = esc(it.qtdAtendida ?? '');
        const st = tvStatusLabel(it.status);
        return `<tr><td class="c-mat">${mat}</td><td class="c-un">${un}</td><td class="c-sol">${sol}</td><td class="c-ate">${ate}</td><td class="c-st"><span class="tv-st ${st.cls}">${st.txt}</span></td></tr>`;
    }).join('');

    const more = items.length > 60 ? `<div style="margin-top:10px;font-size:11px;color:#64748b">Mostrando 60 de ${items.length} itens.</div>` : '';

    bodyEl.innerHTML = `
        <div class="tv-ficha-meta">
            <span class="tv-chip">🏷️ ${tipoUnidade}</span>
            <span class="tv-chip">📌 ${status}</span>
            <span class="tv-chip">🕒 ${quando}</span>
            ${tipos ? `<span class="tv-chip">🧾 ${tipos}</span>` : ''}
            ${separador ? `<span class="tv-chip">👤 Separador: ${separador}</span>` : ''}
            ${entreguePor ? `<span class="tv-chip">📦 Entregue por: ${entreguePor}</span>` : ''}
            ${retiradoPor ? `<span class="tv-chip">🤝 Retirado por: ${retiradoPor}</span>` : ''}
        </div>
        ${items.length ? `<table class="tv-items"><thead><tr><th class="c-mat">Material</th><th class="c-un">Un.</th><th class="c-sol">Solic.</th><th class="c-ate">Atend.</th><th class="c-st">Status</th></tr></thead><tbody>${rows}</tbody></table>${more}` : '<div style="font-size:12px;color:#64748b">Sem itens detalhados nesta requisição.</div>'}
    `;

    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
}

const tvAutoScrollState = new WeakMap();

function stopTVAutoScroll(element) {
    if (!element) return;
    const state = tvAutoScrollState.get(element);
    if (!state) return;
    if (state.intervalId) clearInterval(state.intervalId);
    if (state.startTimeoutId) clearTimeout(state.startTimeoutId);
    if (state.resetTimeoutId) clearTimeout(state.resetTimeoutId);
    tvAutoScrollState.delete(element);
}

function handleTVAutoScroll(element) {
    if (!element) return;
    stopTVAutoScroll(element);

    if (!element.isConnected) return;

    const shouldScroll = () => element.isConnected && element.scrollHeight > (element.clientHeight + 2);
    if (!shouldScroll()) {
        element.scrollTop = 0;
        return;
    }

    const state = { intervalId: null, startTimeoutId: null, resetTimeoutId: null };
    tvAutoScrollState.set(element, state);

    const scrollSpeed = 1;
    const tickMs = 50;
    const startDelayMs = 1800;
    const endPauseMs = 2500;

    const start = () => {
        if (!shouldScroll()) return;
        if (state.intervalId) clearInterval(state.intervalId);
        state.intervalId = setInterval(tick, tickMs);
    };

    const tick = () => {
        if (!shouldScroll()) {
            stopTVAutoScroll(element);
            return;
        }
        if (document.hidden) return;

        const maxScroll = element.scrollHeight - element.clientHeight;
        if (element.scrollTop < (maxScroll - 1)) {
            element.scrollTop = Math.min(maxScroll, element.scrollTop + scrollSpeed);
            return;
        }

        if (state.intervalId) clearInterval(state.intervalId);
        state.intervalId = null;
        if (state.resetTimeoutId) clearTimeout(state.resetTimeoutId);
        state.resetTimeoutId = setTimeout(() => {
            if (!shouldScroll()) {
                stopTVAutoScroll(element);
                return;
            }
            element.scrollTop = 0;
            start();
        }, endPauseMs);
    };

    state.startTimeoutId = setTimeout(start, startDelayMs);
}

export function filterDashboardMateriais(status) {
    setCurrentDashboardMaterialFilter(status);
    renderDashboardMateriaisProntos(status);
}

export function renderDashboard() {
    // Bloco try-catch individual para cada seção evitar que um erro pare tudo
    try { renderDashboardAguaSummary(); } catch(e) { console.error("Dashboard Água:", e); }
    try { renderDashboardGasSummary(); } catch(e) { console.error("Dashboard Gás:", e); }
    try { renderDashboardMateriaisCounts(); } catch(e) { console.error("Dashboard Counts:", e); }
    try { renderDashboardMateriaisProntos(getCurrentDashboardMaterialFilter()); } catch(e) { console.error("Dashboard Materiais:", e); }
    try { renderDashboardMateriaisList(); } catch(e) { console.error("Dashboard Lista:", e); }
}

export function startDashboardRefresh() {
    stopDashboardRefresh(); 
    console.log("Iniciando auto-refresh do Dashboard (2 min)");
    dashboardRefreshInterval = setInterval(() => {
        console.log("Atualizando dados do Dashboard (auto-refresh)...");
        renderDashboard(); 
        if (typeof lucide !== 'undefined' && typeof lucide.createIcons === 'function') { lucide.createIcons(); }
    }, 120000);
}

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
    const btnVerLista = document.getElementById('btn-dashboard-ver-lista');
    if (btnVerLista) {
        btnVerLista.addEventListener('click', () => switchDashboardView('materiais'));
    }
    const btnTvMode = document.getElementById('btn-tv-mode');
    if (btnTvMode) {
        btnTvMode.addEventListener('click', () => {
            const geralPane = document.getElementById('dashboard-view-geral');
            if (geralPane) {
                geralPane.classList.toggle('tv-mode');
                const mainEl = document.querySelector('main');
                if (mainEl) mainEl.classList.toggle('tv-wide');
                updateGlobalTvModeClass();
                renderDashboardMateriaisProntos(getCurrentDashboardMaterialFilter());
                if (geralPane.classList.contains('tv-mode')) startAutoScrollGeralTV(); else stopAutoScrollGeralTV();
            }
        });
    }
    const btnVerGrade = document.getElementById('btn-dashboard-ver-grade');
    if (btnVerGrade) {
        btnVerGrade.addEventListener('click', () => switchDashboardView('geral'));
    }
    const btnMateriaisTvMode = document.getElementById('btn-dashboard-materiais-tvmode');
    if (btnMateriaisTvMode) {
        btnMateriaisTvMode.addEventListener('click', () => {
            const materiaisPane = document.getElementById('dashboard-view-materiais');
            if (materiaisPane) {
                materiaisPane.classList.toggle('tv-mode');
                const mainEl = document.querySelector('main');
                if (mainEl) mainEl.classList.toggle('tv-wide');
                updateGlobalTvModeClass();
                renderDashboardMateriaisList();
            }
        });
    }
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
    
    const cardSeparacao = document.getElementById('dashboard-card-separacao');
    const cardRetirada = document.getElementById('dashboard-card-retirada');

    if (cardSeparacao) cardSeparacao.addEventListener('click', () => filterDashboardMateriais('separacao')); 
    if (cardRetirada) cardRetirada.addEventListener('click', () => filterDashboardMateriais('retirada'));

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

    if (DOM_ELEMENTS.dashboardMateriaisProntosContainer) {
        DOM_ELEMENTS.dashboardMateriaisProntosContainer.addEventListener('click', (e) => {
            const btn = e.target.closest('button.accordion-header[data-grupo]');
            if (!btn) return;
            const tipo = btn.dataset.grupo;
            const content = document.getElementById(`grupo-${tipo}`);
            if (content) content.classList.toggle('collapsed');
        });
    }

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

    if (typeof lucide !== 'undefined' && typeof lucide.createIcons === 'function') { lucide.createIcons(); }
    atualizarGeralPagerUI();
    const geralPane = document.getElementById('dashboard-view-geral');
    if (geralPane && geralPane.classList.contains('tv-mode')) {
        startAutoScrollGeralTV();
    } else {
        stopAutoScrollGeralTV();
    }
}

function updateGlobalTvModeClass() {
    const geralActive = document.getElementById('dashboard-view-geral')?.classList.contains('tv-mode');
    const matActive = document.getElementById('dashboard-view-materiais')?.classList.contains('tv-mode');
    const anyActive = Boolean(geralActive || matActive);
    document.body.classList.toggle('tv-mode', anyActive);
    const mainEl = document.querySelector('main');
    if (mainEl) mainEl.classList.toggle('tv-wide', anyActive);
}

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
    }, 10000); 
}

function pararAutoPagerTV() {
    if (materiaisAutoPagerInterval) {
        clearInterval(materiaisAutoPagerInterval);
        materiaisAutoPagerInterval = null;
    }
}

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

function startAutoScrollGeralTV() {
    stopAutoScrollGeralTV();
    const sections = document.querySelectorAll('#dashboard-view-geral .accordion-content');
    sections.forEach((content) => {
        if (content.scrollHeight <= content.clientHeight + 2) return;
        const stepPx = 1; 
        const tickMs = 80; 

        let timer = null;
        const tick = () => {
            const pane = document.getElementById('dashboard-view-geral');
            if (!pane || !pane.classList.contains('tv-mode')) return;
            const atBottom = (content.scrollTop + content.clientHeight) >= (content.scrollHeight - 2);
            content.scrollTop = atBottom ? 0 : (content.scrollTop + stepPx);
        };
        const start = () => {
            if (timer) clearInterval(timer);
            timer = setInterval(tick, tickMs);
        };
        const stop = () => {
            if (timer) clearInterval(timer);
            timer = null;
        };

        const onEnter = () => stop();
        const onLeave = () => {
            const pane = document.getElementById('dashboard-view-geral');
            if (!pane || !pane.classList.contains('tv-mode')) return;
            start();
        };

        start();
        content.addEventListener('mouseenter', onEnter);
        content.addEventListener('mouseleave', onLeave);

        geralAutoScrollTimers.push({ stop, content, onEnter, onLeave });
    });
}

function stopAutoScrollGeralTV() {
    geralAutoScrollTimers.forEach(({ stop, content, onEnter, onLeave }) => {
        try { if (stop) stop(); } catch {}
        if (!content) return;
        if (onEnter) content.removeEventListener('mouseenter', onEnter);
        if (onLeave) content.removeEventListener('mouseleave', onLeave);
    });
    geralAutoScrollTimers = [];
}

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
