// js/modules/social-control-improved.js
// MELHORIAS PARA O SISTEMA DE RELATÓRIOS - ASSISTÊNCIA SOCIAL
// Versão melhorada com análise de unidades e gráficos mais informativos

import { Timestamp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { 
    getCestaMovimentacoes, 
    getEnxovalMovimentacoes,
    getUnidades 
} from "../utils/cache.js";
import { showAlert } from "../utils/dom-helpers.js";
import { formatTimestamp, capitalizeString, dateToTimestamp } from "../utils/formatters.js";
import { isReady } from "./auth.js";

// Variáveis para as instâncias dos gráficos melhorados
let graficoCestaRelatorioMelhorado = null;
let graficoEnxovalRelatorioMelhorado = null;
let graficoCestaUnidades = null;
let graficoEnxovalUnidades = null;
let graficoCestaTemporal = null;
let graficoEnxovalTemporal = null;

/**
 * NOVA FUNÇÃO: Extrai o nome da unidade do destinatário
 * Ex: "CRAS: CRAS CENTRO" -> "CRAS CENTRO"
 * Ex: "João da Silva" -> "João da Silva" (personalizado)
 */
function extrairNomeUnidade(destinatario) {
    if (!destinatario) return 'N/A';
    
    // Se contém ":", é formato "TIPO: NOME"
    if (destinatario.includes(':')) {
        return destinatario.split(':')[1].trim();
    }
    
    // Caso contrário, retorna o nome completo (destinatário personalizado)
    return destinatario.trim();
}

/**
 * NOVA FUNÇÃO: Extrai o tipo da unidade do destinatário
 * Ex: "CRAS: CRAS CENTRO" -> "CRAS"
 * Ex: "João da Silva" -> "PERSONALIZADO"
 */
function extrairTipoUnidade(destinatario) {
    if (!destinatario) return 'N/A';
    
    if (destinatario.includes(':')) {
        return destinatario.split(':')[0].trim().toUpperCase();
    }
    
    return 'PERSONALIZADO';
}

/**
 * NOVA FUNÇÃO: Análise detalhada de unidades que mais receberam
 */
function analisarUnidadesQueReceberam(movimentacoes) {
    const unidadesMap = new Map();
    const tiposMap = new Map();
    
    movimentacoes.forEach(m => {
        const nomeUnidade = extrairNomeUnidade(m.destinatario);
        const tipoUnidade = extrairTipoUnidade(m.destinatario);
        const quantidade = m.quantidade || 0;
        
        // Contabiliza por unidade específica
        if (unidadesMap.has(nomeUnidade)) {
            unidadesMap.set(nomeUnidade, {
                ...unidadesMap.get(nomeUnidade),
                total: unidadesMap.get(nomeUnidade).total + quantidade,
                entregas: unidadesMap.get(nomeUnidade).entregas + 1
            });
        } else {
            unidadesMap.set(nomeUnidade, {
                nome: nomeUnidade,
                tipo: tipoUnidade,
                total: quantidade,
                entregas: 1,
                ultimaEntrega: m.data // Timestamp
            });
        }
        
        // Contabiliza por tipo de unidade
        tiposMap.set(tipoUnidade, (tiposMap.get(tipoUnidade) || 0) + quantidade);
    });
    
    return {
        unidadesRanking: Array.from(unidadesMap.values()).sort((a, b) => b.total - a.total),
        tiposRanking: Array.from(tiposMap.entries()).sort((a, b) => b[1] - a[1])
    };
}

/**
 * NOVA FUNÇÃO: Análise temporal por mês
 */
function analisarTendenciaTemporal(movimentacoes) {
    const mesesMap = new Map();
    
    movimentacoes.forEach(m => {
        const date = m.data.toDate();
        const mesKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        const mesLabel = date.toLocaleDateString('pt-BR', { year: 'numeric', month: 'short' });
        
        if (mesesMap.has(mesKey)) {
            mesesMap.set(mesKey, {
                ...mesesMap.get(mesKey),
                total: mesesMap.get(mesKey).total + (m.quantidade || 0),
                entregas: mesesMap.get(mesKey).entregas + 1
            });
        } else {
            mesesMap.set(mesKey, {
                mes: mesLabel,
                total: m.quantidade || 0,
                entregas: 1
            });
        }
    });
    
    // Converte para array e ordena por mês (chave YYYY-MM)
    return Array.from(mesesMap.entries())
        .map(([key, value]) => ({ key, ...value }))
        .sort((a, b) => a.key.localeCompare(b.key));
}


/**
 * NOVA FUNÇÃO: Renderiza gráfico de unidades que mais receberam (Horizontal Bar)
 */
function renderGraficoUnidades(itemType, unidadesRanking) {
    const canvasId = `grafico-${itemType}-unidades`;
    const ctx = document.getElementById(canvasId)?.getContext('2d');
    if (!ctx) return;
    
    // Destrói instância anterior
    const currentChart = itemType === 'cesta' ? graficoCestaUnidades : graficoEnxovalUnidades;
    if (currentChart) {
        currentChart.destroy();
    }
    
    // Pega os top 10 unidades
    const top10 = unidadesRanking.slice(0, 10);
    const labels = top10.map(u => u.nome.length > 20 ? u.nome.substring(0, 20) + '...' : u.nome);
    const data = top10.map(u => u.total);
    const backgroundColor = top10.map((_, index) => {
        const colors = [
            'rgba(220, 38, 127, 0.8)',   // Pink-600
            'rgba(190, 24, 93, 0.8)',    // Pink-700
            'rgba(157, 23, 77, 0.8)',    // Pink-800
            'rgba(124, 58, 237, 0.8)',   // Violet-600
            'rgba(109, 40, 217, 0.8)',   // Violet-700
            'rgba(124, 58, 237, 0.7)',   // Violet-600 lighter
            'rgba(168, 85, 247, 0.7)',   // Purple-500
            'rgba(147, 51, 234, 0.7)',   // Purple-600
            'rgba(126, 34, 206, 0.7)',   // Purple-700
            'rgba(107, 33, 168, 0.7)'    // Purple-800
        ];
        return colors[index] || 'rgba(156, 163, 175, 0.7)';
    });
    
    const newChart = new Chart(ctx, {
        type: 'bar', // Tipo bar com indexAxis: 'y' para horizontal
        data: {
            labels: labels,
            datasets: [{
                label: itemType === 'cesta' ? 'Cestas Recebidas' : 'Enxovais Recebidos',
                data: data,
                backgroundColor: backgroundColor,
                borderColor: backgroundColor.map(color => color.replace('0.8', '1')),
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            indexAxis: 'y', // Torna o gráfico horizontal
            scales: {
                x: {
                    beginAtZero: true,
                    title: {
                        display: true,
                        text: itemType === 'cesta' ? 'Quantidade de Cestas' : 'Quantidade de Enxovais'
                    },
                    ticks: { precision: 0 }
                },
                y: {
                    title: {
                        display: true,
                        text: 'Unidades'
                    }
                }
            },
            plugins: {
                title: {
                    display: true,
                    text: `Top 10 Unidades que Mais Receberam ${itemType === 'cesta' ? 'Cestas Básicas' : 'Enxovais'}`
                },
                legend: {
                    display: false
                },
                tooltip: {
                    callbacks: {
                        afterLabel: function(context) {
                            // Encontra o objeto completo da unidade para o tooltip
                            const unidade = top10[context.dataIndex];
                            return [
                                `Tipo: ${unidade.tipo}`,
                                `Entregas: ${unidade.entregas}`,
                                `Última entrega: ${formatTimestamp(unidade.ultimaEntrega)}`
                            ];
                        }
                    }
                }
            }
        }
    });
    
    if (itemType === 'cesta') {
        graficoCestaUnidades = newChart;
    } else {
        graficoEnxovalUnidades = newChart;
    }
}

/**
 * NOVA FUNÇÃO: Renderiza gráfico de tendência temporal (Line Chart)
 */
function renderGraficoTemporal(itemType, dadosTemporais) {
    const canvasId = `grafico-${itemType}-temporal`;
    const ctx = document.getElementById(canvasId)?.getContext('2d');
    if (!ctx) return;
    
    // Destrói instância anterior
    const currentChart = itemType === 'cesta' ? graficoCestaTemporal : graficoEnxovalTemporal;
    if (currentChart) {
        currentChart.destroy();
    }
    
    const labels = dadosTemporais.map(d => d.mes);
    const dataTotal = dadosTemporais.map(d => d.total);
    const dataEntregas = dadosTemporais.map(d => d.entregas);
    
    const newChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: itemType === 'cesta' ? 'Total de Cestas' : 'Total de Enxovais',
                    data: dataTotal,
                    borderColor: 'rgba(220, 38, 127, 1)', // Pink-600
                    backgroundColor: 'rgba(220, 38, 127, 0.1)',
                    borderWidth: 3,
                    fill: true,
                    tension: 0.4,
                    yAxisID: 'y'
                },
                {
                    label: 'Número de Entregas',
                    data: dataEntregas,
                    borderColor: 'rgba(59, 130, 246, 1)', // Blue-500
                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                    borderWidth: 2,
                    fill: false,
                    tension: 0.4,
                    yAxisID: 'y1'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false,
            },
            stacked: false,
            scales: {
                x: {
                    title: {
                        display: true,
                        text: 'Período'
                    }
                },
                y: {
                    type: 'linear',
                    display: true,
                    position: 'left',
                    title: {
                        display: true,
                        text: itemType === 'cesta' ? 'Quantidade de Cestas' : 'Quantidade de Enxovais'
                    },
                    beginAtZero: true,
                    ticks: { precision: 0 }
                },
                y1: {
                    type: 'linear',
                    display: true,
                    position: 'right',
                    title: {
                        display: true,
                        text: 'Número de Entregas'
                    },
                    beginAtZero: true,
                    ticks: { precision: 0 },
                    grid: {
                        drawOnChartArea: false, // Desenha apenas para o eixo Y esquerdo
                    },
                }
            },
            plugins: {
                title: {
                    display: true,
                    text: `Tendência Temporal de Distribuição - ${itemType === 'cesta' ? 'Cestas Básicas' : 'Enxovais'}`
                },
                legend: {
                    position: 'bottom'
                }
            }
        }
    });
    
    if (itemType === 'cesta') {
        graficoCestaTemporal = newChart;
    } else {
        graficoEnxovalTemporal = newChart;
    }
}

