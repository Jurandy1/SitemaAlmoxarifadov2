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
                ultimaEntrega: m.data
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
    
    return Array.from(mesesMap.values()).sort((a, b) => a.mes.localeCompare(b.mes));
}

/**
 * NOVA FUNÇÃO: Renderiza gráfico de unidades que mais receberam
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
        type: 'horizontalBar',
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
            indexAxis: 'y',
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
 * NOVA FUNÇÃO: Renderiza gráfico de tendência temporal
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
                    borderColor: 'rgba(220, 38, 127, 1)',
                    backgroundColor: 'rgba(220, 38, 127, 0.1)',
                    borderWidth: 3,
                    fill: true,
                    tension: 0.4,
                    yAxisID: 'y'
                },
                {
                    label: 'Número de Entregas',
                    data: dataEntregas,
                    borderColor: 'rgba(59, 130, 246, 1)',
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
                        drawOnChartArea: false,
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
    const dataInicial = movsFiltradas.length > 0 ? 
        movsFiltradas.reduce((min, m) => m.data.toMillis() < min.toMillis() ? m.data : min, movsFiltradas[0].data) : null;
    const dataFinal = movsFiltradas.length > 0 ? 
        movsFiltradas.reduce((max, m) => m.data.toMillis() > max.toMillis() ? m.data : max, movsFiltradas[0].data) : null;
    
    const totalDias = dataInicial && dataFinal ? 
        Math.ceil((dataFinal.toMillis() - dataInicial.toMillis()) / (1000 * 60 * 60 * 24)) + 1 : 0;
    
    // HTML do relatório melhorado
    let relatorioHtml = `
        <div class="space-y-4">
            <div class="bg-gradient-to-r from-pink-50 to-purple-50 p-4 rounded-lg border border-pink-200">
                <h4 class="font-bold text-pink-800 mb-2">📊 Resumo Executivo</h4>
                <p class="text-sm text-gray-700">No período de <strong>${dataInicial ? formatTimestamp(dataInicial) : 'N/A'}</strong> a <strong>${dataFinal ? formatTimestamp(dataFinal) : 'N/A'}</strong> (${totalDias} dias), foram distribuídas <strong>${totalSaidas} unidades</strong> de ${itemLabelPlural}.</p>
            </div>
            
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div class="bg-blue-50 p-4 rounded-lg border border-blue-200">
                    <h5 class="font-semibold text-blue-800 mb-2">🏆 Unidade Campeã</h5>
                    ${unidadeQueRecebeuMais ? `
                        <p class="text-sm"><strong>${unidadeQueRecebeuMais.nome}</strong> (${unidadeQueRecebeuMais.tipo})</p>
                        <p class="text-xs text-gray-600">Recebeu: <strong>${unidadeQueRecebeuMais.total} ${itemLabel}s</strong> em ${unidadeQueRecebeuMais.entregas} entregas</p>
                        <p class="text-xs text-gray-500">Última entrega: ${formatTimestamp(unidadeQueRecebeuMais.ultimaEntrega)}</p>
                    ` : '<p class="text-sm text-gray-500">Nenhum dado disponível</p>'}
                </div>
                
                <div class="bg-green-50 p-4 rounded-lg border border-green-200">
                    <h5 class="font-semibold text-green-800 mb-2">🏢 Tipo Mais Atendido</h5>
                    ${tipoQueRecebeuMais ? `
                        <p class="text-sm"><strong>${tipoQueRecebeuMais[0]}</strong></p>
                        <p class="text-xs text-gray-600">Total: <strong>${tipoQueRecebeuMais[1]} ${itemLabel}s</strong></p>
                        <p class="text-xs text-gray-500">${((tipoQueRecebeuMais[1] / totalSaidas) * 100).toFixed(1)}% do total distribuído</p>
                    ` : '<p class="text-sm text-gray-500">Nenhum dado disponível</p>'}
                </div>
            </div>
            
            <div class="bg-yellow-50 p-4 rounded-lg border border-yellow-200">
                <h5 class="font-semibold text-yellow-800 mb-2">📈 Indicadores de Performance</h5>
                <div class="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                    <div>
                        <p class="text-gray-600">Média Diária:</p>
                        <p class="font-bold text-yellow-700">${(totalSaidas / totalDias).toFixed(1)} ${itemLabel}s</p>
                    </div>
                    <div>
                        <p class="text-gray-600">Média Mensal:</p>
                        <p class="font-bold text-yellow-700">${mediaMensal.toFixed(1)} ${itemLabel}s</p>
                    </div>
                    <div>
                        <p class="text-gray-600">Total de Unidades:</p>
                        <p class="font-bold text-yellow-700">${unidadesRanking.length}</p>
                    </div>
                    <div>
                        <p class="text-gray-600">Categoria Principal:</p>
                        <p class="font-bold text-yellow-700">${categoriaPrincipal?.nome || 'N/A'}</p>
                    </div>
                </div>
            </div>
            
            <div class="bg-gray-50 p-4 rounded-lg border border-gray-200">
                <h5 class="font-semibold text-gray-800 mb-2">💡 Recomendações Estratégicas</h5>
                <ul class="text-sm text-gray-700 space-y-1">
                    ${unidadeQueRecebeuMais ? `<li>• <strong>Priorizar</strong> estoque para ${unidadeQueRecebeuMais.nome} na próxima distribuição</li>` : ''}
                    ${categoriaPrincipal ? `<li>• <strong>Foco na categoria</strong> ${categoriaPrincipal.nome} (${categoriaPrincipal.percentual.toFixed(1)}% da demanda)</li>` : ''}
                    <li>• <strong>Planejamento:</strong> Considerar média de ${(totalSaidas / totalDias).toFixed(1)} ${itemLabel}s/dia para compras futuras</li>
                    ${totalMeses > 1 ? `<li>• <strong>Sazonalidade:</strong> Analisar o gráfico temporal para identificar picos de demanda</li>` : ''}
                </ul>
            </div>
        </div>
    `;
    
    relatorioEl.innerHTML = relatorioHtml;
}

/**
 * FUNÇÃO PRINCIPAL MELHORADA: Gera relatório completo com múltiplos gráficos
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
    
    if (!dataInicioStr || !dataFimStr) { 
        showAlert(alertId, 'Selecione a data de início e fim.', 'warning'); 
        return; 
    }
    
    const dataInicio = dateToTimestamp(dataInicioStr).toMillis();
    const dataFim = dateToTimestamp(dataFimStr).toMillis() + (24 * 60 * 60 * 1000 - 1);
    
    const movimentacoes = itemType === 'cesta' ? getCestaMovimentacoes() : getEnxovalMovimentacoes();
    
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
        return;
    }
    
    // 3. Análises avançadas
    const totalSaidas = movsFiltradas.reduce((sum, m) => sum + (m.quantidade || 0), 0);
    
    // Análise por categoria (gráfico original)
    const categoriasMap = new Map();
    movsFiltradas.forEach(m => {
        const categoria = m.categoria || 'Não Categorizado';
        categoriasMap.set(categoria, (categoriasMap.get(categoria) || 0) + (m.quantidade || 0));
    });
    
    // NOVA: Análise de unidades
    const analiseUnidades = analisarUnidadesQueReceberam(movsFiltradas);
    
    // NOVA: Análise temporal
    const dadosTemporais = analisarTendenciaTemporal(movsFiltradas);
    
    // 4. Renderizar resumo textual melhorado
    renderRelatorioTextualMelhorado(itemType, movsFiltradas, categoriasMap, totalSaidas, analiseUnidades, dadosTemporais);
    
    // 5. Renderizar gráfico de unidades (NOVO)
    renderGraficoUnidades(itemType, analiseUnidades.unidadesRanking);
    
    // 6. Renderizar gráfico temporal (NOVO)
    if (dadosTemporais.length > 1) {
        renderGraficoTemporal(itemType, dadosTemporais);
    }
    
    // 7. Renderizar gráfico de categorias (mantido do original)
    const categoriasOrdenadas = Array.from(categoriasMap.entries()).sort((a, b) => b[1] - a[1]);
    const chartLabels = categoriasOrdenadas.map(entry => capitalizeString(entry[0]));
    const chartData = categoriasOrdenadas.map(entry => entry[1]);
    
    const ctx = document.getElementById(`grafico-${itemType}-relatorio`)?.getContext('2d');
    if (ctx) {
        const currentChart = itemType === 'cesta' ? graficoCestaRelatorioMelhorado : graficoEnxovalRelatorioMelhorado;
        if (currentChart) currentChart.destroy();
        
        const newChart = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: chartLabels,
                datasets: [{
                    label: itemType === 'cesta' ? 'Cestas por Categoria' : 'Enxovais por Categoria',
                    data: chartData,
                    backgroundColor: [
                        'rgba(220, 38, 127, 0.8)',
                        'rgba(168, 85, 247, 0.8)',
                        'rgba(59, 130, 246, 0.8)',
                        'rgba(16, 185, 129, 0.8)',
                        'rgba(245, 158, 11, 0.8)',
                        'rgba(239, 68, 68, 0.8)',
                        'rgba(156, 163, 175, 0.8)'
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
    
    relatorioOutputEl?.classList.remove('hidden');
    showAlert(alertId, 'Relatório detalhado gerado com sucesso! Verifique os novos gráficos abaixo.', 'success', 5000);
}

/**
 * Função para limpar todos os gráficos ao trocar de aba
 */
export function limparGraficosSocial() {
    [graficoCestaRelatorioMelhorado, graficoEnxovalRelatorioMelhorado, 
     graficoCestaUnidades, graficoEnxovalUnidades,
     graficoCestaTemporal, graficoEnxovalTemporal].forEach(chart => {
        if (chart) {
            chart.destroy();
            chart = null;
        }
    });
}