/**
 * NOVA FUNÇÃO: Renderiza gráfico de distribuição por categoria (Doughnut Chart)
 */
function renderGraficoCategorias(itemType, categoriasOrdenadas, totalSaidas) {
    const canvasId = `grafico-${itemType}-relatorio`;
    const ctx = document.getElementById(canvasId)?.getContext('2d');
    if (!ctx) return;
    
    // Destrói instância anterior
    const currentChart = itemType === 'cesta' ? graficoCestaRelatorioMelhorado : graficoEnxovalRelatorioMelhorado;
    if (currentChart) currentChart.destroy();
    
    const chartLabels = categoriasOrdenadas.map(entry => capitalizeString(entry[0]));
    const chartData = categoriasOrdenadas.map(entry => entry[1]);

    const newChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: chartLabels,
            datasets: [{
                label: itemType === 'cesta' ? 'Cestas por Categoria' : 'Enxovais por Categoria',
                data: chartData,
                backgroundColor: [
                    'rgba(220, 38, 127, 0.8)', // Pink
                    'rgba(168, 85, 247, 0.8)', // Purple
                    'rgba(59, 130, 246, 0.8)', // Blue
                    'rgba(16, 185, 129, 0.8)', // Green
                    'rgba(245, 158, 11, 0.8)', // Amber
                    'rgba(239, 68, 68, 0.8)', // Red
                    'rgba(156, 163, 175, 0.8)' // Gray
                ],
                borderColor: [
                    'rgba(220, 38, 127, 1)',
                    'rgba(168, 85, 247, 1)',
                    'rgba(59, 130, 246, 1)',
                    'rgba(16, 185, 129, 1)',
                    'rgba(245, 158, 11, 1)',
                    'rgba(239, 68, 68, 1)',
                    'rgba(156, 163, 175, 1)'
                ],
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                title: {
                    display: true,
                    text: `Distribuição por Categoria - ${itemType === 'cesta' ? 'Cestas Básicas' : 'Enxovais'}`
                },
                legend: {
                    position: 'bottom'
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const label = context.label || '';
                            const value = context.raw || 0;
                            const percentage = ((value / totalSaidas) * 100).toFixed(1);
                            return `${label}: ${value} (${percentage}%)`;
                        }
                    }
                }
            }
        }
    });
    
    if (itemType === 'cesta') {
        graficoCestaRelatorioMelhorado = newChart;
    } else {
        graficoEnxovalRelatorioMelhorado = newChart;
    }
}


/**
 * FUNÇÃO MELHORADA: Renderiza o resumo textual com análise de unidades
 */
function renderRelatorioTextualMelhorado(itemType, movsFiltradas, categoriasMap, totalSaidas, analiseUnidades, dadosTemporais) {
    const relatorioEl = document.getElementById(`${itemType}-relatorio-resumo-texto`);
    if (!relatorioEl) return;
    
    const itemLabel = itemType === 'cesta' ? 'cesta' : 'enxoval';
    const itemLabelPlural = itemType === 'cesta' ? 'cestas básicas' : 'enxovais';
    
    // Dados da análise
    const { unidadesRanking, tiposRanking } = analiseUnidades;
    const unidadeQueRecebeuMais = unidadesRanking.length > 0 ? unidadesRanking[0] : null;
    const tipoQueRecebeuMais = tiposRanking.length > 0 ? tiposRanking[0] : null;
    
    // Cálculos temporais
    const totalMeses = dadosTemporais.length;
    const mediaMensal = totalSaidas / (totalMeses > 0 ? totalMeses : 1);
    
    // Categoria principal
    const categoriasOrdenadas = Array.from(categoriasMap.entries()).sort((a, b) => b[1] - a[1]);
    const categoriaPrincipal = categoriasOrdenadas.length > 0 ? {
        nome: capitalizeString(categoriasOrdenadas[0][0]),
        total: categoriasOrdenadas[0][1],
        percentual: (categoriasOrdenadas[0][1] / totalSaidas) * 100
    } : null;
    
    // Período da análise
    // Usa a função getPeriodoAnalise para obter datas formatadas
    const { dataInicial, dataFinal, totalDias } = getPeriodoAnalise(movsFiltradas);
    
    // HTML do relatório melhorado
    let relatorioHtml = `
        <div class="space-y-4">
            <!-- Resumo Executivo -->
            <div class="bg-gradient-to-r from-pink-50 to-purple-50 p-4 rounded-lg border border-pink-200">
                <h4 class="font-bold text-pink-800 mb-2">📊 Resumo Executivo</h4>
                <p class="text-sm text-gray-700">No período de <strong>${dataInicial ? formatTimestamp(dataInicial) : 'N/A'}</strong> a <strong>${dataFinal ? formatTimestamp(dataFinal) : 'N/A'}</strong> (${totalDias} dias), foram distribuídas <strong>${totalSaidas} unidades</strong> de ${itemLabelPlural}.</p>
                <p class="text-xs text-gray-500 mt-1">Média Diária: <strong>${(totalSaidas / totalDias).toFixed(1)} ${itemLabel}s</strong> | Média Mensal: <strong>${mediaMensal.toFixed(1)} ${itemLabel}s</strong></p>
            </div>
            
            <!-- Destaques -->
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div class="bg-blue-50 p-4 rounded-lg border border-blue-200">
                    <h5 class="font-semibold text-blue-800 mb-2">🏆 Unidade Campeã em Recebimento</h5>
                    ${unidadeQueRecebeuMais ? `
                        <p class="text-sm"><strong>${unidadeQueRecebeuMais.nome}</strong> (${unidadeQueRecebeuMais.tipo})</p>
                        <p class="text-xs text-gray-600">Recebeu: <strong>${unidadeQueRecebeuMais.total} ${itemLabel}s</strong> em ${unidadeQueRecebeuMais.entregas} entregas</p>
                        <p class="text-xs text-gray-500">Última entrega: ${formatTimestamp(unidadeQueRecebeuMais.ultimaEntrega)}</p>
                    ` : '<p class="text-sm text-gray-500">Nenhum dado disponível</p>'}
                </div>
                
                <div class="bg-green-50 p-4 rounded-lg border border-green-200">
                    <h5 class="font-semibold text-green-800 mb-2">🏷️ Categoria Principal de Distribuição</h5>
                    ${categoriaPrincipal ? `
                        <p class="text-sm"><strong>${categoriaPrincipal.nome}</strong></p>
                        <p class="text-xs text-gray-600">Total: <strong>${categoriaPrincipal.total} ${itemLabel}s</strong></p>
                        <p class="text-xs text-gray-500">${categoriaPrincipal.percentual.toFixed(1)}% do total distribuído</p>
                    ` : '<p class="text-sm text-gray-500">Nenhum dado disponível</p>'}
                </div>
            </div>
            
            <!-- Recomendações/Insights -->
            <div class="bg-yellow-50 p-4 rounded-lg border border-yellow-200">
                <h5 class="font-semibold text-yellow-800 mb-2">💡 Insights e Recomendações</h5>
                <ul class="text-sm text-gray-700 space-y-1">
                    ${unidadeQueRecebeuMais ? `<li>• Focar o <strong>planejamento de distribuição</strong> na unidade <strong>${unidadeQueRecebeuMais.nome}</strong>, que demonstrou a maior demanda.</li>` : ''}
                    ${categoriaPrincipal ? `<li>• O <strong>estoque de aquisição</strong> deve priorizar a categoria <strong>${categoriaPrincipal.nome}</strong>, que absorveu a maior parte dos recursos.</li>` : ''}
                    ${totalMeses > 1 ? `<li>• Utilizar o gráfico temporal para <strong>identificar picos</strong> e evitar rupturas de estoque em meses de alta demanda.</li>` : ''}
                </ul>
            </div>
        </div>
    `;
    
    relatorioEl.innerHTML = relatorioHtml;
}

/**
 * Obtém as datas inicial e final do período analisado.
 * (Copiado de social-control.js para que o módulo seja auto-suficiente)
 * @param {Array<Object>} movimentacoes Movimentações de saída.
 * @returns {Object} { dataInicial, dataFinal, totalDias }.
 */
function getPeriodoAnalise(movimentacoes) {
    if (movimentacoes.length === 0) return { dataInicial: null, dataFinal: null, totalDias: 0 };

    const movsOrdenadas = [...movimentacoes].sort((a, b) => (a.data?.toMillis() || 0) - (b.data?.toMillis() || 0));
    
    const primeiraMovDate = movsOrdenadas[0].data.toDate();
    const ultimaMovDate = movsOrdenadas[movsOrdenadas.length - 1].data.toDate();

    const dataInicial = Timestamp.fromDate(primeiraMovDate);
    const dataFinal = Timestamp.fromDate(ultimaMovDate);

    const inicioPrimeira = new Date(primeiraMovDate.getFullYear(), primeiraMovDate.getMonth(), primeiraMovDate.getDate());
    const fimUltima = new Date(ultimaMovDate.getFullYear(), ultimaMovDate.getMonth(), ultimaMovDate.getDate());

    const diffTime = Math.abs(fimUltima.getTime() - inicioPrimeira.getTime());
    const totalDaysMs = 1000 * 60 * 60 * 24;
    const totalDias = Math.ceil(diffTime / totalDaysMs) + 1; 

    return { dataInicial, dataFinal, totalDias };
}

/**
 * FUNÇÃO PRINCIPAL MELHORADA: Gera relatório completo com múltiplos gráficos
 * Exportada para ser chamada pelo módulo principal.
 */
export async function handleGerarSocialRelatorioMelhorado(itemType) {
    if (!isReady()) { 
        showAlert(`alert-${itemType}-relatorio`, 'Erro: Não autenticado.', 'error'); 
        return; 
    }
    
    const relatorioOutputEl = document.getElementById(`${itemType}-relatorio-output`);
    const alertId = `alert-${itemType}-relatorio`;

    // 1. Coletar filtros
    const dataInicioStr = document.getElementById(`${itemType}-rel-data-inicio`)?.value;
    const dataFimStr = document.getElementById(`${itemType}-rel-data-fim`)?.value;
    const categoriaFiltro = document.getElementById(`${itemType}-rel-categoria`)?.value;
    const btnGerar = document.getElementById(`btn-${itemType}-gerar-relatorio-melhorado`);
    
    if (!dataInicioStr || !dataFimStr) { 
        showAlert(alertId, 'Selecione a data de início e fim.', 'warning'); 
        return; 
    }
    
    const dataInicio = dateToTimestamp(dataInicioStr).toMillis();
    const dataFim = dateToTimestamp(dataFimStr).toMillis() + (24 * 60 * 60 * 1000 - 1);
    
    const movimentacoes = itemType === 'cesta' ? getCestaMovimentacoes() : getEnxovalMovimentacoes();
    
    // Desabilitar botão e mostrar loading
    if (btnGerar) {
        btnGerar.disabled = true;
        btnGerar.innerHTML = '<div class="loading-spinner-small mx-auto"></div>';
    }

    // 2. Filtrar as movimentações
    let movsFiltradas = movimentacoes.filter(m => {
        const mData = m.data?.toMillis();
        const isSaida = m.tipo === 'saida';
        const dataMatch = mData >= dataInicio && mData <= dataFim;
        const categoriaMatch = categoriaFiltro === 'all' || m.categoria === categoriaFiltro;
        return isSaida && dataMatch && categoriaMatch;
    });
    
    if (movsFiltradas.length === 0) {
        showAlert(alertId, 'Nenhum dado de saída encontrado para os filtros selecionados.', 'info');
        relatorioOutputEl?.classList.add('hidden');
        if (btnGerar) {
             btnGerar.disabled = false;
             btnGerar.innerHTML = '<i data-lucide="bar-chart-3"></i> Gerar Relatório Detalhado';
        }
        if (typeof lucide !== 'undefined' && typeof lucide.createIcons === 'function') { lucide.createIcons(); }
        return;
    }
    
    // 3. Análises avançadas
    const totalSaidas = movsFiltradas.reduce((sum, m) => sum + (m.quantidade || 0), 0);
    
    // Análise por categoria (gráfico 1)
    const categoriasMap = new Map();
    movsFiltradas.forEach(m => {
        const categoria = m.categoria || 'Não Categorizado';
        categoriasMap.set(categoria, (categoriasMap.get(categoria) || 0) + (m.quantidade || 0));
    });
    
    // Análise de unidades (gráfico 2)
    const analiseUnidades = analisarUnidadesQueReceberam(movsFiltradas);
    
    // Análise temporal (gráfico 3)
    const dadosTemporais = analisarTendenciaTemporal(movsFiltradas);
    
    // 4. Renderizar resumo textual melhorado
    renderRelatorioTextualMelhorado(itemType, movsFiltradas, categoriasMap, totalSaidas, analiseUnidades, dadosTemporais);
    
    // 5. Renderizar gráfico de categorias (Doughnut)
    const categoriasOrdenadas = Array.from(categoriasMap.entries()).sort((a, b) => b[1] - a[1]);
    renderGraficoCategorias(itemType, categoriasOrdenadas, totalSaidas);
    
    // 6. Renderizar gráfico de unidades (Horizontal Bar)
    renderGraficoUnidades(itemType, analiseUnidades.unidadesRanking);
    
    // 7. Renderizar gráfico temporal (Line Chart)
    const temporalContainer = document.getElementById(`grafico-${itemType}-temporal`)?.closest('.bg-white');
    if (dadosTemporais.length > 1) {
        // Garante que o container de gráfico esteja limpo antes de renderizar
        if(temporalContainer) {
            temporalContainer.innerHTML = `<h4 class="font-semibold text-gray-700 mb-3 text-lg flex items-center gap-2">
                <i data-lucide="trending-up" class="w-5 h-5 text-green-600"></i>
                Tendência Temporal de Distribuição
            </h4>
            <div class="chart-container-xl h-96">
                <canvas id="grafico-${itemType}-temporal"></canvas>
            </div>
            <p class="text-xs text-gray-500 mt-2 italic">
                <i data-lucide="info" class="w-3 h-3 inline mr-1"></i>
                Este gráfico mostra a evolução temporal das distribuições, permitindo identificar padrões sazonais e picos de demanda.
            </p>`;
        }
        renderGraficoTemporal(itemType, dadosTemporais);
    } else {
        // Se houver apenas 1 ponto de dados, o gráfico de linha não é útil
        if(temporalContainer) {
            temporalContainer.innerHTML = `<p class="text-center text-sm text-gray-500 py-10">Dados insuficientes (apenas 1 ponto) para gerar a análise de tendência temporal.</p>`;
        }
    }

    // 8. Finalizar
    relatorioOutputEl?.classList.remove('hidden');
    showAlert(alertId, 'Relatório detalhado gerado com sucesso! Verifique as análises e gráficos abaixo.', 'success', 5000);
    
    if (btnGerar) {
        btnGerar.disabled = false;
        btnGerar.innerHTML = '<i data-lucide="bar-chart-3"></i> Gerar Relatório Detalhado';
    }
    if (typeof lucide !== 'undefined' && typeof lucide.createIcons === 'function') { lucide.createIcons(); }
}

/**
 * Função para limpar todos os gráficos ao trocar de aba (Exportada).
 */
export function limparGraficosSocial() {
    [graficoCestaRelatorioMelhorado, graficoEnxovalRelatorioMelhorado, 
     graficoCestaUnidades, graficoEnxovalUnidades,
     graficoCestaTemporal, graficoEnxovalTemporal].forEach(chart => {
        if (chart) {
            chart.destroy();
        }
    });
    graficoCestaRelatorioMelhorado = null;
    graficoEnxovalRelatorioMelhorado = null;
    graficoCestaUnidades = null;
    graficoEnxovalUnidades = null;
    graficoCestaTemporal = null;
    graficoEnxovalTemporal = null;
}
